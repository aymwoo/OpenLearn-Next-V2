import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 教师端广播的白板最大化视图必须由 `useClassroomSocket` 处理：
 * 白板组件在学生切到「互动课件 / 作业」标签页时会卸载，
 * 因此接收与状态落库必须在 App 层完成，否则同步视图会丢失。
 *
 * 事件由服务端投递到课节房间 **和** 班级房间，所以学生无论在课节白板、
 * 互动课件、作业标签页还是作业工作区都能收到。
 */

const { socketHandlers, fakeSocket } = vi.hoisted(() => {
  const socketHandlers = new Map<string, (...args: unknown[]) => void>();
  return {
    socketHandlers,
    fakeSocket: {
      id: 'sock-1',
      on: (event: string, handler: (...args: unknown[]) => void) => {
        socketHandlers.set(event, handler);
      },
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

import { useClassroomSocket, type UseClassroomSocketOptions } from '../useClassroomSocket';
import { whiteboardViewStore } from '../../store/whiteboardViewStore';

const STUDENT_SESSION = { role: 'student', studentId: 'stu-1', name: 'Alice' } as never;
const ASSIGNMENT = { id: 'a1', class_id: 'c1', title: 'HW1' };

function makeOptions(overrides: Partial<UseClassroomSocketOptions> = {}): UseClassroomSocketOptions {
  return {
    session: STUDENT_SESSION,
    host: { isInitialized: () => true, initialize: vi.fn() },
    activeRole: 'student',
    activeStudentId: 'stu-1',
    selectedLesson: 'l1',
    activeSegmentId: null,
    studentViewStatus: 'lesson',
    studentLessonTab: 'whiteboard',
    selectedAssignment: null,
    lang: 'zh',
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
    setStudentLessonTab: vi.fn(),
    setSelectedAssignment: vi.fn(),
    setLocalProgressPercent: vi.fn(),
    fetchStudentDashboard: vi.fn(),
    fetchStudents: vi.fn(),
    fetchElements: vi.fn(),
    ...overrides,
  } as UseClassroomSocketOptions;
}

/** 触发注册在 socket 上的某个处理器 */
function trigger(event: string, payload?: unknown) {
  const handler = socketHandlers.get(event);
  expect(handler, `no handler registered for ${event}`).toBeTruthy();
  act(() => {
    handler?.(payload);
  });
}

const maximize = (elementId = 'el-quiz-1', lessonId = 'l1') =>
  trigger('whiteboard-fullscreen-changed', { lessonId, elementId });
const exitFullscreen = (lessonId = 'l1') => trigger('whiteboard-fullscreen-changed', { lessonId, elementId: null });

describe('useClassroomSocket — 教师端最大化视图同步', () => {
  beforeEach(() => {
    socketHandlers.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    whiteboardViewStore.getState().setRemoteFullscreenElementId(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('进入同步最大化视图', () => {
    it('stores the remote element id and forces the student onto the whiteboard', () => {
      const options = makeOptions();
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBe('el-quiz-1');
      expect(options.setStudentLessonTab).toHaveBeenCalledWith('whiteboard');
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('lesson');
      expect(options.setSelectedLesson).toHaveBeenCalledWith('l1');
      expect(options.fetchElements).toHaveBeenCalledWith('l1');
    });

    it('pulls a student out of the assignment workspace and stashes the assignment', () => {
      const options = makeOptions({
        selectedLesson: null,
        studentViewStatus: 'assignment',
        studentLessonTab: 'whiteboard',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(options.setStudentViewStatus).toHaveBeenCalledWith('lesson');
      // 作业上下文被暂存起来（避免与课节白板 elements 互相覆盖）
      expect(options.setSelectedAssignment).toHaveBeenCalledWith(null);
    });

    it('does not interrupt a student self-studying a different lesson', () => {
      const options = makeOptions({ selectedLesson: 'l2' });
      renderHook(() => useClassroomSocket(options));

      maximize('el-quiz-1', 'l1');

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentLessonTab).not.toHaveBeenCalled();
    });

    it('does not interrupt a student sitting on the dashboard', () => {
      const options = makeOptions({ studentViewStatus: 'dashboard' });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentViewStatus).not.toHaveBeenCalled();
    });

    it('ignores fullscreen broadcasts for non-student roles', () => {
      const options = makeOptions({ activeRole: 'teacher', session: { role: 'teacher' } as never });
      renderHook(() => useClassroomSocket(options));

      maximize();

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentLessonTab).not.toHaveBeenCalled();
    });

    it('keeps the original interrupted view when the teacher maximizes a second component', () => {
      const options = makeOptions({ studentViewStatus: 'assignment', selectedAssignment: ASSIGNMENT });
      renderHook(() => useClassroomSocket(options));

      maximize('el-quiz-1');
      maximize('el-quiz-2');
      exitFullscreen();

      // 恢复到最初被中断的作业工作区，而不是两次 maximize 之间的白板状态
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('assignment');
      expect(options.setSelectedAssignment).toHaveBeenLastCalledWith(ASSIGNMENT);
    });
  });

  describe('教师退出最大化后恢复被中断的视图', () => {
    it('restores the previously selected tab for a lesson-view interruption', () => {
      const options = makeOptions({ studentLessonTab: 'courseware' });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentLessonTab).mockClear();
      exitFullscreen();

      expect(options.setStudentLessonTab).toHaveBeenCalledWith('courseware');
      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
    });

    it('restores the assignment workspace and its assignment object', () => {
      const options = makeOptions({
        selectedLesson: null,
        studentViewStatus: 'assignment',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentViewStatus).mockClear();
      vi.mocked(options.setSelectedAssignment).mockClear();
      exitFullscreen();

      expect(options.setSelectedAssignment).toHaveBeenCalledWith(ASSIGNMENT);
      expect(options.setStudentViewStatus).toHaveBeenCalledWith('assignment');
    });

    it('restores the assignment workspace tab and lesson after an assignment-tab interruption', () => {
      const options = makeOptions({
        selectedLesson: 'l9',
        studentViewStatus: 'assignment',
        studentLessonTab: 'assignment',
        selectedAssignment: ASSIGNMENT,
      });
      renderHook(() => useClassroomSocket(options));

      maximize();
      vi.mocked(options.setStudentLessonTab).mockClear();
      vi.mocked(options.setSelectedLesson).mockClear();
      exitFullscreen();

      expect(options.setStudentLessonTab).toHaveBeenCalledWith('assignment');
      expect(options.setSelectedLesson).toHaveBeenCalledWith('l9');
    });

    it('is a no-op when the student was never interrupted', () => {
      const options = makeOptions();
      renderHook(() => useClassroomSocket(options));

      exitFullscreen();

      expect(options.setStudentViewStatus).not.toHaveBeenCalled();
      expect(options.setSelectedAssignment).not.toHaveBeenCalled();
    });
  });

  describe('安全网', () => {
    it('clears the remote fullscreen and restores the view on reconnect', () => {
      const options = makeOptions({ selectedLesson: 'l9', studentViewStatus: 'assignment' });
      renderHook(() => useClassroomSocket(options));
      maximize();
      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBe('el-quiz-1');

      trigger('connect');

      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
      expect(options.setStudentViewStatus).toHaveBeenLastCalledWith('assignment');
    });
  });

  it('still handles refresh events without touching the fullscreen state', () => {
    const options = makeOptions();
    renderHook(() => useClassroomSocket(options));

    trigger('whiteboard-sync', { roomId: 'l1', type: 'refresh' });

    expect(options.fetchElements).toHaveBeenCalledWith('l1');
    expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
  });
});
