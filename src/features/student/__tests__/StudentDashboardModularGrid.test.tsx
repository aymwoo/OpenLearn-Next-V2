import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StudentDashboardPanel } from '../StudentDashboardPanel';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';

// Mock recharts responsive container for JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container" style={{ width: 800, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe('StudentDashboardPanel Modular CSS Grid Layout', () => {
  const mockAssignments = [
    {
      id: 'a1',
      title: 'Physics Mechanics Quiz',
      class_name: 'Physics 101',
      content: 'Mechanics test',
      submission_status: 'graded',
      score: 92,
      submitted_at: Date.now() - 86400000,
      graded_at: Date.now() - 43200000,
    },
    {
      id: 'a2',
      title: 'Math Calculus Homework',
      class_name: 'Math 201',
      content: 'Calculus derivatives',
      submission_status: null,
      score: null,
      submitted_at: null,
    },
  ];

  const defaultProps = {
    students: [{ id: 's1', name: 'Bob' }] as any,
    activeStudentId: 's1',
    studentDashboardData: {
      progress: [{ lesson_id: 'l1', lesson_title: 'Mechanics', progress: 80 }],
      assignments: mockAssignments,
      schedules: [
        {
          id: 'sch-1',
          lesson_id: 'l1',
          lesson_title: 'Mechanics',
          class_name: 'Physics 101',
          scheduled_date: '2026-09-25',
          attendance_status: 'present',
        },
      ],
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

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the modular CSS Grid container with 12-column system', () => {
    const { container } = render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} />
      </PluginHostProvider>
    );

    const grid = container.querySelector('#student-dashboard-modular-grid');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('grid');
    expect(grid?.className).toContain('lg:grid-cols-12');
  });

  it('renders both Progress Trends and Upcoming Assignments widgets', () => {
    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} />
      </PluginHostProvider>
    );

    expect(screen.getByText(/周度学习进度走势/)).toBeTruthy();
    expect(screen.getByText(/待办与已交作业/)).toBeTruthy();
  });

  it('resizes a widget when clicking size buttons and persists to localStorage', () => {
    const addToast = vi.fn();
    const { container } = render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} addToast={addToast} />
      </PluginHostProvider>
    );

    const progressWidget = container.querySelector('#widget-progress-trends');
    expect(progressWidget).toBeTruthy();

    // Default size is two-thirds (8 cols)
    expect(progressWidget?.getAttribute('data-widget-size')).toBe('two-thirds');

    // Click "Full" width button within progress trends widget
    const fullButtons = progressWidget?.querySelectorAll('button');
    const fullBtn = Array.from(fullButtons || []).find((b) => b.textContent?.trim() === 'Full');
    expect(fullBtn).toBeTruthy();

    if (fullBtn) {
      fireEvent.click(fullBtn);
    }

    // Verify updated size attribute
    expect(progressWidget?.getAttribute('data-widget-size')).toBe('full');
    expect(progressWidget?.className).toContain('lg:col-span-12');

    // Verify localStorage persistence
    const saved = localStorage.getItem('student_dashboard_layout_v2_s1');
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved || '[]');
    const progressItem = parsed.find((item: any) => item.id === 'progress-trends');
    expect(progressItem?.size).toBe('full');
  });

  it('reorders widgets using directional move buttons', () => {
    const { container } = render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} />
      </PluginHostProvider>
    );

    const initialWidgets = Array.from(container.querySelectorAll('[data-widget-id]')).map((el) =>
      el.getAttribute('data-widget-id')
    );

    // Initial first widget should be 'quick-stats'
    expect(initialWidgets[0]).toBe('quick-stats');

    // Move first widget right
    const firstWidget = container.querySelector('#widget-quick-stats');
    const moveRightBtn = firstWidget?.querySelector('button[title="向后移动卡片"]');
    expect(moveRightBtn).toBeTruthy();

    if (moveRightBtn) {
      fireEvent.click(moveRightBtn);
    }

    const updatedWidgets = Array.from(container.querySelectorAll('[data-widget-id]')).map((el) =>
      el.getAttribute('data-widget-id')
    );

    // After move right, quick-stats should now be at index 1
    expect(updatedWidgets[1]).toBe('quick-stats');
  });

  it('switches between presets (e.g. 作业攻坚模式)', () => {
    const addToast = vi.fn();
    const { container } = render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} addToast={addToast} />
      </PluginHostProvider>
    );

    const assignmentsFocusBtn = screen.getByText('作业攻坚模式');
    fireEvent.click(assignmentsFocusBtn);

    // Upcoming assignments should now be resized to full in assignments focus mode
    const assignmentsWidget = container.querySelector('#widget-upcoming-assignments');
    expect(assignmentsWidget?.getAttribute('data-widget-size')).toBe('full');

    expect(addToast).toHaveBeenCalledWith(
      '预设布局已应用',
      expect.stringContaining('作业攻坚模式'),
      'success'
    );
  });
});
