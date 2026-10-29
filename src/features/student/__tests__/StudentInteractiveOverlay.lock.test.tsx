import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { StudentInteractiveOverlay } from '../StudentInteractiveOverlay';

// StudentCountdownBanner 会挂 socket 监听，单测里没有 socket 服务，直接空实现。
vi.mock('../StudentCountdownBanner', () => ({
  StudentCountdownBanner: () => null,
}));

describe('StudentInteractiveOverlay — 全班专注锁定', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ hasActiveSession: false }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('锁定期间节奏信号条按钮禁用，并显示锁定标识', async () => {
    await act(async () => {
      render(<StudentInteractiveOverlay lessonId="lesson-1" interactionLocked lang="zh" />);
    });

    expect(screen.getByTestId('student-overlay-lock-chip')).toBeTruthy();
    for (const title of [/听懂了/, /有点困惑/, /讲得太快/, /讲太慢/]) {
      const btn = screen.getByTitle(title) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
  });

  it('未锁定时按钮可用且无锁定标识', async () => {
    await act(async () => {
      render(<StudentInteractiveOverlay lessonId="lesson-1" lang="zh" />);
    });

    expect(screen.queryByTestId('student-overlay-lock-chip')).toBeNull();
    const btn = screen.getByTitle(/听懂了/) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
