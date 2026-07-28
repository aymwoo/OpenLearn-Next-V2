import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonHeader } from '../StudentLessonHeader';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentLessonHeader', () => {
  it('renders the Back to Dashboard button when not in restricted mode', () => {
    const students = [{ id: 's1', name: 'Alice', locked_lesson_id: null }] as unknown as StudentType[];
    const lessons = [{ id: 'l1', title: 'Math' }] as unknown as Lesson[];
    render(
      <StudentLessonHeader
        students={students}
        activeStudentId="s1"
        setStudentViewStatus={vi.fn()}
        setSelectedLesson={vi.fn()}
        lessons={lessons}
        selectedLesson="l1"
      />,
    );
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });
});
