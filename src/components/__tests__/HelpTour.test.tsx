import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { HelpTour } from '../HelpTour';

describe('HelpTour (#530)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('provides accessible dialog semantics and allows skipping from every step (Step 0..3)', () => {
    const onDismiss = vi.fn();
    render(
      <HelpTour
        isOpen={true}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Step 0 has Skip button
    fireEvent.click(screen.getByRole('button', { name: '跳过向导' }));
    expect(onDismiss).toHaveBeenNthCalledWith(1, 'skipped');

    // Advance through Step 1 -> Step 2 -> Step 3; Skip remains visible on every step
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('第 1 步：一键初始化示例课程')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '跳过向导' }));
    expect(onDismiss).toHaveBeenNthCalledWith(2, 'skipped');

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('第 2 步：了解系统导航菜单')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '跳过向导' }));
    expect(onDismiss).toHaveBeenNthCalledWith(3, 'skipped');

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('第 3 步：进入互动课堂开启体验')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '跳过向导' }));
    expect(onDismiss).toHaveBeenNthCalledWith(4, 'skipped');
  });

  it('dismisses via X button, Escape key, and backdrop click outside the popover', () => {
    const onDismiss = vi.fn();
    render(
      <HelpTour
        isOpen={true}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '跳过并关闭向导' }));
    expect(onDismiss).toHaveBeenNthCalledWith(1, 'skipped');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenNthCalledWith(2, 'skipped');

    // Click backdrop wrapper outside the dialog card
    const dialog = screen.getByRole('dialog');
    const wrapper = dialog.parentElement!;
    fireEvent.click(wrapper);
    expect(onDismiss).toHaveBeenNthCalledWith(3, 'skipped');
  });

  it('completes on Step 3 final CTA and resets back to Step 0 when reopened', () => {
    const onDismiss = vi.fn();
    const onJumpTab = vi.fn();
    const { rerender } = render(
      <HelpTour
        isOpen={true}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={onJumpTab}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '结束引导并开课' }));

    expect(onJumpTab).toHaveBeenCalledWith('live_class');
    expect(onDismiss).toHaveBeenCalledWith('completed');

    rerender(
      <HelpTour
        isOpen={false}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={onJumpTab}
      />,
    );
    rerender(
      <HelpTour
        isOpen={true}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={onJumpTab}
      />,
    );

    expect(screen.getByText('欢迎来到 OpenLearn Next V2 平台！')).toBeTruthy();
  });

  it('renders visible error feedback when seeding fails instead of failing silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: '数据库写入受限' }),
      }),
    );

    render(
      <HelpTour
        isOpen={true}
        onClose={vi.fn()}
        onDismiss={vi.fn()}
        lang="zh"
        onSeedSuccess={vi.fn()}
        onJumpTab={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '一键初始化示范数据' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('数据库写入受限');
    });
  });
});
