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
});
