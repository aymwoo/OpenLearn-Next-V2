import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LearningProgressTrendChart } from '../../../components/LearningProgressTrendChart';
import type { StudentProgressType } from '../../../types/app';

// Recharts uses ResizeObserver internally; stub it for jsdom
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});

const makeProgress = (overrides: Partial<StudentProgressType> & { lesson_id: string }): StudentProgressType => ({
  student_id: 's-101',
  lesson_title: `Lesson ${overrides.lesson_id}`,
  completed: 0,
  progress_percent: 50,
  assigned_at: Date.now(),
  ...overrides,
});

describe('LearningProgressTrendChart', () => {
  it('renders empty state when progressHistory is empty', () => {
    render(<LearningProgressTrendChart progressHistory={[]} lang="zh" />);
    expect(screen.getByTestId('learning-progress-trend-empty')).toBeTruthy();
    expect(screen.getByText('暂无学习进度记录')).toBeTruthy();
  });

  it('renders empty state in English', () => {
    render(<LearningProgressTrendChart progressHistory={[]} lang="en" />);
    expect(screen.getByText('No Progress Records Yet')).toBeTruthy();
  });

  it('renders chart container with data points', () => {
    const progressHistory: StudentProgressType[] = [
      makeProgress({ lesson_id: 'l1', lesson_title: 'Python 基础', progress_percent: 30, assigned_at: 1700000000000 }),
      makeProgress({ lesson_id: 'l2', lesson_title: '循环结构', progress_percent: 65, assigned_at: 1700100000000 }),
      makeProgress({ lesson_id: 'l3', lesson_title: '函数定义', progress_percent: 100, completed: 1, assigned_at: 1700200000000 }),
    ];

    const { container } = render(<LearningProgressTrendChart progressHistory={progressHistory} lang="zh" />);
    expect(screen.getByTestId('learning-progress-trend-chart')).toBeTruthy();
    expect(screen.getByText('课程学习进度趋势')).toBeTruthy();
    // Stats row should display computed values
    expect(screen.getByText('65%')).toBeTruthy(); // average of 30+65+100=195/3=65
    expect(screen.getByText('1/3')).toBeTruthy(); // 1 completed out of 3
    expect(screen.getByText('3')).toBeTruthy(); // total lessons
  });

  it('renders chart in English mode', () => {
    const progressHistory: StudentProgressType[] = [
      makeProgress({ lesson_id: 'l1', lesson_title: 'Intro to Python', progress_percent: 80, assigned_at: 1700000000000 }),
      makeProgress({ lesson_id: 'l2', lesson_title: 'Loops', progress_percent: 90, completed: 1, assigned_at: 1700100000000 }),
    ];

    render(<LearningProgressTrendChart progressHistory={progressHistory} lang="en" />);
    expect(screen.getByText('Learning Progress Trend')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
  });

  it('deduplicates by lesson_id, keeping the latest entry', () => {
    const progressHistory: StudentProgressType[] = [
      makeProgress({ lesson_id: 'l1', lesson_title: 'Python 基础', progress_percent: 30, assigned_at: 1700000000000 }),
      makeProgress({ lesson_id: 'l1', lesson_title: 'Python 基础', progress_percent: 80, assigned_at: 1700200000000 }), // newer, should be kept
      makeProgress({ lesson_id: 'l2', lesson_title: '循环结构', progress_percent: 60, assigned_at: 1700100000000 }),
    ];

    render(<LearningProgressTrendChart progressHistory={progressHistory} lang="zh" />);
    // Average should be (80+60)/2 = 70, not (30+80+60)/3 = ~57
    expect(screen.getByText('70%')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // only 2 unique lessons
  });

  it('clamps progress_percent to 0-100 range', () => {
    const progressHistory: StudentProgressType[] = [
      makeProgress({ lesson_id: 'l1', progress_percent: -10, assigned_at: 1700000000000 }),
      makeProgress({ lesson_id: 'l2', progress_percent: 150, assigned_at: 1700100000000 }),
    ];

    render(<LearningProgressTrendChart progressHistory={progressHistory} lang="zh" />);
    // Clamped: 0 + 100 = 100 / 2 = 50
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('applies compact mode when compact prop is true', () => {
    const progressHistory: StudentProgressType[] = [
      makeProgress({ lesson_id: 'l1', progress_percent: 50, assigned_at: 1700000000000 }),
    ];

    render(<LearningProgressTrendChart progressHistory={progressHistory} lang="zh" compact />);
    expect(screen.getByTestId('learning-progress-trend-chart')).toBeTruthy();
  });
});
