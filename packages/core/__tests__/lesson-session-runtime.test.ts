import { describe, it, expect } from 'vitest';
import {
  LessonSessionManager,
  LessonSessionContext,
} from '../bootstrap/lesson-session/index.js';

describe('Sprint A2 Lesson Session Runtime Test Suite', () => {
  const mockContext: LessonSessionContext = {
    sessionId: 'sess_123',
    lessonId: 'lesson_math_101',
    teacherId: 'teacher_smith',
    studentIds: ['student_alice', 'student_bob'],
    courseId: 'course_math',
  };

  it('should create and manage LessonSession lifecycle state transitions', () => {
    const manager = new LessonSessionManager();
    const session = manager.createSession(mockContext);

    expect(session.state).toBe('Created');
    expect(session.sessionId).toBe('sess_123');

    session.prepare();
    expect(session.state).toBe('Preparing');

    session.start();
    expect(session.state).toBe('Running');

    session.pause();
    expect(session.state).toBe('Paused');

    session.resume();
    expect(session.state).toBe('Running');

    session.complete();
    expect(session.state).toBe('Completed');

    session.archive();
    expect(session.state).toBe('Archived');
  });

  it('should attach AI, Whiteboard, Plugin, and Analytics contexts to LessonSession', () => {
    const manager = new LessonSessionManager();
    const session = manager.createSession(mockContext);

    const mockAI = { provider: 'openai' };
    const mockWB = { id: 'wb_math' };
    const mockPlugin = { activeCount: 2 };
    const mockAnalytics = { tracking: true };

    session.attachAIContext(mockAI);
    session.attachWhiteboard(mockWB);
    session.attachPluginContext(mockPlugin);
    session.attachAnalyticsContext(mockAnalytics);

    expect(session.context.aiContextRef).toBe(mockAI);
    expect(session.context.whiteboardRef).toBe(mockWB);
    expect(session.context.pluginContextRef).toBe(mockPlugin);
    expect(session.context.analyticsContextRef).toBe(mockAnalytics);
  });

  it('should handle session manager operations and session disposal', () => {
    const manager = new LessonSessionManager();
    manager.createSession(mockContext);

    expect(manager.findSession('sess_123')).toBeDefined();

    manager.startSession('sess_123');
    expect(manager.findSession('sess_123')?.state).toBe('Running');

    manager.disposeSession('sess_123');
    expect(manager.findSession('sess_123')).toBeUndefined();
  });

  it('should throw error on invalid state transitions', () => {
    const manager = new LessonSessionManager();
    const session = manager.createSession(mockContext);

    expect(() => session.resume()).toThrow('Invalid state transition');
  });
});
