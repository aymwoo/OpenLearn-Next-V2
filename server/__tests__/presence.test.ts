import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupPresence } from '../presence.js';
import { lessonActiveSegments } from '../shared-state.js';

type Emitted = {
  scope: 'global' | 'room' | 'socket' | 'socket-room';
  room?: string;
  event: string;
  payload: unknown;
};

/**
 * Characterization test for the presence / socket handlers extracted from
 * server.ts. Pins the exact Socket.IO events emitted today so a future
 * refactor cannot silently change realtime behavior.
 *
 * `lessonActiveSegments` is the shared singleton from `./shared-state.js`; we
 * clear it between tests so the enter-lesson / teacher-broadcast-segment paths
 * are isolated.
 */
function buildMocks(
  opts: {
    studentClassIds?: Record<string, string[]>;
    lookupThrows?: boolean;
    lessonClassIds?: Record<string, string | null>;
  } = {},
) {
  const globalEmitted: Emitted[] = [];
  const connectionHandlers: ((socket: any) => void)[] = [];

  const io = {
    on: (event: string, cb: (socket: any) => void) => {
      if (event === 'connection') connectionHandlers.push(cb);
    },
    emit: (event: string, payload: unknown) => {
      globalEmitted.push({ scope: 'global', event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        globalEmitted.push({ scope: 'room', room, event, payload });
      },
    }),
  } as any;

  const eventBus = {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(),
  } as any;

  const deps = {
    io,
    eventBus,
    lookupStudentClassIds: (studentId: string) => {
      if (opts.lookupThrows) throw new Error('db unavailable');
      return opts.studentClassIds?.[studentId] ?? [];
    },
    lookupLessonClassId: (lessonId: string) => {
      const v = opts.lessonClassIds?.[lessonId];
      return v === undefined ? null : v;
    },
  } as any;
  setupPresence(deps);

  function connect(customId = 'sock-1', session?: any) {
    const socketEmitted: Emitted[] = [];
    const joinedRooms: string[] = [];
    const socketHandlers = new Map<string, (data: any) => void>();
    const socket = {
      id: customId,
      data: { session },
      on: (event: string, cb: (data: any) => void) => socketHandlers.set(event, cb),
      emit: (event: string, payload: unknown) => socketEmitted.push({ scope: 'socket', event, payload }),
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => socketEmitted.push({ scope: 'socket-room', room, event, payload }),
      }),
      join: (room: string) => joinedRooms.push(room),
      leave: () => {},
      trigger: (event: string, data: unknown) => {
        const h = socketHandlers.get(event);
        if (!h) throw new Error(`no socket handler for ${event}`);
        h(data);
      },
      _emitted: socketEmitted,
      _joinedRooms: joinedRooms,
      _handlers: socketHandlers,
    } as any;
    const cb = connectionHandlers[connectionHandlers.length - 1];
    cb(socket);
    return socket;
  }

  return { globalEmitted, io, eventBus, deps, connect };
}

describe('setupPresence', () => {
  beforeEach(() => {
    lessonActiveSegments.clear();
  });

  it('emits an initial empty presence-update to the socket on connection', () => {
    const m = buildMocks();
    const socket = m.connect();
    expect(socket._emitted).toEqual([
      { scope: 'socket', event: 'presence-update', payload: { onlineStudentIds: [], activeStudentLessons: {} } },
    ]);
  });

  it('register-student broadcasts presence-update with the student online', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket._emitted.length = 0;
    socket.trigger('register-student', { studentId: 's1', name: 'Stu' });

    expect(m.globalEmitted).toEqual([
      { scope: 'global', event: 'presence-update', payload: { onlineStudentIds: ['s1'], activeStudentLessons: {} } },
    ]);
  });

  it('enter-lesson broadcasts presence-update with the active lesson and no segment change when the map is empty', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('register-student', { studentId: 's1', name: 'Stu' });
    m.globalEmitted.length = 0;
    socket.trigger('enter-lesson', { studentId: 's1', lessonId: 'L1' });

    const updates = m.globalEmitted.filter((e: Emitted) => e.event === 'presence-update');
    expect(updates[updates.length - 1]).toMatchObject({
      payload: { onlineStudentIds: ['s1'], activeStudentLessons: { s1: 'L1' } },
    });
    // segment map empty → no student-active-segment-changed (neither socket nor global)
    expect(socket._emitted.find((e: Emitted) => e.event === 'student-active-segment-changed')).toBeUndefined();
    expect(m.globalEmitted.some((e: Emitted) => e.event === 'student-active-segment-changed')).toBe(false);
  });

  it('whiteboard-event publishes to the event bus and refreshes both the lesson room and the broadcast room', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket._emitted.length = 0;
    socket.trigger('whiteboard-event', {
      type: 'whiteboard.element_drawn',
      payload: { lessonId: 'L1', elementId: 'e1' },
      id: 'x',
      timestamp: 123,
    });

    expect(m.eventBus.publish).toHaveBeenCalledTimes(1);
    const published = m.eventBus.publish.mock.calls[0][0];
    expect(published).toMatchObject({
      type: 'whiteboard.element_drawn',
      source: 'whiteboard',
      payload: { lessonId: 'L1', elementId: 'e1' },
      correlationId: 'L1',
      id: 'x',
      timestamp: 123,
    });

    // Emit goes to the raw lessonId ('L1'), NOT the `lesson-L1` roomName.
    // 广播房间一并投递：只投课节房间会漏掉没 join 课节房间的学生
    // （停在仪表盘 / 作业工作区 / 课件标签页）。
    // roomId 必带：`useClassroomSocket` 的处理函数是 `if (type === 'refresh' && roomId)`，
    // 缺 roomId 会静默丢弃这条刷新。
    expect(socket._emitted).toEqual([
      {
        scope: 'socket-room',
        room: 'L1',
        event: 'whiteboard-sync',
        payload: { type: 'refresh', roomId: 'L1', sourceEvent: 'whiteboard.element_drawn' },
      },
      {
        scope: 'socket-room',
        room: 'whiteboard-broadcast',
        event: 'whiteboard-sync',
        payload: { type: 'refresh', roomId: 'L1', sourceEvent: 'whiteboard.element_drawn' },
      },
    ]);
  });

  it('whiteboard-event without a lessonId publishes to the bus but refreshes nobody', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket._emitted.length = 0;
    socket.trigger('whiteboard-event', {
      type: 'whiteboard.element_drawn',
      payload: { elementId: 'e1' },
      id: 'x',
      timestamp: 123,
    });

    expect(m.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(socket._emitted).toEqual([]);
  });

  it('teacher-broadcast-segment updates the shared segment map and broadcasts the change', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('teacher-broadcast-segment', { lessonId: 'L1', activeSegmentId: 'seg1' });

    expect(lessonActiveSegments.get('L1')).toBe('seg1');
    expect(m.globalEmitted).toEqual([
      {
        scope: 'room',
        room: 'L1',
        event: 'student-active-segment-changed',
        payload: { lessonId: 'L1', activeSegmentId: 'seg1' },
      },
    ]);
  });

  it('teacher-ping-student emits student-pinged to the student socket room', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('register-student', { studentId: 's1', name: 'Stu' });
    m.globalEmitted.length = 0;
    socket.trigger('teacher-ping-student', { studentId: 's1', lessonId: 'L1' });

    expect(m.globalEmitted).toEqual([
      { scope: 'room', room: 'sock-1', event: 'student-pinged', payload: { lessonId: 'L1', message: undefined } },
    ]);
  });

  it('teacher-pick-student broadcasts student-picked exactly once (global superset, no room duplicates)', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('teacher-pick-student', { studentId: 's1', studentName: 'Alice', lessonId: 'L1', classId: 'c1' });

    // 历史版本三重投递（lesson 房间 + class 房间 + 全局），学生同时命中多房间会收到 2-3 次重复弹窗。
    // 现收敛为单次全局广播：io.emit 是任何房间定向投递的超集，语义等价。
    const pickedEvents = m.globalEmitted.filter((e: Emitted) => e.event === 'student-picked');
    expect(pickedEvents.length).toBe(1);
    expect(pickedEvents[0].scope).toBe('global');
    expect(pickedEvents[0].payload).toMatchObject({
      studentId: 's1',
      studentName: 'Alice',
      lessonId: 'L1',
      classId: 'c1',
    });
  });

  it('student-acknowledge-pick broadcasts student-acknowledged globally', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('student-acknowledge-pick', { studentId: 's1', lessonId: 'L1' });

    const ackEvents = m.globalEmitted.filter((e: Emitted) => e.event === 'student-acknowledged');
    expect(ackEvents.length).toBe(1);
    expect(ackEvents[0].payload).toEqual({ studentId: 's1', lessonId: 'L1' });
  });

  it('disconnect removes the student and broadcasts an empty presence-update', () => {
    const m = buildMocks();
    const socket = m.connect();
    socket.trigger('register-student', { studentId: 's1', name: 'Stu' });
    m.globalEmitted.length = 0;
    socket.trigger('disconnect', undefined);

    expect(m.globalEmitted).toEqual([
      { scope: 'global', event: 'presence-update', payload: { onlineStudentIds: [], activeStudentLessons: {} } },
    ]);
  });

  it('stale disconnect does not remove student if replaced by newer socket (refresh/multi-tab protection)', () => {
    const m = buildMocks();
    const socket1 = m.connect('sock-1');
    socket1.trigger('register-student', { studentId: 's1', name: 'Stu' });

    // Student refreshes page: socket2 connects and registers before socket1 disconnects
    const socket2 = m.connect('sock-2');
    socket2.trigger('register-student', { studentId: 's1', name: 'Stu' });

    m.globalEmitted.length = 0;
    // Old socket1 finally disconnects
    socket1.trigger('disconnect', undefined);

    // Stale disconnect should NOT broadcast empty presence or remove student
    expect(m.globalEmitted).toEqual([]);

    // Now when active socket2 disconnects, presence is removed
    socket2.trigger('disconnect', undefined);
    expect(m.globalEmitted).toEqual([
      { scope: 'global', event: 'presence-update', payload: { onlineStudentIds: [], activeStudentLessons: {} } },
    ]);
  });

  it('request-presence sends the current presence-update to the requesting socket', () => {
    const m = buildMocks();
    const socket1 = m.connect('sock-1');
    socket1.trigger('register-student', { studentId: 's1', name: 'Stu' });

    const socket2 = m.connect('sock-2');
    socket2._emitted.length = 0;
    socket2.trigger('request-presence', undefined);

    expect(socket2._emitted).toEqual([
      {
        scope: 'socket',
        event: 'presence-update',
        payload: { onlineStudentIds: ['s1'], activeStudentLessons: {} },
      },
    ]);
  });

  describe('班级房间（课堂广播不依赖学生当前视图）', () => {
    it('joins one class-<id> room per class the student belongs to on register-student', () => {
      const m = buildMocks({ studentClassIds: { s1: ['c1', 'c2'] } });
      const socket = m.connect();

      socket.trigger('register-student', { studentId: 's1', name: 'Stu' });

      expect(socket._joinedRooms).toEqual(['class-c1', 'class-c2']);
    });

    it('still registers presence when the class lookup fails', () => {
      const m = buildMocks({ lookupThrows: true });
      const socket = m.connect();
      socket._emitted.length = 0;

      socket.trigger('register-student', { studentId: 's1', name: 'Stu' });

      expect(m.globalEmitted).toEqual([
        { scope: 'global', event: 'presence-update', payload: { onlineStudentIds: ['s1'], activeStudentLessons: {} } },
      ]);
    });

    it('teacher-broadcast-fullscreen reaches both the lesson room and the class room', () => {
      const m = buildMocks();
      const socket = m.connect();
      m.globalEmitted.length = 0;

      socket.trigger('teacher-broadcast-fullscreen', { classId: 'c1', lessonId: 'L1', elementId: 'el-1' });

      expect(m.globalEmitted).toEqual([
        {
          scope: 'room',
          room: 'L1',
          event: 'whiteboard-fullscreen-changed',
          payload: { lessonId: 'L1', elementId: 'el-1', mode: 'board' },
        },
        {
          scope: 'room',
          room: 'class-c1',
          event: 'whiteboard-fullscreen-changed',
          payload: { lessonId: 'L1', elementId: 'el-1', mode: 'board' },
        },
      ]);
    });

    it('teacher-broadcast-fullscreen falls back to the lesson room when no class is given', () => {
      const m = buildMocks();
      const socket = m.connect();
      m.globalEmitted.length = 0;

      socket.trigger('teacher-broadcast-fullscreen', { lessonId: 'L1', elementId: null });

      expect(m.globalEmitted).toEqual([
        {
          scope: 'room',
          room: 'L1',
          event: 'whiteboard-fullscreen-changed',
          payload: { lessonId: 'L1', elementId: null, mode: 'board' },
        },
      ]);
    });
  });

  describe('SEC-AUTH: join-room / 白板信令 / 答到归属校验', () => {
    const teacherSession = { userId: 'usr_t', role: 'teacher' };
    const studentSession = { userId: 's1', role: 'student' };

    it('常驻广播房间任何已连接客户端均可加入', () => {
      const m = buildMocks();
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('join-room', 'whiteboard-broadcast');
      socket.trigger('join-room', 'classroom-broadcast');
      expect(socket._joinedRooms).toEqual(['whiteboard-broadcast', 'classroom-broadcast']);
    });

    it('学生可加入自己所属的班级房间，跨班被拒', () => {
      const m = buildMocks({ studentClassIds: { s1: ['c1'] } });
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('join-room', 'class-c1');
      socket.trigger('join-room', 'class-c2');
      expect(socket._joinedRooms).toEqual(['class-c1']);
      expect(socket._emitted.some((e: Emitted) => e.event === 'error')).toBe(true);
    });

    it('教师可加入任意班级与课节房间', () => {
      const m = buildMocks({ studentClassIds: { s1: ['c1'] } });
      const socket = m.connect('sock-1', teacherSession);
      socket.trigger('join-room', 'class-c9');
      socket.trigger('join-room', 'L1');
      expect(socket._joinedRooms).toEqual(['class-c9', 'L1']);
    });

    it('学生加入开课课节房间须属于开课班级；未开课课节不设限', () => {
      const m = buildMocks({
        studentClassIds: { s1: ['c1'] },
        lessonClassIds: { L_live: 'c9', L_self: null },
      });
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('join-room', 'L_live'); // 开课班级 c9 ≠ 学生班级 c1 → 拒
      socket.trigger('join-room', 'L_self'); // 无课堂会话 → 允许（自学）
      expect(socket._joinedRooms).toEqual(['L_self']);
    });

    it('学生可加入绑定自己的作业伪课节房间，他人的被拒', () => {
      const m = buildMocks();
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('join-room', 'assignment-a1-student-s1');
      socket.trigger('join-room', 'assignment-a1-student-s2');
      expect(socket._joinedRooms).toEqual(['assignment-a1-student-s1']);
    });

    it('无会话 socket（测试环境握手豁免口径）不设限', () => {
      const m = buildMocks();
      const socket = m.connect();
      socket.trigger('join-room', 'class-anything');
      expect(socket._joinedRooms).toEqual(['class-anything']);
    });

    it('enter-lesson 对开课课节做同样的班级归属校验', () => {
      const m = buildMocks({
        studentClassIds: { s1: ['c1'] },
        lessonClassIds: { L_live: 'c9' },
      });
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('register-student', { studentId: 's1', name: 'Stu' });
      socket._joinedRooms.length = 0;
      socket.trigger('enter-lesson', { studentId: 's1', lessonId: 'L_live' });
      expect(socket._joinedRooms).toEqual([]); // 未 join 课节房间（register-student join 的班级房间已清空重计）
      expect(socket._emitted.some((e: Emitted) => e.event === 'error')).toBe(true);
    });

    it('whiteboard-update：教师放行，学生仅可写自己的伪课节房间', () => {
      const m = buildMocks();
      const teacher = m.connect('sock-t', teacherSession);
      teacher.trigger('whiteboard-update', { roomId: 'L1', type: 'temp-draw', payload: {} });
      expect(teacher._emitted.filter((e: Emitted) => e.scope === 'socket-room')).toHaveLength(1);

      const student = m.connect('sock-s', studentSession);
      student.trigger('whiteboard-update', { roomId: 'assignment-a1-student-s1', type: 'temp-draw', payload: {} });
      expect(student._emitted.filter((e: Emitted) => e.scope === 'socket-room')).toHaveLength(1);

      student.trigger('whiteboard-update', { roomId: 'L1', type: 'temp-draw', payload: {} });
      student.trigger('whiteboard-update', { roomId: 'assignment-a1-student-s2', type: 'temp-draw', payload: {} });
      expect(student._emitted.filter((e: Emitted) => e.scope === 'socket-room')).toHaveLength(1); // 仍只有自己房间那条
    });

    it('whiteboard-event：学生向课节房间注入 refresh 被拒（EventBus 也不写）', () => {
      const m = buildMocks();
      const socket = m.connect('sock-1', studentSession);
      socket._emitted.length = 0; // 清掉连接时的初始 presence-update
      socket.trigger('whiteboard-event', {
        type: 'whiteboard.element_drawn',
        payload: { lessonId: 'L1', elementId: 'e1' },
        id: 'x',
        timestamp: 1,
      });
      expect(m.eventBus.publish).not.toHaveBeenCalled();
      expect(socket._emitted).toEqual([]);
    });

    it('student-acknowledge-pick：学生只能以本人身份确认答到', () => {
      const m = buildMocks();
      const socket = m.connect('sock-1', studentSession);
      socket.trigger('student-acknowledge-pick', { studentId: 's2', lessonId: 'L1' });
      expect(m.globalEmitted.filter((e: Emitted) => e.event === 'student-acknowledged')).toHaveLength(0);

      socket.trigger('student-acknowledge-pick', { studentId: 's1', lessonId: 'L1' });
      expect(m.globalEmitted.filter((e: Emitted) => e.event === 'student-acknowledged')).toHaveLength(1);
    });
  });

  describe('student-client-error telemetry', () => {
    it('publishes error to eventBus and broadcasts student-error-alert to clients', async () => {
      const m = buildMocks();
      const socket = m.connect();
      m.globalEmitted.length = 0;

      const errorPayload = {
        id: 'err-123',
        type: 'runtime',
        title: 'Component Error',
        message: 'TypeError in Whiteboard',
        timestamp: 1774000000000,
      };

      socket.trigger('student-client-error', {
        studentId: 's1',
        studentName: 'Alice',
        lessonId: 'L1',
        classId: 'c1',
        error: errorPayload,
      });

      // 1. Verify EventBus publish was called with audit record
      expect(m.eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'student.client_error',
          source: 'student_client',
          correlationId: 'L1',
          payload: {
            studentId: 's1',
            studentName: 'Alice',
            lessonId: 'L1',
            classId: 'c1',
            error: errorPayload,
          },
        }),
      );

      // 2. Verify global broadcast of student-error-alert
      expect(m.globalEmitted).toContainEqual({
        scope: 'global',
        event: 'student-error-alert',
        payload: {
          studentId: 's1',
          studentName: 'Alice',
          lessonId: 'L1',
          classId: 'c1',
          error: errorPayload,
        },
      });
    });
  });
});
