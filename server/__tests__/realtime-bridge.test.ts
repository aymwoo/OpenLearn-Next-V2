import { describe, it, expect, vi } from 'vitest';
import { setupRealtimeBridge, type RealtimeBridgeDeps } from '../realtime-bridge.js';
import { SOCKET_ROUTES, WHITEBOARD_BROADCAST_ROOM } from '../event-routing.js';

type Emitted = {
  scope: 'global' | 'room';
  room?: string;
  event: string;
  payload: unknown;
};

type RunCall = { sql: string; args: unknown[] };
type GetCall = { sql: string; args: unknown[] };

/**
 * Builds fresh mocks for the realtime bridge and returns helpers to drive and
 * assert behavior. This is a characterization test: it pins the exact
 * Socket.IO events the bridge emits today so a future refactor cannot silently
 * change realtime behavior.
 *
 * The mock DB reads seed values at query time (not at prepare time), so callers
 * seed canned `get` results after `setupRealtimeBridge` but before `publish`.
 */
function buildMocks() {
  const emitted: Emitted[] = [];

  const io = {
    emit: (event: string, payload: unknown) => {
      emitted.push({ scope: 'global', event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ scope: 'room', room, event, payload });
      },
    }),
  } as any;

  const subscribers = new Map<string, (event: any) => void>();
  const eventBus = {
    publish: vi.fn(async () => {}),
    subscribe: (eventType: string, handler: (event: any) => void) => {
      subscribers.set(eventType, handler);
    },
  } as any;

  const seedGet = new Map<string, unknown>();
  const getCalls: GetCall[] = [];
  const runCalls: RunCall[] = [];
  const db = {
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        getCalls.push({ sql, args });
        return seedGet.get(sql);
      },
      run: (...args: unknown[]) => {
        runCalls.push({ sql, args });
      },
    }),
  } as any;

  const deps: RealtimeBridgeDeps = { eventBus, io, db };

  return {
    emitted,
    io,
    eventBus,
    db,
    seedGet,
    getCalls,
    runCalls,
    deps,
    setup: () => setupRealtimeBridge(deps),
    publish: (eventType: string, payload: unknown) => {
      const handler = subscribers.get(eventType);
      if (!handler) throw new Error(`no subscriber for ${eventType}`);
      handler({ id: `evt_${eventType}`, type: eventType, source: 'test', timestamp: 1000, payload });
    },
    runCallsFor: (prefix: string) => runCalls.filter((c) => c.sql.startsWith(prefix)),
  };
}

const TITLE_SQL = 'SELECT title FROM assignments WHERE id = ?';
const ELEMENT_SQL = 'SELECT * FROM whiteboard_elements WHERE id = ?';
const SCHEDULE_SQL = 'SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1';
const ROLLCALL_EXISTS_SQL = 'SELECT id FROM student_rollcalls WHERE id = ?';
const ROLLCALL_INSERT_SQL =
  'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)';

describe('setupRealtimeBridge', () => {
  it('forwards assignment.graded to a toast with the resolved assignment title', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(TITLE_SQL, { title: 'Midterm' });

    m.publish('assignment.graded', { assignmentId: 'a1', studentId: 's1', score: 95, feedback: 'good' });

    expect(m.emitted).toHaveLength(1);
    expect(m.emitted[0]).toMatchObject({
      scope: 'global',
      event: 'assignment-graded-toast',
      payload: { assignmentId: 'a1', assignmentTitle: 'Midterm', studentId: 's1', score: 95, feedback: 'good' },
    });
    // 事件元信息随 payload 一起下发（前端可据此去重/串联）
    expect((m.emitted[0].payload as any)._meta).toEqual({
      eventId: 'evt_assignment.graded',
      type: 'assignment.graded',
      source: 'test',
      timestamp: 1000,
    });
  });

  it('falls back to "Assignment" when the title query returns nothing', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(TITLE_SQL, undefined);

    m.publish('assignment.graded', { assignmentId: 'a1', studentId: 's1' });

    expect(m.emitted[0].payload).toMatchObject({ assignmentTitle: 'Assignment' });
  });

  it('broadcasts whiteboard-sync to both the lesson room and the broadcast room', () => {
    const m = buildMocks();
    m.setup();

    m.publish('whiteboard.element_drawn', { type: 'line', elementId: 'e1', lessonId: 'L1' });

    expect(m.emitted).toHaveLength(2);
    expect(m.emitted[0]).toMatchObject({
      scope: 'room',
      room: 'L1',
      event: 'whiteboard-sync',
      payload: { roomId: 'L1', type: 'refresh' },
    });
    expect(m.emitted[1]).toMatchObject({
      scope: 'room',
      room: 'whiteboard-broadcast',
      event: 'whiteboard-sync',
      payload: { roomId: 'L1', type: 'refresh' },
    });
  });

  it('handles a rollcall element: saves rollcall + emits student-picked + sync', () => {
    const m = buildMocks();
    const pickedTime = '2026-01-02T03:04:05.000Z';
    m.setup();
    m.seedGet.set(ELEMENT_SQL, {
      type: 'rollcall',
      lesson_id: 'L1',
      data: JSON.stringify({ selectedStudent: { id: 's1', name: 'Stu' }, status: 'picked', classId: '', pickedTime }),
    });
    m.seedGet.set(SCHEDULE_SQL, { class_id: 'C1' });
    m.seedGet.set(ROLLCALL_EXISTS_SQL, undefined); // not yet picked → insert path

    m.publish('whiteboard.element_drawn', { type: 'rollcall', elementId: 'el1', lessonId: 'L1' });

    const insert = m.runCallsFor(ROLLCALL_INSERT_SQL);
    expect(insert).toHaveLength(1);
    const [rollcallId, studentId, classId, lessonId, picked] = insert[0].args;
    expect(studentId).toBe('s1');
    expect(classId).toBe('C1');
    expect(lessonId).toBe('L1');
    expect(rollcallId).toBe(`rollcall-el1-${new Date(pickedTime).getTime()}`);
    expect(picked).toBe(new Date(pickedTime).getTime());

    const studentPicked = m.emitted.find((e) => e.event === 'student-picked');
    expect(studentPicked).toMatchObject({
      scope: 'global',
      payload: { rollcallId, studentId: 's1', studentName: 'Stu', classId: 'C1', lessonId: 'L1' },
    });
    expect(m.emitted.filter((e) => e.event === 'whiteboard-sync')).toHaveLength(2);
  });

  it('does not re-insert a rollcall that already exists', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(ELEMENT_SQL, {
      type: 'rollcall',
      lesson_id: 'L1',
      data: JSON.stringify({
        selectedStudent: { id: 's1', name: 'Stu' },
        status: 'picked',
        classId: 'C1',
        pickedTime: '2026-01-02T03:04:05.000Z',
      }),
    });
    m.seedGet.set(ROLLCALL_EXISTS_SQL, { id: 'existing' });

    m.publish('whiteboard.element_updated', { elementId: 'el1' });

    // Verbatim behavior: student-picked is emitted only on first insert, so a
    // duplicate rollcall produces no emit and no insert.
    expect(m.runCallsFor(ROLLCALL_INSERT_SQL)).toHaveLength(0);
    expect(m.emitted.some((e) => e.event === 'student-picked')).toBe(false);
  });

  it('refreshes the lesson and broadcast rooms when a rollcall is freshly picked', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(ELEMENT_SQL, {
      type: 'rollcall',
      lesson_id: 'L1',
      data: JSON.stringify({
        selectedStudent: { id: 's2', name: 'Stu' },
        status: 'picked',
        classId: 'C1',
        pickedTime: '2026-01-02T03:04:05.000Z',
      }),
    });
    m.seedGet.set(ROLLCALL_EXISTS_SQL, undefined);

    m.publish('whiteboard.element_updated', { elementId: 'el1', lessonId: 'L1' });

    // element_updated 本身是 effect-only（不广播），抽中语义状态必须补一次刷新，
    // 否则学生白板上的点名组件会一直停在上一次抽中的学生。
    const syncs = m.emitted.filter((e) => e.event === 'whiteboard-sync');
    expect(syncs).toEqual([
      expect.objectContaining({ scope: 'room', room: 'L1', payload: expect.objectContaining({ type: 'refresh' }) }),
      expect.objectContaining({
        scope: 'room',
        room: 'whiteboard-broadcast',
        payload: expect.objectContaining({ type: 'refresh' }),
      }),
    ]);
  });

  it('does not refresh on rollcall element updates that are not a fresh pick (e.g. drag/resize)', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(ELEMENT_SQL, {
      type: 'rollcall',
      lesson_id: 'L1',
      data: JSON.stringify({
        selectedStudent: { id: 's1', name: 'Stu' },
        status: 'picked',
        classId: 'C1',
        x: 120,
        pickedTime: '2026-01-02T03:04:05.000Z',
      }),
    });
    m.seedGet.set(ROLLCALL_EXISTS_SQL, { id: 'existing' });

    m.publish('whiteboard.element_updated', { elementId: 'el1', lessonId: 'L1' });

    // 高频的拖拽/缩放更新不得触发全量刷新，否则学生端会反复重拉白板。
    expect(m.emitted.filter((e) => e.event === 'whiteboard-sync')).toHaveLength(0);
  });

  describe('element_updated 广播策略（按元素类型声明）', () => {
    const seedElement = (m: ReturnType<typeof buildMocks>, type: string) => {
      m.seedGet.set(ELEMENT_SQL, {
        type,
        lesson_id: 'L1',
        data: JSON.stringify({ x: 10, y: 20, width: 300, height: 200 }),
      });
    };

    it.each([
      ['text', '文本图元'],
      ['rectangle', '矩形图元'],
      ['circle', '圆形图元'],
      ['pen', '画笔'],
      ['highlighter', '荧光笔'],
      ['page_meta', '页面元数据（已有专用事件）'],
    ])('布局型 %s（%s）更新不触发刷新', (type) => {
      const m = buildMocks();
      m.setup();
      seedElement(m, type);

      m.publish('whiteboard.element_updated', { elementId: 'el1', lessonId: 'L1' });

      expect(m.emitted.filter((e) => e.event === 'whiteboard-sync')).toHaveLength(0);
    });

    it.each([
      ['quiz', '题面/选项'],
      ['assignment', '作业绑定'],
      ['presentation', '幻灯片'],
      ['code-sandbox', '代码'],
      ['math-graph', '公式'],
      ['plugin', '第三方组件'],
    ])('语义型 %s（%s）更新触发课节 + 广播房间刷新', (type) => {
      const m = buildMocks();
      m.setup();
      seedElement(m, type);

      m.publish('whiteboard.element_updated', { elementId: 'el1', lessonId: 'L1' });

      expect(m.emitted.filter((e) => e.event === 'whiteboard-sync')).toEqual([
        expect.objectContaining({ room: 'L1', payload: expect.objectContaining({ type: 'refresh' }) }),
        expect.objectContaining({
          room: 'whiteboard-broadcast',
          payload: expect.objectContaining({ type: 'refresh' }),
        }),
      ]);
    });

    it('未登记的新元素类型默认广播（fail-safe：宁可多刷一次，也不要静默不同步）', () => {
      const m = buildMocks();
      m.setup();
      seedElement(m, 'some-future-brand-new-type');

      m.publish('whiteboard.element_updated', { elementId: 'el1', lessonId: 'L1' });

      expect(m.emitted.filter((e) => e.event === 'whiteboard-sync')).toHaveLength(2);
    });

    it('事件缺少 elementId 时既不落库也不广播', () => {
      const m = buildMocks();
      m.setup();

      m.publish('whiteboard.element_updated', { lessonId: 'L1' });

      expect(m.getCalls.filter((c) => c.sql === ELEMENT_SQL)).toHaveLength(0);
      expect(m.emitted).toHaveLength(0);
    });

    it('元素已不存在（被删除）时不广播', () => {
      const m = buildMocks();
      m.setup();
      m.seedGet.set(ELEMENT_SQL, undefined);

      m.publish('whiteboard.element_updated', { elementId: 'gone', lessonId: 'L1' });

      expect(m.emitted).toHaveLength(0);
    });
  });

  it('forwards batch_drawn, element_deleted, and cleared to both the lesson room and the broadcast room', () => {
    const m = buildMocks();
    m.setup();

    m.publish('whiteboard.batch_drawn', { lessonId: 'L2', count: 3 });
    m.publish('whiteboard.element_deleted', { lessonId: 'L2' });
    m.publish('whiteboard.cleared', { lessonId: 'L2' });

    // 房间口径与 element_drawn 一致：课节房间 + 全局广播房间。
    // 只投课节房间会漏掉没 join 课节房间的学生（停在仪表盘 / 作业工作区 / 课件标签页）。
    expect(m.emitted).toHaveLength(6);
    for (const e of m.emitted) {
      expect(e).toMatchObject({
        scope: 'room',
        event: 'whiteboard-sync',
        payload: { roomId: 'L2', type: 'refresh' },
      });
    }
    expect(m.emitted.filter((e) => e.room === 'L2')).toHaveLength(3);
    expect(m.emitted.filter((e) => e.room === WHITEBOARD_BROADCAST_ROOM)).toHaveLength(3);
  });

  describe.each([
    ['whiteboard.element_drawn', { type: 'text', lessonId: 'L3' }],
    ['whiteboard.element_deleted', { lessonId: 'L3' }],
    ['whiteboard.cleared', { lessonId: 'L3' }],
    ['whiteboard.batch_drawn', { lessonId: 'L3' }],
  ])('%s 对伪课节房间（作业工作区）不投全局广播', (eventType, payload) => {
    it('只投自己的房间', () => {
      const m = buildMocks();
      m.setup();

      m.publish(eventType as any, { ...payload, lessonId: 'assignment-a1-student-stu_alice' });

      // 伪课节是 `assignment-<id>-student-<studentId>`，不是一节课。
      // 投进全局广播房间会让全平台客户端无意义重拉，更糟的是会把
      // 「当前没有选中课节」的学生拉进一个并不存在的课节视图。
      expect(m.emitted).toEqual([
        expect.objectContaining({
          scope: 'room',
          room: 'assignment-a1-student-stu_alice',
          event: 'whiteboard-sync',
        }),
      ]);
    });
  });

  it('spotlight 路由已删除：既无 producer 也无 consumer 的空路由不应留在表里', () => {
    // 走查发现这两条路由（冒号/点号双拼写）全仓没有任何 publish，也没有前端监听。
    // 「双轨兼容」保护的是一个不存在的两端，留着只会让后来者误以为聚焦已打通。
    const routeTypes = new Set(SOCKET_ROUTES.map((r) => r.eventType));
    expect(routeTypes.has('spotlight:state_updated')).toBe(false);
    expect(routeTypes.has('spotlight.state_updated')).toBe(false);

    // 桥接层不再为这两个事件注册订阅（mock 在无订阅者时抛错，正好反证路由已移除）
    const m = buildMocks();
    m.setup();
    expect(() => m.publish('spotlight:state_updated', { active: true })).toThrow(/no subscriber/);
    expect(m.emitted).toHaveLength(0);
  });
});
