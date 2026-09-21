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
function buildMocks(opts: { studentClassIds?: Record<string, string[]>; lookupThrows?: boolean } = {}) {
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
  } as any;
  setupPresence(deps);

  function connect() {
    const socketEmitted: Emitted[] = [];
    const joinedRooms: string[] = [];
    const socketHandlers = new Map<string, (data: any) => void>();
    const socket = {
      id: 'sock-1',
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

    const updates = m.globalEmitted.filter((e) => e.event === 'presence-update');
    expect(updates[updates.length - 1]).toMatchObject({
      payload: { onlineStudentIds: ['s1'], activeStudentLessons: { s1: 'L1' } },
    });
    // segment map empty → no student-active-segment-changed (neither socket nor global)
    expect(socket._emitted.find((e) => e.event === 'student-active-segment-changed')).toBeUndefined();
    expect(m.globalEmitted.some((e) => e.event === 'student-active-segment-changed')).toBe(false);
  });

  it('whiteboard-event publishes to the event bus and emits whiteboard-sync to the raw lessonId room', () => {
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
    expect(socket._emitted).toEqual([
      {
        scope: 'socket-room',
        room: 'L1',
        event: 'whiteboard-sync',
        payload: { type: 'refresh', sourceEvent: 'whiteboard.element_drawn' },
      },
    ]);
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
          payload: { lessonId: 'L1', elementId: 'el-1' },
        },
        {
          scope: 'room',
          room: 'class-c1',
          event: 'whiteboard-fullscreen-changed',
          payload: { lessonId: 'L1', elementId: 'el-1' },
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
          payload: { lessonId: 'L1', elementId: null },
        },
      ]);
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

