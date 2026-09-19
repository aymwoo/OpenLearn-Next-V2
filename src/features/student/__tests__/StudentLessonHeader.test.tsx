import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonHeader } from '../StudentLessonHeader';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProps(overrides: Record<string, unknown> = {}) {
  const students = [{ id: 's1', name: 'Alice', locked_lesson_id: null }] as unknown as StudentType[];
  const lessons = [{ id: 'l1', title: 'Math' }] as unknown as Lesson[];
  return {
    students,
    activeStudentId: 's1',
    setStudentViewStatus: vi.fn(),
    setSelectedLesson: vi.fn(),
    lessons,
    selectedLesson: 'l1',
    ...overrides,
  };
}

describe('StudentLessonHeader', () => {
  it('renders the Back to Dashboard button when not in restricted mode', () => {
    render(<StudentLessonHeader {...makeProps()} />);
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });

  it('replaces the Back to Dashboard button with a lock banner when isStudentLocked', () => {
    render(<StudentLessonHeader {...makeProps({ isStudentLocked: true, lang: 'zh' })} />);
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.getByText('全班专注锁定 · 跟随教师授课')).toBeTruthy();
  });

  it('still derives the locked state from locked_lesson_id for legacy callers', () => {
    const students = [{ id: 's1', name: 'Alice', locked_lesson_id: 'l1' }] as unknown as StudentType[];
    render(<StudentLessonHeader {...makeProps({ students, lang: 'en' })} />);
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.getByText('Class Focus Locked · Following Teacher')).toBeTruthy();
  });
});
