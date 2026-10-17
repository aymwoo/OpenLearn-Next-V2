import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { StudentType } from '../../../types/app';
import { StudentDashboardHeader } from '../StudentDashboardHeader';

afterEach(() => {
  cleanup();
});

describe('StudentDashboardHeader', () => {
  it('renders the welcome greeting with the active student name', () => {
    const students = [{ id: 's1', name: 'Alice' }] as unknown as StudentType[];
    render(<StudentDashboardHeader students={students} activeStudentId="s1" />);
    expect(screen.getByText('Welcome, Alice')).toBeTruthy();
  });

  it('Issue #109: shows a persistent return-to-class entry while a session is active', () => {
    const students = [{ id: 's1', name: 'Alice' }] as unknown as StudentType[];
    const onReturnToClass = vi.fn();
    render(
      <StudentDashboardHeader
        students={students}
        activeStudentId="s1"
        activeSession={{
          sessionId: 'sess-1',
          lessonId: 'les-1',
          lessonTitle: '物理探究实验课',
          classId: 'c1',
          className: '高一1班',
          stage: 'IN_CLASS_TEACHING',
          startedAt: Date.now(),
        }}
        onReturnToClass={onReturnToClass}
        lang="zh"
      />,
    );

    const btn = screen.getByTestId('student-header-return-to-class');
    expect(btn.textContent).toContain('返回课堂');
    fireEvent.click(btn);
    expect(onReturnToClass).toHaveBeenCalledTimes(1);
  });

  it('Issue #109: hides the return entry when there is no active session', () => {
    const students = [{ id: 's1', name: 'Alice' }] as unknown as StudentType[];
    render(<StudentDashboardHeader students={students} activeStudentId="s1" activeSession={null} />);
    expect(screen.queryByTestId('student-header-return-to-class')).toBeNull();
  });
});
