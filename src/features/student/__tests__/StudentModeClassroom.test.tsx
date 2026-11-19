import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonView, type StudentLessonViewProps } from '../StudentLessonView';
import {
  guardStudentFlow,
  STUDENT_SEGMENT_GUARD_ERROR,
  STUDENT_STAGE_GUARD_ERROR,
} from '../mode-classroom/studentFlowGuard';
import type { ClassroomFlowController } from '../../../plugin-host/types';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard" />,
}));

function makeProps(deliveryMode?: string | null): StudentLessonViewProps {
  return {
    students: [{ id: 's1', name: 'Alice', locked_lesson_id: null }] as unknown as StudentType[],
    activeStudentId: 's1',
    setStudentViewStatus: vi.fn(),
    setSelectedLesson: vi.fn(),
    lessons: [{ id: 'l1', title: '分数的意义', content: '# Hi', delivery_mode: deliveryMode }] as unknown as Lesson[],
    selectedLesson: 'l1',
    studentFullscreenPanel: 'none',
    setStudentFullscreenPanel: vi.fn(),
    timelineSegments: [{ id: 'seg-1', type: 'lecture', title: '认识分数' }],
    lang: 'zh',
    activeSegmentId: 'seg-1',
    setActiveSegmentId: vi.fn(),
    localProgressPercent: 0,
    setLocalProgressPercent: vi.fn(),
    updateStudentProgress: vi.fn(),
    isStudentLessonContentCollapsed: false,
    setIsStudentLessonContentCollapsed: vi.fn(),
    studentLessonTab: 'whiteboard',
    setStudentLessonTab: vi.fn(),
    elements: [],
    activeRole: 'student',
    fetchElements: vi.fn(),
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    vfsNodes: [],
    studentSelectedCourseware: null,
    setStudentSelectedCourseware: vi.fn(),
    addToast: vi.fn(),
  };
}

function renderLesson(deliveryMode?: string | null) {
  return render(
    <Suspense fallback={null}>
      <StudentLessonView {...makeProps(deliveryMode)} />
    </Suspense>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('segment-access')) {
        return { ok: true, json: async () => ({ allowed: true, gates: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('学生课堂按课程模式分流', () => {
  it('没有交付模式的旧课进入白板页', async () => {
    renderLesson(null);
    expect(screen.getByTestId('student-whiteboard-classroom')).toBeTruthy();
    expect(screen.queryByTestId('student-xuean-classroom')).toBeNull();
    expect(screen.getByTestId('student-learning-topic').textContent).toBe('认识分数');
    expect(await screen.findByTestId('lazy-whiteboard')).toBeTruthy();
    expect(screen.queryByText('Interactive Whiteboard')).toBeNull();
  });

  it('白板课进入白板页，学案课进入学案页', async () => {
    const { unmount } = renderLesson('whiteboard');
    expect(screen.getByTestId('student-whiteboard-classroom')).toBeTruthy();
    expect(screen.queryByTestId('student-xuean-classroom')).toBeNull();
    expect(await screen.findByTestId('lazy-whiteboard')).toBeTruthy();
    unmount();

    renderLesson('xuean');
    expect(screen.getByTestId('student-xuean-classroom')).toBeTruthy();
    expect(screen.queryByTestId('student-whiteboard-classroom')).toBeNull();
    expect(screen.queryByTestId('lazy-whiteboard')).toBeNull();
    expect((await screen.findByTestId('mode-xuean-workspace')).getAttribute('data-role')).toBe('student');
    expect(screen.getByTestId('student-learning-topic').textContent).toBe('认识分数');
  });

  it('打开再关闭侧栏后，课题和主学习面仍在', async () => {
    renderLesson('whiteboard');
    const topic = screen.getByTestId('student-learning-topic');
    const canvas = screen.getByTestId('student-whiteboard-canvas');
    await screen.findByTestId('lazy-whiteboard');

    expect(screen.getByTestId('student-tool-drawer').getAttribute('data-open')).toBe('false');
    expect(screen.queryByTestId('student-lesson-content-panel')).toBeNull();

    expect(screen.queryByTestId('student-tool-outline')).toBeNull();
    fireEvent.click(screen.getByTestId('student-whiteboard-tools'));
    fireEvent.click(screen.getByTestId('student-tool-outline'));
    expect(screen.getByTestId('student-tool-drawer').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('student-lesson-content-panel')).toBeTruthy();
    expect(topic.isConnected).toBe(true);
    expect(canvas.isConnected).toBe(true);
    expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();

    fireEvent.click(screen.getByTestId('student-tool-drawer-close'));
    expect(screen.getByTestId('student-tool-drawer').getAttribute('data-open')).toBe('false');
    expect(screen.queryByTestId('student-lesson-content-panel')).toBeNull();
    expect(topic.isConnected).toBe(true);
    expect(canvas.isConnected).toBe(true);
    expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();
  });

  it('学案页的环节侧栏可以关掉，学案正文还在', async () => {
    renderLesson('xuean');
    const topic = screen.getByTestId('student-learning-topic');
    const study = await screen.findByTestId('mode-xuean-workspace');

    fireEvent.click(screen.getByTestId('student-tool-segments'));
    expect(screen.getByTestId('student-lesson-content-panel')).toBeTruthy();
    expect(topic.isConnected).toBe(true);
    expect(study.isConnected).toBe(true);

    fireEvent.click(screen.getByTestId('student-tool-drawer-close'));
    expect(screen.queryByTestId('student-lesson-content-panel')).toBeNull();
    expect(topic.isConnected).toBe(true);
    expect(study.isConnected).toBe(true);
    expect(screen.queryByTestId('lazy-whiteboard')).toBeNull();
  });
});

describe('学生流程守卫', () => {
  it('拒绝改全班环节和阶段，且不发请求', () => {
    const fetchMock = vi.fn();
    const flow = {
      snapshot: {
        lessonId: 'l1',
        classId: null,
        stage: 'IN_CLASS_TEACHING',
        activeSegmentId: null,
        segments: [],
        students: [],
        onlineStudentIds: [],
        attempts: [],
      },
      setActiveSegment: fetchMock,
      advanceStage: fetchMock,
      sendMessage: vi.fn(),
      refresh: vi.fn(),
    } as unknown as ClassroomFlowController;
    const guarded = guardStudentFlow(flow);

    expect(() => guarded.setActiveSegment('seg-2')).toThrow(STUDENT_SEGMENT_GUARD_ERROR);
    expect(() => guarded.advanceStage('AFTER_CLASS')).toThrow(STUDENT_STAGE_GUARD_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
