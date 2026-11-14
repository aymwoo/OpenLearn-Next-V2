import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ForcedPasswordChangeGate from '../ForcedPasswordChangeGate';

/**
 * SEC-AUTH-06: 默认密码强制改密门 —— 前端校验与提交流程。
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ForcedPasswordChangeGate', () => {
  it('渲染安全提示与表单，不渲染任何应用内容', () => {
    render(<ForcedPasswordChangeGate lang="zh" username="admin" onDone={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByText('安全要求：修改默认密码')).toBeTruthy();
    expect(screen.getByText(/admin/)).toBeTruthy();
  });

  it('两次新密码不一致 → 显示本地校验错误，不发起请求', () => {
    render(<ForcedPasswordChangeGate lang="zh" onDone={vi.fn()} onLogout={vi.fn()} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'admin' } });
    fireEvent.change(inputs[1], { target: { value: 'NewPass-2026' } });
    fireEvent.change(inputs[2], { target: { value: 'Different-999' } });
    fireEvent.click(screen.getByTestId('force-change-submit'));
    expect(screen.getByTestId('force-change-error').textContent).toContain('不一致');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('新密码不满足强度要求 → 本地校验错误', () => {
    render(<ForcedPasswordChangeGate lang="zh" onDone={vi.fn()} onLogout={vi.fn()} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'admin' } });
    fireEvent.change(inputs[1], { target: { value: 'short' } });
    fireEvent.change(inputs[2], { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('force-change-submit'));
    expect(screen.getByTestId('force-change-error').textContent).toContain('8 位');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('提交成功 → 调用 onDone', async () => {
    const onDone = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<ForcedPasswordChangeGate lang="zh" onDone={onDone} onLogout={vi.fn()} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'admin' } });
    fireEvent.change(inputs[1], { target: { value: 'NewPass-2026' } });
    fireEvent.change(inputs[2], { target: { value: 'NewPass-2026' } });
    fireEvent.click(screen.getByTestId('force-change-submit'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/change-password', expect.objectContaining({ method: 'POST' }));
  });

  it('服务端拒绝（旧密码错误）→ 展示错误且不调 onDone', async () => {
    const onDone = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Incorrect old password' }) });
    render(<ForcedPasswordChangeGate lang="zh" onDone={onDone} onLogout={vi.fn()} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'wrong-old' } });
    fireEvent.change(inputs[1], { target: { value: 'NewPass-2026' } });
    fireEvent.change(inputs[2], { target: { value: 'NewPass-2026' } });
    fireEvent.click(screen.getByTestId('force-change-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('force-change-error').textContent).toContain('Incorrect old password'),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('显示/隐藏密码按钮切换 aria-pressed 与 input type，校验失败聚焦首个无效字段并设置 aria-invalid', () => {
    render(<ForcedPasswordChangeGate lang="zh" onDone={vi.fn()} onLogout={vi.fn()} />);

    const oldInput = document.getElementById('force-old-password') as HTMLInputElement;
    const newInput = document.getElementById('force-new-password') as HTMLInputElement;
    const confirmInput = document.getElementById('force-confirm-password') as HTMLInputElement;

    expect(oldInput.getAttribute('aria-invalid')).toBe('false');
    expect(newInput.getAttribute('aria-invalid')).toBe('false');
    expect(confirmInput.getAttribute('aria-describedby')).toBeNull();

    const toggleButtons = screen.getAllByRole('button', { name: '显示密码' });
    expect(toggleButtons.length).toBe(3);
    expect(toggleButtons[0].getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggleButtons[0]);
    expect(oldInput.type).toBe('text');
    expect(toggleButtons[0].getAttribute('aria-pressed')).toBe('true');

    // Fill old & weak new password, submit -> focuses newInput and sets aria-invalid + aria-describedby error
    fireEvent.change(oldInput, { target: { value: 'admin' } });
    fireEvent.change(newInput, { target: { value: 'abc' } });
    fireEvent.change(confirmInput, { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('force-change-submit'));

    expect(document.activeElement).toBe(newInput);
    expect(newInput.getAttribute('aria-invalid')).toBe('true');
    expect(newInput.getAttribute('aria-describedby')).toContain('force-new-password-error');
  });
});
