import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClassSummaryStats } from '../ClassSummaryStats';

const zh = 'zh';
const en = 'en';

describe('ClassSummaryStats', () => {
  it('shows empty state when classDashboardMap is empty', () => {
    render(<ClassSummaryStats classDashboardMap={{}} classes={[]} lang={zh} />);
    expect(screen.getByText(/暂无班级数据/)).toBeTruthy();
  });

  it('shows empty state in English', () => {
    render(<ClassSummaryStats classDashboardMap={{}} classes={[]} lang={en} />);
    expect(screen.getByText(/No class data yet/)).toBeTruthy();
  });

  it('computes average grade from performance data', () => {
    const dashboard = {
      'class-1': {
        performance: [
          { student_id: 's1', score: 80, submission_status: 'submitted' },
          { student_id: 's2', score: 90, submission_status: 'submitted' },
          { student_id: 's3', score: null, submission_status: 'pending' },
        ],
        rollcallStats: [
          { student_id: 's1', count: 3 },
          { student_id: 's2', count: 2 },
          { student_id: 's3', count: 0 },
        ],
        assignments: [],
        recentSubmissions: [],
      },
    };
    render(<ClassSummaryStats classDashboardMap={dashboard} classes={[{ id: 'class-1' } as any]} lang={zh} />);
    expect(screen.getByText('85')).toBeTruthy();
    expect(screen.getAllByText(/基于已评分作业/).length).toBeGreaterThan(0);
  });

  it('computes submission rate correctly', () => {
    const dashboard = {
      'class-1': {
        performance: [
          { student_id: 's1', score: 80, submission_status: 'submitted' },
          { student_id: 's2', score: null, submission_status: 'pending' },
          { student_id: 's3', score: null, submission_status: 'pending' },
          { student_id: 's4', score: 70, submission_status: 'submitted' },
        ],
        rollcallStats: [
          { student_id: 's1', count: 1 },
          { student_id: 's2', count: 1 },
          { student_id: 's3', count: 1 },
          { student_id: 's4', count: 1 },
        ],
        assignments: [],
        recentSubmissions: [],
      },
    };
    const { container } = render(
      <ClassSummaryStats classDashboardMap={dashboard} classes={[{ id: 'class-1' } as any]} lang={en} />,
    );
    // Check that the submission rate card shows 50
    const valueElements = container.querySelectorAll('.text-lg.font-black');
    const has50 = Array.from(valueElements).some((el) => el.textContent === '50');
    expect(has50).toBe(true);
  });

  it('computes participation frequency from rollcall stats', () => {
    const dashboard = {
      'class-1': {
        performance: [],
        rollcallStats: [
          { student_id: 's1', count: 4 },
          { student_id: 's2', count: 2 },
        ],
        assignments: [],
        recentSubmissions: [],
      },
    };
    render(<ClassSummaryStats classDashboardMap={dashboard} classes={[{ id: 'class-1' } as any]} lang={zh} />);
    expect(screen.getByText('3.0')).toBeTruthy();
    expect(screen.getAllByText('次/人').length).toBeGreaterThan(0);
  });

  it('aggregates across multiple classes', () => {
    const dashboard = {
      'class-1': {
        performance: [{ student_id: 's1', score: 100, submission_status: 'submitted' }],
        rollcallStats: [{ student_id: 's1', count: 5 }],
        assignments: [],
        recentSubmissions: [],
      },
      'class-2': {
        performance: [{ student_id: 's2', score: 80, submission_status: 'submitted' }],
        rollcallStats: [{ student_id: 's2', count: 3 }],
        assignments: [],
        recentSubmissions: [],
      },
    };
    render(
      <ClassSummaryStats
        classDashboardMap={dashboard}
        classes={[{ id: 'class-1' } as any, { id: 'class-2' } as any]}
        lang={en}
      />,
    );
    expect(screen.getByText('90')).toBeTruthy();
    expect(screen.getByText(/2 class\(es\) loaded/)).toBeTruthy();
  });
});
