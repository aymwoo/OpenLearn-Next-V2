import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentRollCallAlarms } from '../StudentRollCallAlarms';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentRollCallAlarms', () => {
  it('renders the roll call alarm text when there is an unread rollcall', () => {
    render(
      <StudentRollCallAlarms
        studentDashboardData={{ rollcalls: [{ id: 'r1', lesson_title: 'Math' }] }}
        readNotifications={new Set()}
        setReadNotifications={vi.fn()}
        activeStudentId="s1"
        addToast={vi.fn()}
        lang="zh"
      />
    );
    expect(screen.getByText('⚡️ 闪电提问点名中，请立即回应！')).toBeTruthy();
  });
});
