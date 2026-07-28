import { describe, it, expect, vi } from 'vitest';
import { setupRealtimeBridge, type RealtimeBridgeDeps } from '../realtime-bridge.js';

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
      handler({ type: eventType, payload });
    },
    runCallsFor: (prefix: string) => runCalls.filter((c) => c.sql.startsWith(prefix)),
  };
}

const TITLE_SQL = 'SELECT title FROM assignments WHERE id = ?';
const ELEMENT_SQL = 'SELECT * FROM whiteboard_elements WHERE id = ?';
const SCHEDULE_SQL = 'SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1';
const ROLLCALL_EXISTS_SQL = 'SELECT id FROM student_rollcalls WHERE id = ?';
const ROLLCALL_INSERT_SQL = 'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)';

describe('setupRealtimeBridge', () => {
  it('forwards assignment.graded to a toast with the resolved assignment title', () => {
    const m = buildMocks();
    m.setup();
    m.seedGet.set(TITLE_SQL, { title: 'Midterm' });

    m.publish('assignment.graded', { assignmentId: 'a1', studentId: 's1', score: 95, feedback: 'good' });

    expect(m.emitted).toEqual([
      {
        scope: 'global',
        event: 'assignment-graded-toast',
        payload: { assignmentId: 'a1', assignmentTitle: 'Midterm', studentId: 's1', score: 95, feedback: 'good' },
      },
    ]);
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

    expect(m.emitted).toEqual([
      { scope: 'room', room: 'L1', event: 'whiteboard-sync', payload: { roomId: 'L1', type: 'refresh' } },
      { scope: 'room', room: 'whiteboard-broadcast', event: 'whiteboard-sync', payload: { roomId: 'L1', type: 'refresh' } },
    ]);
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
      data: JSON.stringify({ selectedStudent: { id: 's1', name: 'Stu' }, status: 'picked', classId: 'C1', pickedTime: '2026-01-02T03:04:05.000Z' }),
    });
    m.seedGet.set(ROLLCALL_EXISTS_SQL, { id: 'existing' });

    m.publish('whiteboard.element_updated', { elementId: 'el1' });

    // Verbatim behavior: student-picked is emitted only on first insert, so a
    // duplicate rollcall produces no emit and no insert.
    expect(m.runCallsFor(ROLLCALL_INSERT_SQL)).toHaveLength(0);
    expect(m.emitted.some((e) => e.event === 'student-picked')).toBe(false);
  });

  it('forwards batch_drawn, element_deleted, and cleared to lesson sync emits', () => {
    const m = buildMocks();
    m.setup();

    m.publish('whiteboard.batch_drawn', { lessonId: 'L2', count: 3 });
    m.publish('whiteboard.element_deleted', { lessonId: 'L2' });
    m.publish('whiteboard.cleared', { lessonId: 'L2' });

    expect(m.emitted).toEqual([
      { scope: 'room', room: 'L2', event: 'whiteboard-sync', payload: { roomId: 'L2', type: 'refresh' } },
      { scope: 'room', room: 'L2', event: 'whiteboard-sync', payload: { roomId: 'L2', type: 'refresh' } },
      { scope: 'room', room: 'L2', event: 'whiteboard-sync', payload: { roomId: 'L2', type: 'refresh' } },
    ]);
  });

  it('forwards both spotlight event spellings verbatim', () => {
    const m = buildMocks();
    m.setup();

    const payload = { active: true };
    m.publish('spotlight:state_updated', payload);
    m.publish('spotlight.state_updated', payload);

    expect(m.emitted).toEqual([
      { scope: 'global', event: 'spotlight:state_updated', payload },
      { scope: 'global', event: 'spotlight:state_updated', payload },
    ]);
  });
});
