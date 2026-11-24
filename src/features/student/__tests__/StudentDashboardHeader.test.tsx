import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

  it('不在欢迎头部重复渲染「返回课堂」，返回入口只保留在课堂横幅', () => {
    const students = [{ id: 's1', name: 'Alice' }] as unknown as StudentType[];
    render(<StudentDashboardHeader students={students} activeStudentId="s1" />);
    expect(screen.queryByTestId('student-header-return-to-class')).toBeNull();
    expect(screen.queryByRole('button', { name: '返回课堂' })).toBeNull();
  });
});
