import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StudentType } from '../../../types/app';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { StudentDashboardPanel } from '../StudentDashboardPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentDashboardPanel', () => {
  const allProps = {
    students: [{ id: 's1', name: 'Alice' }] as unknown as StudentType[],
    activeStudentId: 's1',
    studentDashboardData: {
      progress: [],
      assignments: [
        { id: 'a1', title: 'HW', class_name: 'C', content: 'x', submission_status: null },
      ],
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
});
