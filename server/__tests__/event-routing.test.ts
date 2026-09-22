import { describe, it, expect } from 'vitest';
import {
  SOCKET_ROUTES,
  WHITEBOARD_BROADCAST_ROOM,
  createRouteDispatcher,
  type RouteDb,
  type SocketRouteDeps,
} from '../event-routing.js';
import type { PlatformEvent } from '../../packages/core/event-bus/index.js';

type Emitted = { scope: 'global' | 'room'; room?: string; event: string; payload: unknown };

function buildDeps() {
  const emitted: Emitted[] = [];
  const io = {
    emit: (event: string, payload: unknown) => emitted.push({ scope: 'global', event, payload }),
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ scope: 'room', room, event, payload }),
    }),
  } as any;
  const db: RouteDb = { prepare: () => ({ get: () => undefined, run: () => undefined }) } as any;
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

  it('broadcasts classroom.lock_changed globally with event meta attached', () => {
    const { emitted, deps } = buildDeps();
    const dispatch = createRouteDispatcher(SOCKET_ROUTES, deps);

    dispatch(event('classroom.lock_changed', { classId: 'C1', lessonId: 'L1', locked: true }, 'C1'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('class-lock-status-changed');
    expect(emitted[0].scope).toBe('global');
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

  it('broadcasts courseware.attempt_updated globally', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(
      event('courseware.attempt_updated', { attemptId: 'att_1', type: 'submit' }, 'att_1'),
    );

    expect(emitted).toEqual([
      expect.objectContaining({
        scope: 'global',
        event: 'courseware-attempt-updated',
        payload: expect.objectContaining({ attemptId: 'att_1', type: 'submit' }),
      }),
    ]);
  });

  it('routes whiteboard.element_drawn to both the lesson room and the broadcast room', () => {
    const { emitted, deps } = buildDeps();
    createRouteDispatcher(SOCKET_ROUTES, deps)(event('whiteboard.element_drawn', { lessonId: 'L9', elementId: 'e1' }));

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ scope: 'room', room: 'L9', event: 'whiteboard-sync' });
    expect(emitted[1]).toMatchObject({
      scope: 'room',
      room: WHITEBOARD_BROADCAST_ROOM,
      event: 'whiteboard-sync',
    });
    expect(emitted[0].payload).toMatchObject({ roomId: 'L9', type: 'refresh' });
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
