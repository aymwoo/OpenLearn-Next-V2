import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { StudentType } from '../../../types/app';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { StudentDashboardPanel } from '../StudentDashboardPanel';
import { studentActiveSessionStore } from '../useStudentActiveSession';

afterEach(() => {
  cleanup();
  studentActiveSessionStore.setState({ activeSession: null, loading: false, studentKey: null });
  vi.restoreAllMocks();
});

describe('StudentDashboardPanel', () => {
  const allProps = {
    students: [{ id: 's1', name: 'Alice' }] as unknown as StudentType[],
    activeStudentId: 's1',
    studentDashboardData: {
      progress: [],
      assignments: [{ id: 'a1', title: 'HW', class_name: 'C', content: 'x', submission_status: null }],
      schedules: [],
      rollcalls: [],
      classes: [],
    },
    readNotifications: new Set<string>(),
    setReadNotifications: vi.fn(),
    addToast: vi.fn(),
    lang: 'zh' as const,
    setSelectedLesson: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setSelectedAssignment: vi.fn(),
    setQuizStudentAnswers: vi.fn(),
    setSubAssignmentTab: vi.fn(),
  };

  it('renders the dashboard header greeting with the active student name', () => {
    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...allProps} />
      </PluginHostProvider>,
    );
    expect(screen.getByText('Welcome, Alice')).toBeTruthy();
  });

  it('renders the assignments panel', () => {
    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...allProps} />
      </PluginHostProvider>,
    );
    expect(screen.getByText('My Assignments')).toBeTruthy();
  });

  it('Issue #109: shows the active-class banner and returns to the live lesson', () => {
    const setSelectedLesson = vi.fn();
    const setStudentViewStatus = vi.fn();
    studentActiveSessionStore.setState({
      activeSession: {
        sessionId: 'sess-1',
        lessonId: 'les-live-9',
        lessonTitle: '正在进行的物理课',
        classId: 'c1',
        className: '高一1班',
        stage: 'IN_CLASS_TEACHING',
        startedAt: Date.now() - 3 * 60000,
      },
      loading: false,
      studentKey: 's1',
    });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel
          {...allProps}
          setSelectedLesson={setSelectedLesson}
          setStudentViewStatus={setStudentViewStatus}
        />
      </PluginHostProvider>,
    );

    const banner = screen.getByTestId('student-active-class-banner');
    expect(banner.textContent).toContain('正在上课：正在进行的物理课');

    fireEvent.click(within(banner).getByRole('button', { name: '返回课堂' }));
    expect(setSelectedLesson).toHaveBeenCalledWith('les-live-9');
    expect(setStudentViewStatus).toHaveBeenCalledWith('lesson');
  });

  it('Issue #109: hides the banner when no class session is active', () => {
    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...allProps} />
      </PluginHostProvider>,
    );
    expect(screen.queryByTestId('student-active-class-banner')).toBeNull();
  });
});
