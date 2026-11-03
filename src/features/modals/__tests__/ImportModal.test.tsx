import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ImportModal } from '../ImportModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImportModal (Issue #389)', () => {
  const defaultProps = {
    show: true,
    onClose: vi.fn(),
    lang: 'zh',
    handleImportFile: vi.fn(),
    importError: null,
    importSuccess: null,
    isImporting: false,
    downloadCSVTemplate: vi.fn(),
  };

  it('当 show 为 false 时不渲染任何内容', () => {
    const { container } = render(<ImportModal {...defaultProps} show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('中文语言环境下正确渲染包含「性别」的 CSV 示例与说明', () => {
    render(<ImportModal {...defaultProps} lang="zh" />);

    // 检查示例代码块是否包含全部 8 个字段
    expect(screen.getByText(/班级名称, 班级描述, 学生学号, 学生姓名, 学生邮箱, 初始密码, 学生备注, 性别/)).toBeTruthy();
    expect(screen.getByText(/高一A班, 基础英语课程, 20260101, 李明, liming@example.com, , 数学较弱, 男/)).toBeTruthy();

    // 检查性别说明项
    expect(screen.getByText('性别')).toBeTruthy();
    expect(screen.getByText(/选填（男\/女 或 male\/female）/)).toBeTruthy();
  });

  it('英文语言环境下正确渲染英文表头示例与说明', () => {
    render(<ImportModal {...defaultProps} lang="en" />);

    expect(
      screen.getByText(
        /Class Name, Class Desc, Student Number, Student Name, Student Email, Initial Password, Student Notes, Gender/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Class 101, Introduction to English, 20260101, John Doe, john@example.com, , , Male/),
    ).toBeTruthy();

    expect(screen.getByText('Gender')).toBeTruthy();
    expect(screen.getByText(/Used for student avatar rendering in classroom focus monitor/)).toBeTruthy();
  });

  it('点击模板下载按钮正确触发对应类型的回调', () => {
    const downloadCSVTemplate = vi.fn();
    render(<ImportModal {...defaultProps} downloadCSVTemplate={downloadCSVTemplate} />);

    fireEvent.click(screen.getByText('下载班级与学生模板'));
    expect(downloadCSVTemplate).toHaveBeenCalledWith('class');

    fireEvent.click(screen.getByText('下载独立学生模板'));
    expect(downloadCSVTemplate).toHaveBeenCalledWith('student');
  });
});
