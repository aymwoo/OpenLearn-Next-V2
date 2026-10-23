import { describe, it, expect } from 'vitest';
import {
  SOCKET_ROUTES,
  WHITEBOARD_BROADCAST_ROOM,
  createRouteDispatcher,
  type RouteDb,
  type SocketRouteDeps,
} from '../event-routing.js';
import { PRESENCE_STAFF_ROOM, userRoom } from '../presence.js';
import type { PlatformEvent } from '../../packages/core/event-bus/index.js';

type Emitted = { scope: 'global' | 'room'; rooms?: string | string[]; event: string; payload: unknown };

function buildDeps(dbGet: (sql: string) => unknown = () => undefined) {
  const emitted: Emitted[] = [];
  const io = {
    emit: (event: string, payload: unknown) => emitted.push({ scope: 'global', event, payload }),
    to: (rooms: string | string[]) => ({
      emit: (event: string, payload: unknown) => emitted.push({ scope: 'room', rooms, event, payload }),
    }),
  } as any;
  const db: RouteDb = { prepare: (sql: string) => ({ get: () => dbGet(sql), run: () => undefined }) } as any;
  const deps: SocketRouteDeps = { io, db };
  return { emitted, io, db, deps };
}

function event(type: string, payload: unknown, correlationId?: string): PlatformEvent {
  return {
    id: `evt_${type}`,
    type,
    source: 'test',
    payload,
    timestamp: 1000,
    correlationId,
  };
}

function meta(payload: unknown) {
  return (payload as Record<string, unknown>)._meta as Record<string, unknown>;
}

describe('SOCKET_ROUTES', () => {
  it('declares each kernel event type exactly once', () => {
    const types = SOCKET_ROUTES.map((r) => r.eventType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('covers every classroom event that used to bypass the bus', () => {
    const types = new Set(SOCKET_ROUTES.map((r) => r.eventType));
    for (const type of [
      'classroom.lock_changed',
      'student.progress_updated',
      'student.notification_acknowledged',
      'whiteboard.quiz_answered',
      'courseware.attempt_updated',
      'lesson.progress_mode_changed',
    ]) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('rejects duplicate registrations instead of silently overriding', () => {
    const route = SOCKET_ROUTES[0];
    expect(() => createRouteDispatcher([route, route], buildDeps().deps)).toThrow(/duplicate socket route/);
  });
});

describe('createRouteDispatcher', () => {
  it('ignores event types with no declared route', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('some.undeclared_event', { a: 1 }));
    expect(emitted).toHaveLength(0);
  });

  it('routes classroom.lock_changed to the class + lesson rooms with event meta attached', () => {
    const { emitted, deps } = buildDeps();
    const dispatch = createRouteDispatcher(SOCKET_ROUTES, deps);

    dispatch(event('classroom.lock_changed', { classId: 'C1', lessonId: 'L1', locked: true }, 'C1'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('class-lock-status-changed');
    expect(emitted[0].scope).toBe('room');
    expect(emitted[0].rooms).toEqual(['L1', 'class-C1']);
    expect(emitted[0].payload).toMatchObject({ classId: 'C1', lessonId: 'L1', locked: true });
    // 元信息守恒：前端可据此去重、排序、串联业务流
    expect(meta(emitted[0].payload)).toEqual({
      eventId: 'evt_classroom.lock_changed',
      type: 'classroom.lock_changed',
      source: 'test',
      timestamp: 1000,
      correlationId: 'C1',
    });
  });

  it('routes courseware.attempt_updated to the attempt owner + staff room', () => {
    const { emitted, deps } = buildDeps((sql) =>
      sql.includes('courseware_attempt') ? { student_id: 'stu_1' } : undefined,
    );
    createRouteDispatcher(
      SOCKET_ROUTES,
      deps,
    )(event('courseware.attempt_updated', { attemptId: 'att_1', type: 'submit' }, 'att_1'));

    expect(emitted).toEqual([
      expect.objectContaining({
        scope: 'room',
        rooms: [userRoom('stu_1'), PRESENCE_STAFF_ROOM],
        event: 'courseware-attempt-updated',
        payload: expect.objectContaining({ attemptId: 'att_1', type: 'submit' }),
      }),
    ]);
  });

  it('falls back to the staff room when a courseware attempt has no owner', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(
      SOCKET_ROUTES,
      deps,
    )(event('courseware.attempt_updated', { attemptId: 'att_guest', type: 'log' }, 'att_guest'));

    expect(emitted[0]).toMatchObject({ scope: 'room', rooms: [PRESENCE_STAFF_ROOM] });
  });

  it('routes whiteboard.element_drawn to the lesson + broadcast rooms in one union emit', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('whiteboard.element_drawn', { lessonId: 'L9', elementId: 'e1' }));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      scope: 'room',
      rooms: ['L9', WHITEBOARD_BROADCAST_ROOM],
      event: 'whiteboard-sync',
    });
    expect(emitted[0].payload).toMatchObject({ roomId: 'L9', type: 'refresh' });
  });

  it('delivers assignment.graded only to the graded student', () => {
    const { emitted, deps } = buildDeps((sql) => (sql.includes('assignments') ? { title: 'Midterm' } : undefined));
    createRouteDispatcher(
      SOCKET_ROUTES,
      deps,
    )(event('assignment.graded', { assignmentId: 'a1', studentId: 's1', score: 95 }, 'a1'));

    expect(emitted).toEqual([
      expect.objectContaining({
        scope: 'room',
        rooms: [userRoom('s1')],
        event: 'assignment-graded-toast',
        payload: expect.objectContaining({ studentId: 's1', score: 95, assignmentTitle: 'Midterm' }),
      }),
    ]);
  });

  it('delivers points.awarded to the awarded student + staff room', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('points.awarded', { studentId: 's1', deltaPoints: 5 }, 's1'));

    expect(emitted[0]).toMatchObject({
      scope: 'room',
      rooms: [userRoom('s1'), PRESENCE_STAFF_ROOM],
      event: 'classroom:points_awarded',
    });
  });

  it('delivers student.progress_updated to the lesson + class + student user room', () => {
    const { emitted, deps } = buildDeps((sql) =>
      sql.includes('classroom_sessions') ? { class_id: 'C1', stage: 'IN_CLASS_TEACHING' } : undefined,
    );
    createRouteDispatcher(
      SOCKET_ROUTES,
      deps,
    )(event('student.progress_updated', { studentId: 's1', lessonId: 'L1', progressPercent: 60 }, 'L1'));

    expect(emitted[0]).toMatchObject({
      scope: 'room',
      rooms: ['L1', 'class-C1', userRoom('s1')],
      event: 'student-progress-updated',
    });
  });

  it('delivers student-picked only to the lesson + class + picked student', () => {
    const pickedTime = '2026-01-02T03:04:05.000Z';
    const { emitted, deps } = buildDeps((sql) => {
      if (sql.includes('whiteboard_elements')) {
        return {
          type: 'rollcall',
          lesson_id: 'L1',
          data: JSON.stringify({
            selectedStudent: { id: 's1', name: 'Stu' },
            status: 'picked',
            classId: 'C1',
            pickedTime,
          }),
        };
      }
      return undefined;
    });
    createRouteDispatcher(
      SOCKET_ROUTES,
      deps,
    )(event('whiteboard.element_drawn', { type: 'rollcall', elementId: 'el1', lessonId: 'L1' }));

    const picked = emitted.find((e) => e.event === 'student-picked');
    expect(picked).toMatchObject({
      scope: 'room',
      rooms: ['L1', 'class-C1', userRoom('s1')],
      payload: expect.objectContaining({ studentId: 's1', classId: 'C1', lessonId: 'L1' }),
    });
    expect(emitted.some((e) => e.scope === 'global')).toBe(false);
  });

  it('sends no socket message when the room list is empty (effect-only route)', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('whiteboard.element_updated', { elementId: 'e1' }));
    expect(emitted).toHaveLength(0);
  });

  it('skips delivery when the payload carries no lessonId', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('whiteboard.element_deleted', {}));
    expect(emitted).toHaveLength(0);
  });

  it('does not wrap non-object payloads just to attach meta', () => {
    const { emitted, deps } = buildDeps();
    const routes = [
      {
        eventType: 'test.primitive',
        socketEvent: 'test-primitive',
        rooms: () => null,
        description: 'primitive payload',
      },
    ];
    createRouteDispatcher(routes, deps)(event('test.primitive', 42));
    expect(emitted[0].payload).toBe(42);
  });

  it('keeps dispatching after a route throws', () => {
    const { emitted, deps } = buildDeps();
    const routes = [
      {
        eventType: 'test.boom',
        socketEvent: 'test-boom',
        rooms: () => {
          throw new Error('room resolution failed');
        },
        description: 'throwing route',
      },
    ];
    const dispatch = createRouteDispatcher(routes, deps);
    expect(() => dispatch(event('test.boom', {}))).not.toThrow();
    expect(emitted).toHaveLength(0);
  });
});
