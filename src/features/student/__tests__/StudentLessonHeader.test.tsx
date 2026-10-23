import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonHeader } from '../StudentLessonHeader';
import { studentActiveSessionStore } from '../useStudentActiveSession';

beforeEach(() => {
  studentActiveSessionStore.setState({ activeSession: null, loading: false, studentKey: null });
});

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

  it('Issue #109: warns that the class is still running when leaving the classroom', () => {
    studentActiveSessionStore.setState({
      activeSession: {
        sessionId: 'sess-1',
        lessonId: 'l1',
        lessonTitle: 'Math',
        classId: 'c1',
        className: 'Class 1',
        stage: 'IN_CLASS_TEACHING',
        startedAt: Date.now(),
      },
      loading: false,
      studentKey: 's1',
    });
    const addToast = vi.fn();
    const setStudentViewStatus = vi.fn();
    const setSelectedLesson = vi.fn();

    render(<StudentLessonHeader {...makeProps({ addToast, setStudentViewStatus, setSelectedLesson, lang: 'zh' })} />);
    fireEvent.click(screen.getByText('Back to Dashboard'));

    expect(setStudentViewStatus).toHaveBeenCalledWith('dashboard');
    expect(setSelectedLesson).toHaveBeenCalledWith(null);
    expect(addToast).toHaveBeenCalledWith('课堂仍在进行', expect.stringContaining('返回课堂'), 'info');

    studentActiveSessionStore.setState({ activeSession: null, loading: false, studentKey: null });
  });

  it('Issue #109: does not warn when no class session is running', () => {
    const addToast = vi.fn();
    render(<StudentLessonHeader {...makeProps({ addToast, lang: 'zh' })} />);
    fireEvent.click(screen.getByText('Back to Dashboard'));
    expect(addToast).not.toHaveBeenCalled();
  });

  it('Issue #110: renders answer lock banner when lockMode is navigation', () => {
    render(<StudentLessonHeader {...makeProps({ isStudentLocked: true, lockMode: 'navigation', lang: 'zh' })} />);
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.getByText('答题锁定中 · 请完成作答后提交，暂时无法离开本页')).toBeTruthy();
  });

  it('Issue #110: renders english answer lock banner when lockMode is navigation and lang is en', () => {
    render(<StudentLessonHeader {...makeProps({ isStudentLocked: true, lockMode: 'navigation', lang: 'en' })} />);
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.getByText('Answer Locked · Complete and submit work')).toBeTruthy();
  });
});
