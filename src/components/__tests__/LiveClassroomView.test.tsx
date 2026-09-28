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

  it('renders sidebar whiteboard outline and teaching progress sections in teaching mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/classroom/sessions/lesson-101')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              session: { started_at: Date.now() - 60000 },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }),
    );

    render(<LiveClassroomView {...(defaultProps as any)} />);

    // Should display the sidebar outline section title
    await waitFor(() => {
      expect(screen.getByText('白板页面大纲')).toBeDefined();
    });

    // Should display the teaching steps section title
    expect(screen.getByText('教学环节进度表')).toBeDefined();

    // Should display timeline segment titles
    expect(screen.getByText('导入环节')).toBeDefined();
    expect(screen.getByText('探究环节')).toBeDefined();

    // Should display the add page button in the outline header
    const addPageButton = screen.getByTitle('新建白板页面');
    expect(addPageButton).toBeDefined();
  });

  it('renders 在线课堂 and read-only class badge without class select dropdown', () => {
    render(<LiveClassroomView {...(defaultProps as any)} />);

    // Topbar title is "🔴 在线课堂"
    expect(screen.getByText('🔴 在线课堂')).toBeDefined();
    expect(screen.queryByText(/智能授课工作流控制中心/)).toBeNull();

    // Read-only class badge
    expect(screen.getByText('高一1班')).toBeDefined();
    // No class dropdown selector
    expect(screen.queryByText('-- 选择授课班级 --')).toBeNull();
  });

  it('handles lesson switching with secondary confirmation modal', async () => {
    const setSelectedLessonMock = vi.fn();
    const fetchElementsMock = vi.fn().mockResolvedValue(undefined);

    const propsWithTwoLessons = {
      ...defaultProps,
      setSelectedLesson: setSelectedLessonMock,
      fetchElements: fetchElementsMock,
      lessons: [
        { id: 'lesson-101', title: '物理探究实验课' },
        { id: 'lesson-102', title: '第二节：机械能守恒' },
      ],
    };

    render(<LiveClassroomView {...(propsWithTwoLessons as any)} />);

    const selectEl = screen.getByRole('combobox');
    const switchBtn = screen.getByRole('button', { name: /切换/ });

    // Initially disabled because selectedLesson is already 'lesson-101'
    expect(switchBtn).toHaveProperty('disabled', true);

    // Select second lesson
    fireEvent.change(selectEl, { target: { value: 'lesson-102' } });

    // Now switch button is enabled
    expect(switchBtn).toHaveProperty('disabled', false);

    // Click switch button to open confirmation modal
    fireEvent.click(switchBtn);

    expect(screen.getByText('确认切换上课课程？')).toBeDefined();
    expect(screen.getAllByText('第二节：机械能守恒').length).toBeGreaterThanOrEqual(2);

    // Click confirm button
    const confirmBtn = screen.getByRole('button', { name: '确认切换' });
    fireEvent.click(confirmBtn);

    expect(setSelectedLessonMock).toHaveBeenCalledWith('lesson-102');
    expect(fetchElementsMock).toHaveBeenCalledWith('lesson-102');
  });

  it('renders student focus console and supports collapsible feedback feed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/classroom/sessions/lesson-101')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              session: { started_at: Date.now() - 60000 },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }),
    );

    const setLiveClassFeedMock = vi.fn();
    const props = {
      ...defaultProps,
      liveClassFeed: [
        { id: '1', time: '10:00:01', type: 'info', message: '张小明 进入了课堂' },
        { id: '2', time: '10:01:20', type: 'success', message: '李华 提交了随堂练习' },
      ],
      setLiveClassFeed: setLiveClassFeedMock,
    };

    render(<LiveClassroomView {...(props as any)} />);

    // 1. Student focus console header & pick button
    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /抽问/ })).toBeDefined();
    expect(screen.getByText(/🔒 0\/2/)).toBeDefined();

    // Students rendered
    expect(screen.getByText('张小明')).toBeDefined();
    expect(screen.getByText('李华')).toBeDefined();

    // 2. Live feed header, count & clear button
    expect(screen.getByText('课堂互动反馈流')).toBeDefined();
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // feed length badge
    expect(screen.getByText('收起')).toBeDefined();
    expect(screen.getByText('张小明 进入了课堂')).toBeDefined();
    expect(screen.getByText('李华 提交了随堂练习')).toBeDefined();

    // 3. Test collapse
    const collapseBtn = screen.getByText('收起');
    fireEvent.click(collapseBtn);

    // After collapse, text becomes '展开', and feed list items are hidden
    expect(screen.getByText('展开')).toBeDefined();
    expect(screen.queryByText('张小明 进入了课堂')).toBeNull();

    // 4. Test expand
    const expandBtn = screen.getByText('展开');
    fireEvent.click(expandBtn);

    expect(screen.getByText('收起')).toBeDefined();
    expect(screen.getByText('张小明 进入了课堂')).toBeDefined();

    // 5. Test clear feed
    const clearBtn = screen.getByRole('button', { name: /Clear/ });
    fireEvent.click(clearBtn);
    expect(setLiveClassFeedMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'clear',
        type: 'info',
        message: '反馈流已清空。',
      }),
    ]);
  });
});
