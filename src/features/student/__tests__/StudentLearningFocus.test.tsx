import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StudentLearningFocus, pickContinueProgress, pickNextLesson } from '../StudentLearningFocus';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProps = {
  lang: 'zh' as const,
  setSelectedLesson: vi.fn(),
  setStudentViewStatus: vi.fn(),
  setSelectedAssignment: vi.fn(),
  setQuizStudentAnswers: vi.fn(),
  setSubAssignmentTab: vi.fn(),
};

describe('StudentLearningFocus', () => {
  it('renders the pending assignment and next lesson tiles', () => {
    render(
      <StudentLearningFocus
        {...baseProps}
        studentDashboardData={{
          assignments: [
            { id: 'a1', title: '物理实验报告', class_name: '高一1班', submission_status: null },
            { id: 'a2', title: '已交作业', class_name: '高一1班', submission_status: 'submitted' },
          ],
          schedules: [],
          progress: [],
        }}
      />,
    );

    expect(screen.getByTestId('student-learning-focus')).toBeTruthy();
    expect(screen.getByTestId('focus-pending-assignments').textContent).toContain('1 项待提交');
    expect(screen.getByText('物理实验报告')).toBeTruthy();
  });

  it('opens the first pending assignment when clicking the primary action', () => {
    const setSelectedAssignment = vi.fn();
    const setStudentViewStatus = vi.fn();
    const pending = { id: 'a1', title: '数学作业', class_name: '高一1班', submission_status: null };

    render(
      <StudentLearningFocus
        {...baseProps}
        setSelectedAssignment={setSelectedAssignment}
        setStudentViewStatus={setStudentViewStatus}
        studentDashboardData={{ assignments: [pending], schedules: [], progress: [] }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /开始完成作业/ }));
    expect(setSelectedAssignment).toHaveBeenCalledWith(pending);
    expect(setStudentViewStatus).toHaveBeenCalledWith('assignment');
  });

  it('opens the next lesson and disables the action when no lesson is linked', () => {
    const setSelectedLesson = vi.fn();
    const setStudentViewStatus = vi.fn();
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;

    const { rerender } = render(
      <StudentLearningFocus
        {...baseProps}
        setSelectedLesson={setSelectedLesson}
        setStudentViewStatus={setStudentViewStatus}
        studentDashboardData={{
          assignments: [],
          schedules: [
            {
              id: 's1',
              lesson_id: 'les-1',
              lesson_title: '力学',
              class_name: '高一1班',
              scheduled_date: ymd,
              time_slot: '23:59 - 23:59',
            },
          ],
          progress: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /进入课节/ }));
    expect(setSelectedLesson).toHaveBeenCalledWith('les-1');
    expect(setStudentViewStatus).toHaveBeenCalledWith('lesson');

    rerender(
      <StudentLearningFocus
        {...baseProps}
        setSelectedLesson={setSelectedLesson}
        setStudentViewStatus={setStudentViewStatus}
        studentDashboardData={{
          assignments: [],
          schedules: [
            {
              id: 's2',
              lesson_id: null,
              lesson_title: '待定内容',
              class_name: '高一1班',
              scheduled_date: ymd,
              time_slot: '23:59 - 23:59',
            },
          ],
          progress: [],
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /进入课节/ })).toHaveProperty('disabled', true);
  });

  it('renders nothing when there is no pending work, lesson or course', () => {
    const { container } = render(
      <StudentLearningFocus {...baseProps} studentDashboardData={{ assignments: [], schedules: [], progress: [] }} />,
    );
    expect(container.querySelector('[data-testid="student-learning-focus"]')).toBeNull();
  });
});

describe('pickNextLesson', () => {
  const now = new Date('2026-03-02T10:00:00');

  it('picks today lesson that has not ended yet', () => {
    const pick = pickNextLesson(
      [
        { id: 'ended', scheduled_date: '2026-03-02', time_slot: '08:00 - 09:00' },
        { id: 'later', scheduled_date: '2026-03-02', time_slot: '11:00 - 12:00' },
        { id: 'tomorrow', scheduled_date: '2026-03-03', time_slot: '08:00 - 09:00' },
      ],
      now,
    );

    expect(pick?.schedule.id).toBe('later');
    expect(pick?.isToday).toBe(true);
  });

  it('falls back to next week when this week is over', () => {
    const pick = pickNextLesson([{ id: 'only', scheduled_date: '2026-03-01', time_slot: '08:00 - 09:00' }], now);

    expect(pick?.schedule.id).toBe('only');
    expect(pick?.isNextWeek).toBe(true);
    expect(pick?.date).toBe('2026-03-08');
  });

  it('ignores cancelled and holiday schedules', () => {
    expect(pickNextLesson([{ id: 'cancelled', scheduled_date: '2026-03-02', status: 'cancelled' }], now)).toBeNull();
  });
});

describe('pickContinueProgress', () => {
  it('prefers the unfinished course with the highest progress', () => {
    expect(
      pickContinueProgress([
        { lesson_id: 'l1', progress_percent: 20 },
        { lesson_id: 'l2', progress_percent: 80 },
        { lesson_id: 'l3', progress_percent: 100 },
        { lesson_id: 'l4', progress_percent: 50, completed: 1 },
      ])?.lesson_id,
    ).toBe('l2');
  });
});
