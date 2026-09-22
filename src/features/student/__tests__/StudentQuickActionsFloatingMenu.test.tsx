import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { StudentQuickActionsFloatingMenu } from '../components/StudentQuickActionsFloatingMenu';

describe('StudentQuickActionsFloatingMenu', () => {
  const mockSchedules = [
    {
      id: 'sch-1',
      lesson_id: 'les-mech-101',
      lesson_title: 'Mechanics & Dynamics',
      class_name: 'Physics 101',
      scheduled_date: '2026-09-25',
      attendance_status: 'present',
    },
  ];

  const mockAssignments = [
    {
      id: 'ast-quiz-1',
      title: 'Newtonian Physics Quiz',
      class_name: 'Physics 101',
      submission_status: null, // pending
      score: null,
    },
    {
      id: 'ast-graded-2',
      title: 'Calculus Derivatives',
      class_name: 'Math 201',
      submission_status: 'graded',
      score: 95,
    },
  ];

  const mockRollcalls = [
    {
      id: 'rc-101',
      lesson_id: 'les-mech-101',
      lesson_title: 'Mechanics & Dynamics',
      created_at: Date.now() - 30000,
    },
  ];

  const defaultProps = {
    studentDashboardData: {
      schedules: mockSchedules,
      assignments: mockAssignments,
      rollcalls: mockRollcalls,
      progress: [{ lesson_id: 'les-mech-101', lesson_title: 'Mechanics & Dynamics' }],
    },
    activeStudentId: 'student-bob',
    readNotifications: new Set<string>(),
    setReadNotifications: vi.fn(),
    setSelectedLesson: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setSelectedAssignment: vi.fn(),
    addToast: vi.fn(),
    lang: 'zh' as const,
    onExpandWidget: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the floating action trigger button with total urgent badge', () => {
    render(<StudentQuickActionsFloatingMenu {...defaultProps} />);

    const fab = document.getElementById('student-quick-actions-fab-btn');
    expect(fab).toBeTruthy();

    // 1 unread rollcall + 1 pending assignment + 1 active session = 3
    const badge = fab?.querySelector('span.bg-rose-500');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('3');
  });

  it('opens floating popover with Join Live Session, View Latest Assignments, and Check Notifications', () => {
    render(<StudentQuickActionsFloatingMenu {...defaultProps} />);

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    expect(screen.getByText('学生快捷指令 (Quick Actions)')).toBeTruthy();
    expect(screen.getByText('进入实时课堂')).toBeTruthy();
    expect(screen.getByText('查看待办作业')).toBeTruthy();
    expect(screen.getByText('检查消息与点名')).toBeTruthy();
  });

  it('jumps to live session on clicking Join Live Session', () => {
    const setSelectedLesson = vi.fn();
    const setStudentViewStatus = vi.fn();
    const addToast = vi.fn();

    render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        setSelectedLesson={setSelectedLesson}
        setStudentViewStatus={setStudentViewStatus}
        addToast={addToast}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    const joinLiveAction = document.getElementById('qa-action-join-live')!;
    fireEvent.click(joinLiveAction);

    expect(setSelectedLesson).toHaveBeenCalledWith('les-mech-101');
    expect(setStudentViewStatus).toHaveBeenCalledWith('lesson');
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('面授课堂'),
      expect.stringContaining('Mechanics & Dynamics'),
      'success'
    );
  });

  it('triggers onExpandWidget and locates assignment on clicking View Latest Assignments', () => {
    const onExpandWidget = vi.fn();

    // Create a dummy widget in document
    const dummyWidget = document.createElement('div');
    dummyWidget.id = 'widget-upcoming-assignments';
    dummyWidget.scrollIntoView = vi.fn();
    document.body.appendChild(dummyWidget);

    render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        onExpandWidget={onExpandWidget}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    const assignmentsAction = document.getElementById('qa-action-view-assignments')!;
    fireEvent.click(assignmentsAction);

    expect(onExpandWidget).toHaveBeenCalledWith('upcoming-assignments');
    expect(dummyWidget.scrollIntoView).toHaveBeenCalled();

    document.body.removeChild(dummyWidget);
  });

  it('allows direct jump to pending assignment via "直接答题" button', () => {
    const setSelectedAssignment = vi.fn();
    const setStudentViewStatus = vi.fn();

    render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        setSelectedAssignment={setSelectedAssignment}
        setStudentViewStatus={setStudentViewStatus}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    const directOpenBtn = screen.getByText('直接答题');
    fireEvent.click(directOpenBtn);

    expect(setSelectedAssignment).toHaveBeenCalledWith(mockAssignments[0]);
    expect(setStudentViewStatus).toHaveBeenCalledWith('assignment');
  });

  it('navigates to notifications subview and acknowledges roll-call alarm', async () => {
    const setReadNotifications = vi.fn();
    const addToast = vi.fn();

    render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        setReadNotifications={setReadNotifications}
        addToast={addToast}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    const notifAction = document.getElementById('qa-action-check-notifications')!;
    fireEvent.click(notifAction);

    expect(screen.getByText('消息与点名通知清单')).toBeTruthy();
    expect(screen.getByText('⚡️ 老师向您发起了随堂提问点名')).toBeTruthy();

    const confirmBtn = screen.getByText('立即确认签到回应');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/students/student-bob/read_notifications',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ notificationId: 'rc-101' }),
        })
      );
      expect(setReadNotifications).toHaveBeenCalled();
      expect(addToast).toHaveBeenCalledWith(
        expect.stringContaining('点名确认成功'),
        expect.stringContaining('教师端大屏'),
        'success'
      );
    });
  });

  it('closes floating menu when Escape key is pressed', async () => {
    render(<StudentQuickActionsFloatingMenu {...defaultProps} />);

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    expect(screen.getByText('学生快捷指令 (Quick Actions)')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('学生快捷指令 (Quick Actions)')).toBeNull();
    });
  });

  it('automatically collapses floating menu into compact icon-only state on mobile devices to preserve screen real estate', async () => {
    // Set window to mobile size
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 480 });
    const onCompactChange = vi.fn();

    const { unmount } = render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        onCompactChange={onCompactChange}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    expect(fab.getAttribute('data-compact')).toBe('true');
    expect(fab.getAttribute('data-is-mobile')).toBe('true');
    // On mobile compact mode, text label should be collapsed (not rendered)
    expect(screen.queryByText('快捷指令')).toBeNull();
    expect(onCompactChange).toHaveBeenCalledWith(true);

    unmount();
    // Reset window width back to desktop
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
  });

  it('automatically closes open menu when screen resizes into mobile view', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });

    render(<StudentQuickActionsFloatingMenu {...defaultProps} autoCollapseOnMobile={true} />);

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    // Open menu on desktop
    fireEvent.click(fab);
    expect(screen.getByText('学生快捷指令 (Quick Actions)')).toBeTruthy();

    // Resize screen to mobile
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 });
      window.dispatchEvent(new Event('resize'));
    });

    // The open menu should auto-collapse to preserve screen real estate
    await waitFor(() => {
      expect(screen.queryByText('学生快捷指令 (Quick Actions)')).toBeNull();
    });
  });

  it('renders third-party plugin contributed actions and supports plugin registry and click callbacks', async () => {
    const customPluginAction = {
      id: 'ext-ai-math-tutor',
      title: 'AI 错题解析导师',
      description: '针对未提交作业智能生成答疑卡片',
      icon: 'BrainCircuit',
      badge: 'AI PRO',
      badgeVariant: 'indigo' as const,
      onClick: vi.fn(),
    };

    render(
      <StudentQuickActionsFloatingMenu
        {...defaultProps}
        pluginActions={[customPluginAction]}
      />
    );

    const fab = document.getElementById('student-quick-actions-fab-btn')!;
    fireEvent.click(fab);

    // Verify plugin action appears in the menu
    expect(screen.getByText('AI 错题解析导师')).toBeTruthy();
    expect(screen.getByText('针对未提交作业智能生成答疑卡片')).toBeTruthy();
    expect(screen.getByText('AI PRO')).toBeTruthy();

    // Click plugin action
    const actionEl = document.getElementById('qa-action-plugin-ext-ai-math-tutor')!;
    fireEvent.click(actionEl);

    expect(customPluginAction.onClick).toHaveBeenCalledWith(
      expect.objectContaining({
        activeStudentId: 'student-bob',
      })
    );
  });

  it('responds to programmatic DOM events for plugin integration', async () => {
    render(<StudentQuickActionsFloatingMenu {...defaultProps} />);

    // Open via event
    act(() => {
      window.dispatchEvent(new CustomEvent('openlearn:student_quick_actions:open'));
    });
    expect(screen.getByText('学生快捷指令 (Quick Actions)')).toBeTruthy();

    // Collapse via event
    act(() => {
      window.dispatchEvent(new CustomEvent('openlearn:student_quick_actions:collapse'));
    });
    await waitFor(() => {
      expect(screen.queryByText('学生快捷指令 (Quick Actions)')).toBeNull();
    });
  });
});
