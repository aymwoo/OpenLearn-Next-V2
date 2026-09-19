import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { uiStore } from '../../../store/uiStore';
import * as clipboardModule from '../../../utils/clipboard';

describe('ToastContainer', () => {
  let copySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a success toast without copy button', () => {
    uiStore.getState().addToast({
      id: 't-success',
      title: '操作成功',
      message: '数据已同步',
      type: 'success',
    });

    render(<ToastContainer />);

    expect(screen.getByText('操作成功')).toBeTruthy();
    expect(screen.getByText('数据已同步')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /复制/ })).toBeNull();
  });

  it('renders an error toast with a copy button, which copies toast content to clipboard', async () => {
    uiStore.getState().addToast({
      id: 't-error',
      title: '接口错误',
      message: 'Worker timeout on plugin activation',
      type: 'error',
    });

    render(<ToastContainer />);

    expect(screen.getByText('接口错误')).toBeTruthy();
    expect(screen.getByText('Worker timeout on plugin activation')).toBeTruthy();

    const copyBtn = screen.getByRole('button', { name: /复制/ });
    expect(copyBtn).toBeTruthy();

    fireEvent.click(copyBtn);

    expect(copySpy).toHaveBeenCalledWith('[接口错误] Worker timeout on plugin activation');
  });
});
