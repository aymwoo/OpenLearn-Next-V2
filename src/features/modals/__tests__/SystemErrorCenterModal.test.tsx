import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SystemErrorCenterModal } from '../SystemErrorCenterModal';
import { errorStore } from '../../../store/errorStore';
import { appStore } from '../../../store/appStore';
import * as clipboardModule from '../../../utils/clipboard';

describe('SystemErrorCenterModal', () => {
  let copySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorStore.getState().clearErrors();
    errorStore.getState().clearStudentErrors();
    errorStore.getState().setIsErrorCenterOpen(false);
    appStore.setState({ session: null });
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

  it('renders minimal exclamation icon button with numeric badge in student mode (low visibility)', () => {
    appStore.setState({
      session: {
        userId: 'stu-1',
        name: '小明',
        role: 'student',
        token: 'tok-stu',
      } as any,
    });

    errorStore.getState().addError({
      type: 'runtime',
      title: 'Student Error',
      message: 'Script crash',
    });

    render(<SystemErrorCenterModal />);

    // Must NOT render verbose text from teacher pill
    expect(screen.queryByText('处系统异常')).toBeNull();
    expect(screen.queryByText('查看与复制')).toBeNull();

    // Must render minimal button with badge
    const pillBtn = screen.getByRole('button');
    expect(pillBtn).toBeTruthy();
    expect(pillBtn.getAttribute('title')).toContain('系统状态提示: 1 处异常');
    expect(screen.getByText('1')).toBeTruthy();

    // Reset session
    appStore.setState({ session: null });
  });

  it('allows teacher to switch to student errors tab and view student exceptions', () => {
    appStore.setState({
      session: {
        userId: 'usr_teacher',
        name: '李老师',
        role: 'teacher',
        token: 'tok-teacher',
      } as any,
    });


    errorStore.getState().addStudentError({
      id: 'st-err-test',
      studentId: 'stu-999',
      studentName: '王大锤',
      lessonId: 'lesson-101',
      classId: 'class-A',
      type: 'runtime',
      title: '课件加载失败',
      message: 'Failed to load script bundle in iframe',
      timestamp: Date.now(),
      url: 'http://localhost:9000/student_live',
    });

    errorStore.getState().setIsErrorCenterOpen(true);
    render(<SystemErrorCenterModal />);

    // Check student errors tab exists
    const studentTabBtn = screen.getByRole('button', { name: /学生端异常/ });
    expect(studentTabBtn).toBeTruthy();

    fireEvent.click(studentTabBtn);

    expect(screen.getByText('王大锤')).toBeTruthy();
    expect(screen.getByText('Failed to load script bundle in iframe')).toBeTruthy();
    expect(screen.getByText('学生学号/ID: stu-999')).toBeTruthy();

    // Reset
    appStore.setState({ session: null });
  });
});

