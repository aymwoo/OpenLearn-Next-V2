import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClassScheduleAttendance } from '../ClassScheduleAttendance';
import type { ClassType, StudentType, Lesson } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'cls-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    student_count: 2,
    ...overrides,
  };
}

function baseProps(overrides: Record<string, any> = {}) {
  const cls = makeClass();
  return {
    cls,
    lang: 'zh' as const,
    cStudents: [] as StudentType[],
    newScheduleDate: '',
    setNewScheduleDate: vi.fn(),
    newScheduleLessonId: '',
    setNewScheduleLessonId: vi.fn(),
    lessons: [] as Lesson[],
    fetchClassSchedules: vi.fn(),
    classSchedulesMap: { 'cls-1': [] },
    expandedScheduleId: null,
    setExpandedScheduleId: vi.fn(),
    fetchScheduleAttendance: vi.fn(),
    scheduleAttendanceMap: {},
    get30DayAverageWarning: () => null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassScheduleAttendance', () => {
  it('renders the Schedule & Attendance header and Schedule button without throwing', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    render(<ClassScheduleAttendance {...baseProps()} />);
    expect(
      screen.getByText((c) => (c || '').includes('Schedule & Attendance')),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Schedule' }),
    ).toBeTruthy();
  });
});
