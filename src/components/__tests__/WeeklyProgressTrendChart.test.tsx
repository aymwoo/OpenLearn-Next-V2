import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WeeklyProgressTrendChart } from '../WeeklyProgressTrendChart';

afterEach(() => {
  cleanup();
});

describe('WeeklyProgressTrendChart', () => {
  it('renders the chart header and demo data in English', () => {
    render(<WeeklyProgressTrendChart assignments={[]} lang="en" />);
    expect(screen.getByText('Weekly Progress Trend')).toBeTruthy();
    expect(screen.getByText('Current Week Avg')).toBeTruthy();
  });

  it('renders correctly in Chinese', () => {
    render(<WeeklyProgressTrendChart assignments={[]} lang="zh" />);
    expect(screen.getByText('每周学业进展趋势 (Weekly Progress)')).toBeTruthy();
    expect(screen.getByText('最新周均分')).toBeTruthy();
  });

  it('aggregates real graded assignments by week and renders', () => {
    const mockAssignments = [
      {
        id: 'ast-1',
        title: 'Math Quiz 1',
        class_name: 'Mathematics',
        submission_status: 'graded',
        score: 85,
        feedback: 'Good work',
        submitted_at: 1714500000000,
        graded_at: 1714503600000,
        content: '',
      },
      {
        id: 'ast-2',
        title: 'Math Quiz 2',
        class_name: 'Mathematics',
        submission_status: 'graded',
        score: 92,
        feedback: 'Excellent',
        submitted_at: 1715100000000,
        graded_at: 1715103600000,
        content: '',
      },
      {
        id: 'ast-3',
        title: 'History Essay',
        class_name: 'History',
        submission_status: 'graded',
        score: 88,
        feedback: 'Solid analysis',
        submitted_at: 1715700000000,
        graded_at: 1715703600000,
        content: '',
      },
    ];

    render(<WeeklyProgressTrendChart assignments={mockAssignments} lang="en" />);
    expect(screen.getByText('Weekly Progress Trend')).toBeTruthy();
    expect(screen.getByText('Peak Week Avg')).toBeTruthy();
  });
});
