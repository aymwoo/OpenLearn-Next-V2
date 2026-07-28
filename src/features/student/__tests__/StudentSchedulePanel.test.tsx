import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentSchedulePanel } from '../StudentSchedulePanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentSchedulePanel', () => {
  it('renders the schedule card and a join-class button', () => {
    render(
      <StudentSchedulePanel
        schedules={[
          {
            id: 's1',
            lesson_title: 'T',
            class_name: 'C',
            scheduled_date: '2026-01-01',
            attendance_status: null,
          },
        ]}
        setSelectedLesson={vi.fn()}
        setStudentViewStatus={vi.fn()}
      />
    );
    expect(screen.getByText('My Schedule')).toBeTruthy();
    expect(screen.getByText('Join Class')).toBeTruthy();
  });
});
