import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClassSchedulesCharts } from '../ClassSchedulesCharts';
import type { ClassType, StudentType } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    student_count: 2,
    ...overrides,
  };
}

function makeStudent(id: string, name: string): StudentType {
  return {
    id,
    name,
    email: `${id}@example.com`,
    password: '123456',
    private_notes: '',
  } as StudentType;
}

function baseProps(overrides: Record<string, any> = {}) {
  const cls = makeClass();
  return {
    cls,
    lang: 'zh' as const,
    cStudents: [] as StudentType[],
    classProgressMap: {
      'class-1': [{ lesson_title: 'L', average_progress: 50 }],
    },
    classSchedulesMap: {
      'class-1': [],
    },
    classDashboardMap: {
      'class-1': { assignments: [], performance: [] },
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassSchedulesCharts', () => {
  it('renders the Class Avg Completion chart and renders without throwing', () => {
    // ClassAttendanceSummaryChart fetches on mount; stub fetch for jsdom.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    render(<ClassSchedulesCharts {...baseProps()} />);
    expect(
      screen.getByText((c) => (c || '').includes('Class Avg Completion')),
    ).toBeTruthy();
  });
});
