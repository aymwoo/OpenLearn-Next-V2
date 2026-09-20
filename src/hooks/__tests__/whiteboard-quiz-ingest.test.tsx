/**
 * @vitest-environment jsdom
 *
 * Verifies the socket → WhiteboardEventSlot wiring for quiz submissions:
 *   server emits `whiteboard-quiz-answered` → useClassroomSocket listener ingests
 *   into WhiteboardEventSlot with source='widget.quiz' and type='quiz.answered'.
 *
 * This is the frontend side of the `/api/lessons/:id/quiz-submit` pipeline
 * (server emits at server/routes/lessons.ts:590 after persisting the answer).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useClassroomSocket } from '../useClassroomSocket';
import { whiteboardEventSlot } from '../../features/whiteboard/events';

interface SocketHandler {
  (data: any): void;
}

class MockSocket {
  private handlers = new Map<string, Set<SocketHandler>>();
  emit = vi.fn();
  disconnect = vi.fn();
  on(event: string, handler: SocketHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: SocketHandler) {
    this.handlers.get(event)?.delete(handler);
  }
  fire(event: string, data: any) {
    for (const h of this.handlers.get(event) || []) h(data);
  }
  listenerCount(event: string) {
    return this.handlers.get(event)?.size || 0;
  }
}

let mockSocket: MockSocket;

vi.mock('socket.io-client', () => ({
  io: () => mockSocket,
}));

vi.mock('../../services/socket-service', () => ({
  setSocketInstance: vi.fn(),
  SocketService: class {},
}));

vi.mock('../../services/frontend-api', () => ({ FrontendAPIService: class {} }));
vi.mock('../../services/ui-service', () => ({ UIService: class {} }));
vi.mock('../../services/storage-service', () => ({ StorageService: class {} }));
vi.mock('../../store/whiteboardViewStore', () => ({
  whiteboardViewStore: {
    getState: () => ({ setRemoteFullscreenElementId: vi.fn(), remoteFullscreenElementId: null }),
  },
}));

const baseOptions: any = {
  session: { studentId: 'stu-1' },
  host: { isInitialized: () => true, initialize: vi.fn() },
  activeRole: 'teacher' as const,
  activeStudentId: 'stu-1',
  selectedLesson: 'L-001',
  activeSegmentId: null,
  studentViewStatus: 'dashboard' as const,
  lang: 'zh' as const,
  students: [],
  addToast: vi.fn(),
  setOnlineStudentIds: vi.fn(),
  setActiveStudentLessons: vi.fn(),
  setLessons: vi.fn(),
  setActiveSegmentId: vi.fn(),
  setLiveClassStudentProgress: vi.fn(),
  setLiveClassAcknowledgedMap: vi.fn(),
  setLiveClassFeed: vi.fn(),
  setSelectedLesson: vi.fn(),
  setStudentViewStatus: vi.fn(),
  studentLessonTab: 'whiteboard' as const,
  selectedAssignment: null,
  setSelectedAssignment: vi.fn(),
  fetchElements: vi.fn(),
  fetchStudentDashboard: vi.fn(),
  restoreInterruptedView: vi.fn(),
  interruptedViewRef: { current: null },
  selectedLessonRef: { current: 'L-001' },
  studentViewStatusRef: { current: 'dashboard' },
  studentLessonTabRef: { current: 'whiteboard' },
  setLocalProgressPercent: vi.fn(),
  setActiveSegmentIdRemote: vi.fn(),
};

describe('useClassroomSocket — whiteboard-quiz-answered → WhiteboardEventSlot', () => {
  beforeEach(() => {
    mockSocket = new MockSocket();
    whiteboardEventSlot.clear();
  });
  afterEach(() => {
    whiteboardEventSlot.clear();
  });

  it('listens to whiteboard-quiz-answered and ingests as quiz.answered', () => {
    renderHook(() => useClassroomSocket(baseOptions));

    expect(mockSocket.listenerCount('whiteboard-quiz-answered')).toBe(1);

    act(() => {
      mockSocket.fire('whiteboard-quiz-answered', {
        lessonId: 'L-001',
        elementId: 'el-1',
        studentId: 'stu-1',
        studentName: 'Alice',
        answer: 'B',
        score: 100,
        isCorrect: true,
        time: 1700000000000,
        correctAnswer: 'B',
        question: 'Q1',
      });
    });

    const events = whiteboardEventSlot.query({ types: ['quiz.answered'] });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.lessonId).toBe('L-001');
    expect(e.elementId).toBe('el-1');
    expect(e.studentId).toBe('stu-1');
    expect(e.studentName).toBe('Alice');
    expect(e.source).toBe('widget.quiz');
    expect(e.type).toBe('quiz.answered');
    expect(e.payload.answer).toBe('B');
    expect(e.payload.score).toBe(100);
    expect(e.payload.isCorrect).toBe(true);
    expect(e.payload.correctAnswer).toBe('B');
    expect(e.payload.question).toBe('Q1');
  });

  it('accepts string score and does not throw', () => {
    renderHook(() => useClassroomSocket(baseOptions));

    expect(() =>
      act(() => {
        mockSocket.fire('whiteboard-quiz-answered', {
          lessonId: 'L-001',
          elementId: 'el-2',
          studentId: 'stu-2',
          score: '85', // string form
          isCorrect: false,
          time: Date.now(),
        });
      }),
    ).not.toThrow();

    const events = whiteboardEventSlot.query({ types: ['quiz.answered'] });
    expect(events).toHaveLength(1);
    expect(events[0].payload.score).toBeUndefined(); // only number is preserved
  });

  it('survives malformed payload (null/undefined) without throwing', () => {
    renderHook(() => useClassroomSocket(baseOptions));

    expect(() =>
      act(() => {
        mockSocket.fire('whiteboard-quiz-answered', null);
        mockSocket.fire('whiteboard-quiz-answered', undefined);
      }),
    ).not.toThrow();

    // No events should be ingested for null/undefined
    const events = whiteboardEventSlot.query({ types: ['quiz.answered'] });
    expect(events).toHaveLength(0);
  });

  it('unmount removes the listener (socket.disconnect is called)', () => {
    const { unmount } = renderHook(() => useClassroomSocket(baseOptions));
    expect(mockSocket.disconnect).not.toHaveBeenCalled();

    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('ingested events appear in subsequent query({lessonId})', () => {
    renderHook(() => useClassroomSocket(baseOptions));

    act(() => {
      mockSocket.fire('whiteboard-quiz-answered', {
        lessonId: 'L-999',
        elementId: 'el-x',
        studentId: 'stu-x',
        score: 60,
        isCorrect: false,
        time: Date.now(),
      });
    });

    const matching = whiteboardEventSlot.query({ lessonId: 'L-999' });
    const nonMatching = whiteboardEventSlot.query({ lessonId: 'L-001' });
    expect(matching).toHaveLength(1);
    expect(nonMatching).toHaveLength(0);
  });
});
