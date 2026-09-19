import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SystemErrorCenterModal } from '../SystemErrorCenterModal';
import { errorStore } from '../../../store/errorStore';
import * as clipboardModule from '../../../utils/clipboard';

describe('SystemErrorCenterModal', () => {
  let copySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorStore.getState().clearErrors();
    copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no errors and modal is closed', () => {
    const { container } = render(<SystemErrorCenterModal />);
    expect(container.querySelector('#system-error-pill')).toBeNull();
  });

  it('renders floating pill when errorStore has errors', () => {
    errorStore.getState().addError({
      type: 'api',
      title: 'Database locked',
      message: 'SQLITE_BUSY: database is locked',
    });

    render(<SystemErrorCenterModal />);

    expect(screen.getByText('捕获到')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('处系统异常')).toBeTruthy();
  });

  it('opens modal when floating pill is clicked and displays error item', () => {
    errorStore.getState().addError({
      type: 'promise',
      title: 'Worker Timeout',
      message: 'Worker activation timed out after 60000ms',
    });

    render(<SystemErrorCenterModal />);

    const pill = screen.getByText('查看与复制');
    fireEvent.click(pill);

    expect(screen.getByText('系统异常诊断中心 (System Diagnostics)')).toBeTruthy();
    expect(screen.getByText('Worker activation timed out after 60000ms')).toBeTruthy();
  });

  it('copies all errors to clipboard when "一键复制全部诊断日志" is clicked', async () => {
    errorStore.getState().addError({
      type: 'runtime',
      title: 'Script Syntax Error',
      message: 'Unexpected token <',
    });

    errorStore.getState().setIsErrorCenterOpen(true);

    render(<SystemErrorCenterModal />);

    const copyAllBtn = screen.getByRole('button', { name: /一键复制全部诊断日志/ });
    fireEvent.click(copyAllBtn);

    expect(copySpy).toHaveBeenCalledWith(expect.stringContaining('Unexpected token <'));
  });

  it('clears errors when trash button is clicked', () => {
    errorStore.getState().addError({
      type: 'api',
      title: 'API Error',
      message: 'Internal Error',
    });

    errorStore.getState().setIsErrorCenterOpen(true);

    render(<SystemErrorCenterModal />);

    const trashBtn = screen.getByTitle('清空记录');
    fireEvent.click(trashBtn);

    expect(errorStore.getState().errors).toHaveLength(0);
    expect(screen.getByText('暂无捕获到的系统异常')).toBeTruthy();
  });
});
