import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DiagnosticCenterModal } from '../DiagnosticCenterModal';
import { errorStore } from '../../../../store/errorStore';

afterEach(cleanup);

const noopToast = vi.fn();

function seedErrors() {
  errorStore.setState({ errors: [], studentErrors: [], unreadCount: 0 });
  errorStore.getState().addStudentError({
    studentId: 'stu-1',
    studentName: '张子豪',
    type: 'react',
    title: '页面渲染崩溃',
    message: 'Cannot read properties of null (reading split)',
    timestamp: Date.now(),
    url: 'http://localhost/#/classroom',
  } as any);
  errorStore.getState().addStudentError({
    studentId: 'stu-2',
    studentName: '李晓彤',
    type: 'api',
    title: '课件提交失败',
    message: 'HTTP 500 /api/courseware/attempts/x/submit',
    timestamp: Date.now(),
    url: 'http://localhost/#/classroom',
  } as any);
  errorStore.getState().addError({
    type: 'runtime',
    title: '本机运行时错误',
    message: 'Something went wrong locally',
  } as any);
}

describe('DiagnosticCenterModal', () => {
  beforeEach(() => {
    noopToast.mockClear();
    seedErrors();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <DiagnosticCenterModal isOpen={false} onClose={noopToast} addToast={noopToast} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('默认展示学生端异常列表（含姓名与消息）', () => {
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    expect(screen.getByText('张子豪')).toBeTruthy();
    expect(screen.getByText(/Cannot read properties of null/)).toBeTruthy();
    expect(screen.getByText('李晓彤')).toBeTruthy();
  });

  it('tab 切换到本机异常', () => {
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    fireEvent.click(screen.getByText('本机异常'));
    expect(screen.getByText('本机运行时错误')).toBeTruthy();
  });

  it('类型筛选（api）只保留对应异常', () => {
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    fireEvent.click(screen.getByText('api'));
    expect(screen.getByText('李晓彤')).toBeTruthy();
    expect(screen.queryByText('张子豪')).toBeNull();
  });

  it('单条移除只移除该条', () => {
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    const before = errorStore.getState().studentErrors.length;
    const removeButtons = screen.getAllByTitle('移除');
    fireEvent.click(removeButtons[0]);
    expect(errorStore.getState().studentErrors.length).toBe(before - 1);
  });

  it('清空后列表为空并显示空态', () => {
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    fireEvent.click(screen.getByText('清空'));
    expect(errorStore.getState().studentErrors.length).toBe(0);
    expect(screen.getByText('暂无学生端异常')).toBeTruthy();
  });

  it('复制所有学生 ID 会调用剪贴板', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    fireEvent.click(screen.getByText('复制所有学生 ID'));
    expect(writeText).toHaveBeenCalledTimes(1);
    // studentErrors 按新增顺序前插（最新在前），故顺序为 stu-2, stu-1
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain('stu-1');
    expect(arg).toContain('stu-2');
    expect(arg.split(', ')).toHaveLength(2);
  });

  it('无异常时复制提示为空', () => {
    errorStore.setState({ errors: [], studentErrors: [] });
    render(<DiagnosticCenterModal isOpen={true} onClose={noopToast} addToast={noopToast} />);
    fireEvent.click(screen.getByText('复制所有学生 ID'));
    expect(noopToast).toHaveBeenCalledWith(expect.stringContaining('暂无学生 ID'), '', 'warning');
  });
});
