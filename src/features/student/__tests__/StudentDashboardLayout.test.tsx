import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

describe('学生首页固定默认布局', () => {
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

  function renderPanel() {
    return render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <StudentDashboardPanel {...defaultProps} />
      </PluginHostProvider>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染 12 栅格容器，组件顺序与默认布局一致', () => {
    const { container } = renderPanel();

    const grid = container.querySelector('#student-dashboard-grid');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('lg:grid-cols-12');

    const ids = Array.from(container.querySelectorAll('[data-widget-id]')).map((el) =>
      el.getAttribute('data-widget-id'),
    );
    expect(ids).toEqual([
      'upcoming-assignments',
      'schedules',
      'course-progress',
      'quick-stats',
      'assessments',
      'progress-trends',
      'academic-trajectory',
      'academic-comparison',
      'extension-views',
    ]);
  });

  it('组件尺寸取自默认布局，且不再有 1/3、1/2 等尺寸调节按钮', () => {
    const { container } = renderPanel();

    const assignments = container.querySelector('#widget-upcoming-assignments');
    expect(assignments?.getAttribute('data-widget-size')).toBe('two-thirds');
    expect(assignments?.className).toContain('lg:col-span-8');

    const progress = container.querySelector('#widget-progress-trends');
    expect(progress?.getAttribute('data-widget-size')).toBe('half');
    expect(progress?.className).toContain('lg:col-span-6');

    for (const label of ['1/3', '1/2', '2/3', 'Full']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('不再有移动、折叠与拖拽控件', () => {
    const { container } = renderPanel();

    expect(screen.queryByTitle('向前移动卡片')).toBeNull();
    expect(screen.queryByTitle('向后移动卡片')).toBeNull();
    expect(screen.queryByTitle('收起卡片')).toBeNull();
    expect(screen.queryByTitle('展开卡片')).toBeNull();

    const firstWidget = container.querySelector('#widget-upcoming-assignments');
    expect(firstWidget?.getAttribute('draggable')).toBeNull();
  });

  it('不再渲染「模块化自适应栅格工作台」工具条与预设', () => {
    renderPanel();

    expect(screen.queryByText('模块化自适应栅格工作台')).toBeNull();
    expect(screen.queryByText('作业攻坚模式')).toBeNull();
    expect(screen.queryByTitle('恢复默认布局')).toBeNull();
    expect(screen.queryByText('自定义布局')).toBeNull();
  });

  it('不读写本地布局存储', () => {
    renderPanel();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('student_dashboard_layout'))).toEqual([]);
  });
});
