import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentCourseProgressList } from '../StudentCourseProgressList';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentCourseProgressList', () => {
  it('renders the course progress card and a start-learning button', () => {
    render(
      <StudentCourseProgressList
        progress={[
          {
            lesson_id: 'l1',
            lesson_title: 'Math',
            progress_percent: 0,
            completed: 0,
          },
        ]}
        setSelectedLesson={vi.fn()}
        setStudentViewStatus={vi.fn()}
      />
    );
    expect(screen.getByText('My Independent Courses')).toBeTruthy();
    expect(screen.getByText('Start Learning')).toBeTruthy();
  });
});
