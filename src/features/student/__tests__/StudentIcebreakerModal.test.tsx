import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StudentIcebreakerModal } from '../StudentIcebreakerModal';

describe('StudentIcebreakerModal', () => {
  const addToast = vi.fn();
  const onClose = vi.fn();
  const onCheckinSuccess = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('isOpen 为 false 时不渲染任何内容', () => {
    const { container } = render(
      <StudentIcebreakerModal
        isOpen={false}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('isOpen 为 true 时正常渲染 3 个心态选项及标题', () => {
    render(
      <StudentIcebreakerModal
        isOpen={true}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
      />,
    );
    expect(screen.getByText('课前破冰心情打卡')).toBeDefined();
    expect(screen.getByText('充满电')).toBeDefined();
    expect(screen.getByText('需要咖啡')).toBeDefined();
    expect(screen.getByText('需要帮助')).toBeDefined();
  });

  it('未选择任何心情时，打卡按钮处于禁用状态', () => {
    render(
      <StudentIcebreakerModal
        isOpen={true}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
      />,
    );
    const submitBtn = screen.getByTestId('icebreaker-submit-btn');
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('选中「充满电」后点击打卡，正确发起 POST 请求并触发成功回调', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        stats: { fullPower: 1, needCoffee: 0, needHelp: 0 },
      }),
    });

    render(
      <StudentIcebreakerModal
        isOpen={true}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
        onCheckinSuccess={onCheckinSuccess}
        addToast={addToast}
      />,
    );

    fireEvent.click(screen.getByTestId('mood-option-fullPower'));
    const submitBtn = screen.getByTestId('icebreaker-submit-btn');
    expect(submitBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/classes/C1/checkin/icebreaker',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mood: 'fullPower', lessonId: 'L1' }),
        }),
      );
    });

    expect(onCheckinSuccess).toHaveBeenCalledWith({ fullPower: 1, needCoffee: 0, needHelp: 0 });
    expect(addToast).toHaveBeenCalledWith('打卡成功！', expect.stringContaining('老师已收到你的课前心态'), 'success');
    expect(onClose).toHaveBeenCalled();
    expect(sessionStorage.getItem('icebreaker_checked_S1_C1_L1')).toBe('fullPower');
  });

  it('点击「稍后再说 / 跳过」记录 sessionStorage 状态并触发 onClose', () => {
    render(
      <StudentIcebreakerModal
        isOpen={true}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
      />,
    );

    fireEvent.click(screen.getByTestId('icebreaker-skip-btn'));
    expect(sessionStorage.getItem('icebreaker_skipped_S1_C1_L1')).toBe('1');
    expect(onClose).toHaveBeenCalled();
  });

  it('打卡接口返回错误时，展示错误提示文本且不关闭弹窗', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    render(
      <StudentIcebreakerModal
        isOpen={true}
        onClose={onClose}
        classId="C1"
        lessonId="L1"
        studentId="S1"
        lang="zh"
      />,
    );

    fireEvent.click(screen.getByTestId('mood-option-needHelp'));
    fireEvent.click(screen.getByTestId('icebreaker-submit-btn'));

    expect(await screen.findByText('Forbidden')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });
});
