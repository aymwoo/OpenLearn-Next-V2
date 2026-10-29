import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClassroomOverlays } from '../ClassroomOverlays';

// 只验证「全班专注锁定」标志是否透传到学生浮层：
// 浮层本体由 StudentInteractiveOverlay.lock.test.tsx 覆盖。
vi.mock('../../features/student/StudentInteractiveOverlay', () => ({
  StudentInteractiveOverlay: (props: { interactionLocked?: boolean }) => (
    <div data-testid="student-overlay" data-locked={String(!!props.interactionLocked)} />
  ),
}));

describe('ClassroomOverlays — 专注锁定透传', () => {
  afterEach(() => {
    cleanup();
  });

  it('isInteractionLocked 为 true 时下发给学生浮层', () => {
    render(<ClassroomOverlays activeRole="student" isInteractionLocked />);
    expect(screen.getByTestId('student-overlay').getAttribute('data-locked')).toBe('true');
  });

  it('默认（未锁定）不下发锁定态', () => {
    render(<ClassroomOverlays activeRole="student" />);
    expect(screen.getByTestId('student-overlay').getAttribute('data-locked')).toBe('false');
  });
});
