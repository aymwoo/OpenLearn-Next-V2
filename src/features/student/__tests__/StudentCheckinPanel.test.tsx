import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StudentCheckinPanel } from '../StudentCheckinPanel';

describe('StudentCheckinPanel', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lessonId 为空时不渲染', () => {
    const { container } = render(<StudentCheckinPanel lessonId={null} lang="zh" addToast={addToast} />);
    expect(container.firstChild).toBeNull();
  });

  it('空码提交提示先输入', async () => {
    render(<StudentCheckinPanel lessonId="les-1" lang="zh" addToast={addToast} />);
    fireEvent.click(screen.getByText('签到'));
    expect(await screen.findByText('请先输入签到码')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('成功签到显示成功态并 toast', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    render(<StudentCheckinPanel lessonId="les-1" lang="zh" addToast={addToast} />);
    fireEvent.change(screen.getByLabelText('课堂签到码'), { target: { value: '4821' } });
    fireEvent.click(screen.getByText('签到'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/classroom/sessions/les-1/checkin', expect.anything()));
    expect(await screen.findByText(/签到成功，出勤已记录/)).toBeDefined();
    expect(addToast).toHaveBeenCalledWith('签到成功', '出勤已记录', 'success');
  });

  it('错误码显示可重试的错误态', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid checkin code' }) });
    render(<StudentCheckinPanel lessonId="les-1" lang="zh" addToast={addToast} />);
    fireEvent.change(screen.getByLabelText('课堂签到码'), { target: { value: '0000' } });
    fireEvent.click(screen.getByText('签到'));
    expect(await screen.findByText('签到码不正确，请核对大屏后重试')).toBeDefined();
  });
});
