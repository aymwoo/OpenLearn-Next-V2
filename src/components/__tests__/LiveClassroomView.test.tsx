import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';

// Mock child components & dependencies
vi.mock('../LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard">Whiteboard</div>,
}));

vi.mock('../TeacherAssignmentGradePanel', () => ({
  TeacherAssignmentGradePanel: () => <div data-testid="grade-panel">GradePanel</div>,
}));

vi.mock('../../features/classroom/PreClassReadyView', () => ({
  PreClassReadyView: () => <div data-testid="pre-class-ready-view" />,
}));

vi.mock('../../features/classroom/ClassroomInteractiveCockpit', () => ({
  ClassroomInteractiveCockpit: () => null,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe('LiveClassroomView - Student Pop-up & Sync', () => {
  let openMock: ReturnType<typeof vi.fn>;
  let broadcastPostMock: ReturnType<typeof vi.fn>;

  const defaultProps = {
    selectedLesson: 'lesson-101',
    setSelectedLesson: vi.fn(),
    lessons: [{ id: 'lesson-101', title: '物理探究实验课' }],
    classes: [{ id: 'class-g1', name: '高一1班' }],
    students: [
      { id: 's101', name: '张小明', class_id: 'class-g1' },
      { id: 's102', name: '李华', class_id: 'class-g1' },
    ],
    plugins: [],
    lang: 'zh',
    timelineSegments: [
      { id: 'seg-1', title: '导入环节', duration: 300 },
      { id: 'seg-2', title: '探究环节', duration: 900 },
    ],
    activeSegmentId: 'seg-1',
    setActiveSegmentId: vi.fn(),
    liveClassSelectedClassId: 'class-g1',
    setLiveClassSelectedClassId: vi.fn(),
    liveClassIsActive: true,
    setLiveClassIsActive: vi.fn(),
    // 本组用例断言的是授课视图内部交互（学生视窗预览开新 Tab），
    // 因此显式跳过互动课堂起始门户。
    initialPortalOpen: false,
    liveClassTimeRemaining: 300,
    setLiveClassTimeRemaining: vi.fn(),
    liveClassFeed: [],
    setLiveClassFeed: vi.fn(),
    liveClassAcknowledgedMap: new Map(),
    setLiveClassAcknowledgedMap: vi.fn(),
    elements: [],
    fetchElements: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    addToast: vi.fn(),
    onlineStudentIds: ['s101'],
    activeStudentLessons: { s101: 'lesson-101' },
    liveClassStudentProgress: [],
    activeRole: 'teacher',
    setActiveRole: vi.fn(),
  };

  beforeEach(() => {
    broadcastPostMock = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      vi.fn().mockImplementation(function (name: string) {
        return {
          name,
          onmessage: null,
          postMessage: broadcastPostMock,
          close: vi.fn(),
        };
      }),
    );

    openMock = vi.fn();
    vi.stubGlobal('open', openMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders "学生视角预览 (独立Tab)" button instead of the old inline role toggle', () => {
    render(<LiveClassroomView {...(defaultProps as any)} />);

    // Old role toggle buttons should not exist
    expect(screen.queryByText('👨‍🏫 教师模式')).toBeNull();
    expect(screen.queryByText('🎓 学生模式')).toBeNull();

    // New independent tab button should exist
    const tabButton = screen.getByRole('button', { name: /学生视角预览 \(独立Tab\)/ });
    expect(tabButton).toBeDefined();
  });

  it('calls window.open with student_live URL params and "_blank" when "学生视角预览 (独立Tab)" is clicked', async () => {
    const fakeTab = {
      closed: false,
      focus: vi.fn(),
    };
    openMock.mockReturnValue(fakeTab);

    render(<LiveClassroomView {...(defaultProps as any)} />);

    const tabButton = screen.getByRole('button', { name: /学生视角预览 \(独立Tab\)/ });
    fireEvent.click(tabButton);

    expect(openMock).toHaveBeenCalled();
    const [openedUrl, targetName, features] = openMock.mock.calls[0];

    // Must be opened with target '_blank' and NO window features so it opens as an independent tab
    expect(targetName).toBe('_blank');
    expect(features).toBeUndefined();
    expect(openedUrl).toContain('mode=student_live');
    expect(openedUrl).toContain('studentId=s101');
    expect(openedUrl).toContain('lessonId=lesson-101');
    expect(openedUrl).toContain('classId=class-g1');
    expect(openedUrl).toContain('#/student_live');

    // Button should now show "已联动 (激活Tab)"
    await waitFor(() => {
      expect(screen.getByText(/学生端已联动 \(激活Tab\)/)).toBeDefined();
    });

    // Clicking it again should call .focus() instead of window.open
    const linkedButton = screen.getByRole('button', { name: /学生端已联动/ });
    fireEvent.click(linkedButton);
    expect(fakeTab.focus).toHaveBeenCalled();
  });

  it('handles browser tab blocking gracefully', () => {
    openMock.mockReturnValue(null); // Simulated browser popup blocker
    const addToastMock = vi.fn();

    render(<LiveClassroomView {...(defaultProps as any)} addToast={addToastMock} />);

    const tabButton = screen.getByRole('button', { name: /学生视角预览 \(独立Tab\)/ });
    fireEvent.click(tabButton);

    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining('新Tab打开被拦截'),
      expect.any(String),
      'warning',
    );
  });

  it('shows the pre-class stage when the selected lesson has no active session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hasActiveSession: false }),
      }),
    );

    render(<LiveClassroomView {...(defaultProps as any)} />);

    expect(await screen.findByTestId('pre-class-ready-view')).toBeDefined();
  });
});
