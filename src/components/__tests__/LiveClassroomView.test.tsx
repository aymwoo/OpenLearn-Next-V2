import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';
import { AppDataProvider } from '../../context/AppDataContext';
import { appStore } from '../../store/appStore';
import { uiStore } from '../../store/uiStore';

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

  const defaultProps: Record<string, any> = {
    classStudentsMap: {
      'class-g1': [
        { id: 's101', name: '张小明', class_id: 'class-g1' },
        { id: 's102', name: '李华', class_id: 'class-g1' },
      ],
    },
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
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
    socketRef: { current: { emit: vi.fn() } },
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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    // Issue #91：会话恢复记忆写在 sessionStorage，用例之间必须隔离
    window.sessionStorage.clear();
  });

  it('renders "学生视角预览 (独立Tab)" button instead of the old inline role toggle', () => {
    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // Old role toggle buttons should not exist
    expect(screen.queryByText('👨‍🏫 教师模式')).toBeNull();
    expect(screen.queryByText('🎓 学生模式')).toBeNull();

    // New independent tab button should exist
    const tabButton = screen.getByRole('button', { name: /学生视角预览 \(独立Tab\)/ });
    expect(tabButton).toBeTruthy();
  });

  it('calls window.open with student_live URL params and "_blank" when "学生视角预览 (独立Tab)" is clicked', async () => {
    const fakeTab = {
      closed: false,
      focus: vi.fn(),
    };
    openMock.mockReturnValue(fakeTab);

    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

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

    // Button should now show "已联动 (激活Tab)" in accessible name/title
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /学生端已联动/ })).toBeTruthy();
    });

    // Clicking it again should call .focus() instead of window.open
    const linkedButton = screen.getByRole('button', { name: /学生端已联动/ });
    fireEvent.click(linkedButton);
    expect(fakeTab.focus).toHaveBeenCalled();
  });

  it('Issue #90: 消费课表「快速开始上课」信号，跳过门户直接进入授课视图', async () => {
    const setSelectedLesson = vi.fn();
    const setLiveClassSelectedClassId = vi.fn();
    const props = {
      ...defaultProps,
      setSelectedLesson,
      setLiveClassSelectedClassId,
      initialPortalOpen: true, // 默认会先展示门户；有开课信号时应被跳过
    };

    uiStore.getState().setPendingLiveClassLaunch({
      lessonId: 'lesson-102',
      classId: 'class-g2',
      teachingModeId: 'mode_explore',
    });

    render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView />
      </AppDataProvider>,
    );

    // 信号被消费清空，并按信号内容选中课程与班级
    await waitFor(() => {
      expect(uiStore.getState().pendingLiveClassLaunch).toBeNull();
    });
    expect(setSelectedLesson).toHaveBeenCalledWith('lesson-102');
    expect(setLiveClassSelectedClassId).toHaveBeenCalledWith('class-g2');
    expect(defaultProps.fetchElements).toHaveBeenCalledWith('lesson-102');

    // 未渲染起始门户，直接进入授课/课前流程视图
    expect(await screen.findByTestId('pre-class-ready-view')).toBeTruthy();
  });

  it('handles browser tab blocking gracefully', () => {
    openMock.mockReturnValue(null); // Simulated browser popup blocker
    const addToastMock = vi.fn();

    render(
      <AppDataProvider value={{ ...defaultProps, addToast: addToastMock } as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

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

    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    expect(await screen.findByTestId('pre-class-ready-view')).toBeTruthy();
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

    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // Should display the sidebar outline section title
    await waitFor(() => {
      expect(screen.getByText('白板页面大纲')).toBeTruthy();
    });

    // Should display the teaching steps section title
    expect(screen.getByText('教学环节进度表')).toBeTruthy();

    // Should display timeline segment titles
    expect(screen.getByText('导入环节')).toBeTruthy();
    expect(screen.getByText('探究环节')).toBeTruthy();

    // Should display the add page button in the outline header
    const addPageButton = screen.getByTitle('新建白板页面');
    expect(addPageButton).toBeTruthy();
  });

  it('renders 在线课堂 and read-only class badge without class select dropdown', () => {
    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // Topbar title is "🔴 在线课堂"
    expect(screen.getByText('🔴 在线课堂')).toBeTruthy();
    expect(screen.queryByText(/智能授课工作流控制中心/)).toBeNull();

    // Read-only class badge
    expect(screen.getByText('高一1班')).toBeTruthy();
    expect(screen.getByTestId('live-class-lock-hint').textContent).toContain('需结束本节课才能换班');
    // No class dropdown selector
    expect(screen.queryByText('-- 选择授课班级 --')).toBeNull();
  });

  it('pins an in-progress session class over a mismatched selection and URL classId', async () => {
    window.history.replaceState({}, '', '/?classId=class-other&lessonId=lesson-101#/live_class');
    appStore.setState({ liveClassSelectedClassId: 'class-other' });
    const setClass = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/classroom/sessions/lesson-101')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              session: { class_id: 'class-g1', started_at: Date.now() },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    render(
      <AppDataProvider
        value={
          { ...defaultProps, liveClassSelectedClassId: 'class-other', setLiveClassSelectedClassId: setClass } as any
        }
      >
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => {
      expect(setClass).toHaveBeenCalledWith('class-g1');
    });
    expect(setClass).not.toHaveBeenCalledWith('class-other');
    appStore.setState({ liveClassSelectedClassId: null });
  });

  it('Issue #91：有进行中会话时先进「进行中会话列表」而不是授课视图，继续上课后才进课并保持班级锁定', async () => {
    window.history.replaceState({}, '', '/?classId=class-other#/live_class');
    appStore.setState({ liveClassSelectedClassId: 'class-other' });
    const pendingPerLesson: Array<(value: unknown) => void> = [];
    const setClass = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        // 列表端点：/api/classroom/sessions?status=active（注意不是 /sessions/<lessonId>）
        if (String(url).includes('/api/classroom/sessions?')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [
                {
                  id: 'sess-1',
                  lessonId: 'lesson-101',
                  lessonTitle: '物理探究实验课',
                  classId: 'class-g1',
                  className: '高一1班',
                  teacherId: 'teacher',
                  stage: 'IN_CLASS_TEACHING',
                  teachingModeId: null,
                  teachingModeName: null,
                  checkinCode: null,
                  focusMode: false,
                  startedAt: Date.now() - 60000,
                  endedAt: null,
                  createdAt: Date.now() - 60000,
                  stats: { pollCount: 0, exitTicketCount: 0, feedCount: 0 },
                  presentCount: 2,
                },
              ],
              total: 1,
            }),
          });
        }
        if (String(url).includes('/api/classroom/sessions/')) {
          return new Promise((resolve) => {
            pendingPerLesson.push(resolve);
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    render(
      <AppDataProvider
        value={
          { ...defaultProps, liveClassSelectedClassId: 'class-other', setLiveClassSelectedClassId: setClass } as any
        }
      >
        <LiveClassroomView initialPortalOpen />
      </AppDataProvider>,
    );

    // 第一屏就是「进行中会话」这一屏（先加载态），不再先渲染门户、也不直接进授课视图
    expect(screen.getByTestId('in-progress-sessions-loading')).toBeTruthy();
    expect(screen.queryByTestId('live-class-entry-pending')).toBeNull();
    expect(screen.queryByText(/下一节/)).toBeNull();
    expect(screen.queryByText('🔴 在线课堂')).toBeNull();
    await waitFor(() => expect(pendingPerLesson.length).toBeGreaterThan(0));

    for (const resolve of pendingPerLesson) {
      resolve({
        ok: true,
        json: async () => ({
          hasActiveSession: true,
          stage: 'IN_CLASS_TEACHING',
          session: { class_id: 'class-g1' },
        }),
      });
    }

    // 关键行为变更：落到「进行中会话列表」，授课视图尚未进入
    expect(await screen.findByTestId('in-progress-session-list')).toBeTruthy();
    expect(screen.queryByText('🔴 在线课堂')).toBeNull();
    expect(screen.queryByText(/下一节/)).toBeNull();
    await waitFor(() => expect(setClass).toHaveBeenCalledWith('class-g1'));
    expect(setClass).not.toHaveBeenCalledWith('class-other');

    // 教师显式「继续上课」后才进授课视图
    fireEvent.click(screen.getByRole('button', { name: /继续上课/ }));
    expect(await screen.findByText('🔴 在线课堂')).toBeTruthy();
    expect(screen.queryByTestId('in-progress-session-list')).toBeNull();
    appStore.setState({ liveClassSelectedClassId: null });
  });

  it('Issue #91：会话列表为空时回退到起始门户，并显示班级锁定提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/classroom/sessions?')) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
        }
        if (String(url).includes('/api/classroom/sessions/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ hasActiveSession: false }),
          });
        }
        if (String(url).includes('/api/schedules/today')) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, schedules: [] }) });
        }
        if (String(url).includes('/api/classroom/teaching-modes')) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, modes: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen />
      </AppDataProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId('in-progress-session-list')).toBeNull());
    expect(await screen.findByText(/下一节课|开始上课/)).toBeTruthy();
  });

  it('Issue #91：显式「继续上课」后重新挂载（刷新/切标签页回来）直接回到授课视图，不再要求重选', async () => {
    appStore.setState({ liveClassSelectedClassId: 'class-g1' });
    const listItem = {
      id: 'sess-1',
      lessonId: 'lesson-101',
      lessonTitle: '物理探究实验课',
      classId: 'class-g1',
      className: '高一1班',
      teacherId: 'teacher',
      stage: 'IN_CLASS_TEACHING',
      teachingModeId: null,
      teachingModeName: null,
      checkinCode: null,
      focusMode: false,
      startedAt: Date.now() - 60000,
      endedAt: null,
      createdAt: Date.now() - 60000,
      stats: { pollCount: 0, exitTicketCount: 0, feedCount: 0 },
      presentCount: 2,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/classroom/sessions?')) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [listItem], total: 1 }) });
        }
        if (String(url).includes('/api/classroom/sessions/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              session: { class_id: 'class-g1' },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const first = render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen />
      </AppDataProvider>,
    );

    // 第一次进入：先看到会话列表
    expect(await screen.findByTestId('in-progress-session-list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /继续上课/ }));
    expect(await screen.findByText('🔴 在线课堂')).toBeTruthy();

    // 模拟刷新 / 切标签页回来：卸载后用同样的 props 重新挂载
    first.unmount();
    render(
      <AppDataProvider value={defaultProps as any}>
        <LiveClassroomView initialPortalOpen />
      </AppDataProvider>,
    );

    expect(await screen.findByText('🔴 在线课堂')).toBeTruthy();
    expect(screen.queryByTestId('in-progress-session-list')).toBeNull();
    appStore.setState({ liveClassSelectedClassId: null });
  });

  it('returns to the entry portal where an in-progress class cannot be changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/classroom/sessions/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              session: { class_id: 'class-g1' },
            }),
          });
        }
        if (String(url).includes('/api/schedules/today')) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, schedules: [] }) });
        }
        if (String(url).includes('/api/classroom/teaching-modes')) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, modes: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const props: Record<string, any> = {
      ...defaultProps,
      classes: [
        { id: 'class-g1', name: '高一1班' },
        { id: 'class-other', name: '高二2班' },
      ],
    };
    render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '返回门户' }));
    expect(await screen.findByTestId('portal-class-lock-hint')).toBeTruthy();
    const other = screen.getByRole('button', { name: /高二2班/ });
    expect(other).toHaveProperty('disabled', true);
    fireEvent.click(other);
    expect(props.setLiveClassSelectedClassId).not.toHaveBeenCalledWith('class-other');
  });

  it('handles lesson switching with secondary confirmation modal', async () => {
    const setSelectedLessonMock = vi.fn();
    const fetchElementsMock = vi.fn().mockResolvedValue(undefined);

    const propsWithTwoLessons: Record<string, any> = {
      classStudentsMap: {},
      fetchClassStudents: vi.fn().mockResolvedValue(undefined),
      ...defaultProps,
      setSelectedLesson: setSelectedLessonMock,
      fetchElements: fetchElementsMock,
      lessons: [
        { id: 'lesson-101', title: '物理探究实验课' },
        { id: 'lesson-102', title: '第二节：机械能守恒' },
      ],
    };

    render(
      <AppDataProvider value={propsWithTwoLessons as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

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

    expect(screen.getByText('确认切换上课课程？')).toBeTruthy();
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
    const props: Record<string, any> = {
      classStudentsMap: {},
      fetchClassStudents: vi.fn().mockResolvedValue(undefined),
      ...defaultProps,
      liveClassFeed: [
        { id: '1', time: '10:00:01', type: 'info', message: '张小明 进入了课堂' },
        { id: '2', time: '10:01:20', type: 'success', message: '李华 提交了随堂练习' },
      ],
      setLiveClassFeed: setLiveClassFeedMock,
    };

    render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // 1. Student focus console header & pick button
    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /抽问/ })).toBeTruthy();
    expect(screen.getByText(/🔒 0\/2/)).toBeTruthy();

    // Students rendered
    expect(screen.getByText('张小明')).toBeTruthy();
    expect(screen.getByText('李华')).toBeTruthy();

    // 姓名必须完整呈现：不套 truncate
    const zhNameNode = screen.getByText('张小明');
    expect(zhNameNode.className).not.toContain('truncate');
    expect(zhNameNode.className).toContain('break-words');

    // 2. Live feed header, count & clear button
    expect(screen.getByText('课堂互动反馈流')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // feed length badge
    expect(screen.getByText('收起')).toBeTruthy();
    expect(screen.getByText('张小明 进入了课堂')).toBeTruthy();
    expect(screen.getByText('李华 提交了随堂练习')).toBeTruthy();

    // 3. Test collapse
    const collapseBtn = screen.getByText('收起');
    fireEvent.click(collapseBtn);

    // After collapse, text becomes '展开', and feed list items are hidden
    expect(screen.getByText('展开')).toBeTruthy();
    expect(screen.queryByText('张小明 进入了课堂')).toBeNull();

    // 4. Test expand
    const expandBtn = screen.getByText('展开');
    fireEvent.click(expandBtn);

    expect(screen.getByText('收起')).toBeTruthy();
    expect(screen.getByText('张小明 进入了课堂')).toBeTruthy();

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

  it('学生专注力卡片完整显示长姓名，不再从第二个字起被省略号截断', async () => {
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
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const longName = '欧阳娜娜娜娜';
    const props = {
      ...defaultProps,
      students: [{ id: 's101', name: longName, class_id: 'class-g1' }],
      classStudentsMap: { 'class-g1': [{ id: 's101', name: longName, class_id: 'class-g1' }] },
    } as unknown as React.ComponentProps<typeof AppDataProvider>['value'];

    render(
      <AppDataProvider value={props}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeTruthy();
    });

    const nameNode = screen.getByText(longName);
    expect(nameNode.className).not.toContain('truncate');
    expect(nameNode.className).toContain('break-words');
    expect(nameNode.getAttribute('title')).toBe(longName);
  });

  it('头像优先用照片，其次按性别渲染，无性别时用中性人像（不再塞姓名缩写）', async () => {
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
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const roster = [
      { id: 's-photo', name: '有照片生', class_id: 'class-g1', avatar: '/uploads/avatars/a.png', gender: 'female' },
      { id: 's-male', name: '男生甲', class_id: 'class-g1', gender: 'male' },
      { id: 's-female', name: '女生乙', class_id: 'class-g1', gender: 'female' },
      { id: 's-unknown', name: '未知生', class_id: 'class-g1' },
    ];

    const { container } = render(
      <AppDataProvider
        value={
          {
            ...defaultProps,
            students: roster,
            classStudentsMap: { 'class-g1': roster },
            onlineStudentIds: [],
          } as unknown as React.ComponentProps<typeof AppDataProvider>['value']
        }
      >
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeTruthy();
    });

    // 1. 有照片：渲染 img，src 为本人头像
    const photo = container.querySelector('img[alt="有照片生"]') as HTMLImageElement | null;
    expect(photo).toBeTruthy();
    expect(photo?.getAttribute('src')).toBe('/uploads/avatars/a.png');

    // 2. 性别：男性 Mars、女性 Venus，未设置中性人像
    expect(container.querySelectorAll('.lucide-mars').length).toBe(1);
    expect(container.querySelectorAll('.lucide-venus').length).toBe(1);
    expect(container.querySelectorAll('.lucide-user-round').length).toBe(1);
  });

  it('supports clicking a student card to pin the overview panel and keeps displaying on mouse leave (#115)', async () => {
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

    const props: Record<string, any> = {
      ...defaultProps,
      liveClassStudentProgress: [
        {
          student_id: 's101',
          progress_percent: 85,
          quiz_score: 95,
          completed_segments: '["seg-1"]',
        },
        {
          student_id: 's102',
          progress_percent: 40,
          quiz_score: null,
          completed_segments: '[]',
        },
      ],
    };

    render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeTruthy();
    });

    // 1. Initial state: No student pinned or hovered -> shows Class Overview
    expect(screen.getByText('班级学情概况')).toBeTruthy();
    expect(screen.queryByText('随堂测验')).toBeNull();

    // 2. Find student cards
    const cardS101 = screen.getByRole('button', { name: /张小明/ });
    const cardS102 = screen.getByRole('button', { name: /李华/ });

    expect(cardS101.getAttribute('aria-pressed')).toBe('false');

    // 3. Click card to pin student s101
    fireEvent.click(cardS101);
    expect(cardS101.getAttribute('aria-pressed')).toBe('true');

    // Overview panel now displays 张小明's details & pinned badge
    expect(screen.getByText('随堂测验')).toBeTruthy();
    expect(screen.getByText('95 / 100')).toBeTruthy();
    expect(screen.getByText('固定')).toBeTruthy();
    expect(screen.getByTitle('已固定显示该学生概况，点击空白处或 Esc 取消')).toBeTruthy();

    // 4. Mouse leave s101 card -> Overview remains pinned to 张小明
    fireEvent.mouseLeave(cardS101);
    expect(screen.getByText('95 / 100')).toBeTruthy();
    expect(screen.getByText('固定')).toBeTruthy();

    // 5. Hover over student s102 card -> temporary preview
    fireEvent.mouseEnter(cardS102);
    expect(screen.getByText('预览')).toBeTruthy();
    expect(screen.getByTitle('临时悬浮预览中，鼠标移开后恢复已固定学生')).toBeTruthy();
    expect(screen.getByText('未提交')).toBeTruthy(); // 李华's quiz score is null

    // 6. Mouse leave s102 card -> smooth recovery back to pinned student s101
    fireEvent.mouseLeave(cardS102);
    expect(screen.queryByText('预览')).toBeNull();
    expect(screen.getByText('固定')).toBeTruthy();
    expect(screen.getByText('95 / 100')).toBeTruthy();

    // 7. Unpin via the "取消固定" button in the overview panel header
    const unpinBtn = screen.getByRole('button', { name: '取消固定学生概况' });
    fireEvent.click(unpinBtn);

    // Reverts to Class Overview
    expect(screen.getByText('班级学情概况')).toBeTruthy();
    expect(screen.queryByText('随堂测验')).toBeNull();
    expect(cardS101.getAttribute('aria-pressed')).toBe('false');

    // 8. Keyboard accessibility: Enter key pins the card
    fireEvent.keyDown(cardS101, { key: 'Enter' });
    expect(cardS101.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('95 / 100')).toBeTruthy();

    // 9. Press Escape key -> clears pinned state
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cardS101.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('班级学情概况')).toBeTruthy();

    // 10. Space key toggles pin on cardS102
    fireEvent.keyDown(cardS102, { key: ' ' });
    expect(cardS102.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('未提交')).toBeTruthy();

    // Space key toggles off
    fireEvent.keyDown(cardS102, { key: ' ' });
    expect(cardS102.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('班级学情概况')).toBeTruthy();
  });

  it('stops click propagation from card action buttons to prevent toggling pin state (#115)', async () => {
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

    const socketEmitMock = vi.fn();
    const addToastMock = vi.fn();
    const props: Record<string, any> = {
      ...defaultProps,
      socketRef: { current: { emit: socketEmitMock } },
      addToast: addToastMock,
      liveClassStudentProgress: [
        {
          student_id: 's101',
          progress_percent: 20, // behind
          quiz_score: 50,
          completed_segments: '[]',
        },
      ],
    };

    render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('学生专注力监控')).toBeTruthy();
    });

    const cardS101 = screen.getByRole('button', { name: /张小明/ });
    expect(cardS101.getAttribute('aria-pressed')).toBe('false');

    // Click warning ping button inside card
    const pingBtn = within(cardS101).getByTitle('提醒');
    fireEvent.click(pingBtn);

    expect(socketEmitMock).toHaveBeenCalledWith('teacher-ping-student', {
      studentId: 's101',
      lessonId: 'lesson-101',
      message: expect.stringContaining('学习进度预警'),
    });
    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining('已发送提醒'),
      expect.stringContaining('张小明'),
      'success',
    );

    // Crucial: Pin state was NOT toggled because of e.stopPropagation()
    expect(cardS101.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('班级学情概况')).toBeTruthy();

    // Click unlock segment button inside card
    const unlockBtn = within(cardS101).getByTitle('放行当前环节');
    fireEvent.click(unlockBtn);

    // Pin state still remains false
    expect(cardS101.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('班级学情概况')).toBeTruthy();
  });

  it('Issue #110: supports split class lock button with full focus and answer lock modes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, students: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const props = {
      ...defaultProps,
      students: [
        { id: 's101', name: '张小明', locked_lesson_id: null, lock_mode: 'full' },
        { id: 's102', name: '李华', locked_lesson_id: null, lock_mode: 'full' },
      ],
    };

    const { rerender } = render(
      <AppDataProvider value={props as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // 未锁定时展示「全班专注」与「答题锁定」按钮
    const focusBtn = screen.getByRole('button', { name: /全班专注/ });
    const answerBtn = screen.getByRole('button', { name: /答题锁定/ });
    expect(focusBtn).toBeTruthy();
    expect(answerBtn).toBeTruthy();

    // 等待挂载时的自动锁定完成并解开 disabled
    await waitFor(() => {
      expect((focusBtn as HTMLButtonElement).disabled).toBe(false);
      expect((answerBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fetchSpy.mockClear();

    // 点击答题锁定
    fireEvent.click(answerBtn);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/classes/class-g1/lock_lesson',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ lessonId: 'lesson-101', mode: 'navigation' }),
        }),
      );
    });

    // 重新渲染为答题锁定状态
    const lockedStudentsList = [
      { id: 's101', name: '张小明', class_id: 'class-g1', locked_lesson_id: 'lesson-101', lock_mode: 'navigation' },
      { id: 's102', name: '李华', class_id: 'class-g1', locked_lesson_id: 'lesson-101', lock_mode: 'navigation' },
    ];
    const lockedProps = {
      ...props,
      students: lockedStudentsList,
      classStudentsMap: {
        'class-g1': lockedStudentsList,
      },
    };

    rerender(
      <AppDataProvider value={lockedProps as any}>
        <LiveClassroomView initialPortalOpen={false} />
      </AppDataProvider>,
    );

    // 锁定时展示「答题锁定 · 解锁」与「切专注」按钮
    expect(screen.getByText('答题锁定 · 解锁')).toBeTruthy();
    const switchFocusBtn = screen.getByRole('button', { name: /切专注/ });
    expect(switchFocusBtn).toBeTruthy();

    await waitFor(() => {
      expect((switchFocusBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fetchSpy.mockClear();

    // 点击「切专注」切换为专注模式
    fireEvent.click(switchFocusBtn);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/classes/class-g1/lock_lesson',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ lessonId: 'lesson-101', mode: 'full' }),
        }),
      );
    });

    fetchSpy.mockRestore();
  });
});
