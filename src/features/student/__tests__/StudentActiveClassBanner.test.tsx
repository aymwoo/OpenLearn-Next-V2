import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StudentActiveClassBanner } from '../StudentActiveClassBanner';
import type { StudentActiveSession } from '../useStudentActiveSession';

const session: StudentActiveSession = {
  sessionId: 'sess-1',
  lessonId: 'les-1',
  lessonTitle: '物理探究实验课',
  classId: 'cls-1',
  className: '高一1班',
  stage: 'IN_CLASS_TEACHING',
  startedAt: Date.now() - 12 * 60000,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentActiveClassBanner (Issue #109)', () => {
  it('shows the ongoing class with a return action', () => {
    const onReturn = vi.fn();
    render(<StudentActiveClassBanner activeSession={session} lang="zh" onReturn={onReturn} />);

    expect(screen.getByText('正在上课：物理探究实验课')).toBeTruthy();
    expect(screen.getByText(/高一1班/)).toBeTruthy();
    expect(screen.getByText(/已进行 12 分钟/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回课堂' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('uses the "class started" copy for PRE_CLASS_READY sessions', () => {
    render(
      <StudentActiveClassBanner
        activeSession={{ ...session, stage: 'PRE_CLASS_READY', startedAt: null }}
        lang="zh"
        onReturn={vi.fn()}
      />,
    );
    expect(screen.getByText('课堂已开启：物理探究实验课')).toBeTruthy();
    expect(screen.queryByText(/已进行/)).toBeNull();
  });

  it('renders English copy when lang is en', () => {
    render(<StudentActiveClassBanner activeSession={session} lang="en" onReturn={vi.fn()} />);
    expect(screen.getByText('In class: 物理探究实验课')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to class' })).toBeTruthy();
  });

  it('is exposed as a status region for assistive technology', () => {
    render(<StudentActiveClassBanner activeSession={session} lang="zh" onReturn={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
