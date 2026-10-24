import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { StudentDefaultPasswordBanner } from '../StudentDefaultPasswordBanner';

describe('StudentDefaultPasswordBanner (Issue #94: 学生默认密码非阻塞提示)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the hint with a change action and a dismiss button', () => {
    const onOpenProfile = vi.fn();
    render(<StudentDefaultPasswordBanner userId="stu_1" lang="zh" onOpenProfile={onOpenProfile} />);

    expect(screen.getByText(/初始默认密码/)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();

    fireEvent.click(screen.getByText('去修改'));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('dismissible: hides after clicking dismiss and persists per userId in localStorage', () => {
    const { unmount } = render(<StudentDefaultPasswordBanner userId="stu_1" lang="zh" onOpenProfile={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('关闭提示'));
    // 立即消失
    expect(screen.queryByText(/初始默认密码/)).toBeNull();
    unmount();

    // 刷新（重新挂载）后仍不再打扰
    render(<StudentDefaultPasswordBanner userId="stu_1" lang="zh" onOpenProfile={vi.fn()} />);
    expect(screen.queryByText(/初始默认密码/)).toBeNull();
    expect(localStorage.getItem('edu_os_default_pwd_hint_dismissed_stu_1')).toBe('1');

    // 其他学生不受影响
    render(<StudentDefaultPasswordBanner userId="stu_2" lang="zh" onOpenProfile={vi.fn()} />);
    expect(screen.getByText(/初始默认密码/)).toBeTruthy();
  });

  it('renders English copy when lang is en', () => {
    render(<StudentDefaultPasswordBanner userId="stu_1" lang="en" onOpenProfile={vi.fn()} />);
    expect(screen.getByText(/initial default password/i)).toBeTruthy();
    expect(screen.getByText('Change now')).toBeTruthy();
  });
});
