import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentQuickStats } from '../StudentQuickStats';

afterEach(() => {
  cleanup();
});

describe('StudentQuickStats', () => {
  it('renders the four quick stat labels', () => {
    render(
      <StudentQuickStats
        studentDashboardData={{ classes: [], assignments: [], schedules: [] }}
      />
    );
    expect(screen.getByText('Enrolled Classes')).toBeTruthy();
    expect(screen.getByText('Completed Assignments')).toBeTruthy();
    expect(screen.getByText('Pending Assignments')).toBeTruthy();
    expect(screen.getByText('Upcoming Lessons')).toBeTruthy();
  });
});
