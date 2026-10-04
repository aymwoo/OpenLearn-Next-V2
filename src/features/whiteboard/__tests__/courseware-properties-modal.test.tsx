import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  CoursewarePropertiesModal,
  type CoursewarePropertiesModalProps,
} from '../components/CoursewarePropertiesModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CoursewarePropertiesModal Component Tests', () => {
  const mockCoursewares = [
    { id: 'cw-1', uuid: 'uuid-pendulum', name: '单摆模拟实验' },
    { id: 'cw-2', uuid: 'uuid-circuit', name: '电路探究沙盒' },
  ];

  const defaultElement = {
    id: 'el-courseware-1',
    type: 'html-applet',
    data: JSON.stringify({
      title: '力学探究实验课件',
      width: 800,
      height: 600,
      coursewareUuid: 'uuid-pendulum',
    }),
  };

  const defaultProps: CoursewarePropertiesModalProps = {
    isOpen: true,
    onClose: vi.fn(),
    element: defaultElement,
    coursewares: mockCoursewares,
    fetchCoursewares: vi.fn().mockResolvedValue([]),
    onApplyTemporary: vi.fn(),
    onSavePermanent: vi.fn(),
  };

  it('当 isOpen=false 或 element 为 null 时不渲染 Modal', () => {
    const { container: c1 } = render(<CoursewarePropertiesModal {...defaultProps} isOpen={false} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<CoursewarePropertiesModal {...defaultProps} element={null} />);
    expect(c2.firstChild).toBeNull();
  });

  it('打开时正确展示初始属性、课件标题及临时保护提示', () => {
    render(<CoursewarePropertiesModal {...defaultProps} />);

    expect(screen.getByText('课堂课件属性临时调整')).toBeDefined();
    expect(screen.getByDisplayValue('力学探究实验课件')).toBeDefined();
    expect(screen.getByDisplayValue('800')).toBeDefined();
    expect(screen.getByDisplayValue('600')).toBeDefined();

    // 默认开启仅本次课堂临时生效保护机制
    const tempCheckbox = screen.getByLabelText(/仅在本次课堂临时生效/) as HTMLInputElement;
    expect(tempCheckbox.checked).toBe(true);
    expect(screen.getByText('临时应用至本课')).toBeDefined();
    expect(screen.getByText(/不会修改原教案数据库/)).toBeDefined();
  });

  it('点击快速预设尺寸按钮可以同步更新宽度和高度', () => {
    render(<CoursewarePropertiesModal {...defaultProps} />);

    // 点击 960×540 (16:9)
    const btn960 = screen.getByText('960×540 (16:9)');
    fireEvent.click(btn960);

    expect(screen.getByDisplayValue('960')).toBeDefined();
    expect(screen.getByDisplayValue('540')).toBeDefined();

    // 点击 1200×675 (大屏)
    const btn1200 = screen.getByText('1200×675 (大屏)');
    fireEvent.click(btn1200);

    expect(screen.getByDisplayValue('1200')).toBeDefined();
    expect(screen.getByDisplayValue('675')).toBeDefined();
  });

  it('在默认临时保护模式下点击应用：仅触发 onApplyTemporary，严禁触发 onSavePermanent', () => {
    render(<CoursewarePropertiesModal {...defaultProps} />);

    const titleInput = screen.getByDisplayValue('力学探究实验课件');
    fireEvent.change(titleInput, { target: { value: '今日课堂临时观察' } });

    const applyBtn = screen.getByText('临时应用至本课');
    fireEvent.click(applyBtn);

    expect(defaultProps.onApplyTemporary).toHaveBeenCalledTimes(1);
    expect(defaultProps.onApplyTemporary).toHaveBeenCalledWith(
      'el-courseware-1',
      expect.objectContaining({
        title: '今日课堂临时观察',
        width: 800,
        height: 600,
        coursewareUuid: 'uuid-pendulum',
      }),
    );
    // 关键断言：绝对不能向后端发起持久化保存！
    expect(defaultProps.onSavePermanent).not.toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('取消勾选临时保护模式后点击应用：触发 onSavePermanent，覆盖原课程设置', async () => {
    render(<CoursewarePropertiesModal {...defaultProps} />);

    // 取消临时保护开关
    const tempCheckbox = screen.getByLabelText(/仅在本次课堂临时生效/) as HTMLInputElement;
    fireEvent.click(tempCheckbox);
    expect(tempCheckbox.checked).toBe(false);

    // 按钮文案与安全警告变更
    expect(screen.getByText('保存并更新课程')).toBeDefined();
    expect(screen.getByText(/警告：已取消临时保护/)).toBeDefined();

    const saveBtn = screen.getByText('保存并更新课程');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(defaultProps.onSavePermanent).toHaveBeenCalledTimes(1);
      expect(defaultProps.onSavePermanent).toHaveBeenCalledWith(
        'el-courseware-1',
        expect.objectContaining({
          title: '力学探究实验课件',
          width: 800,
          height: 600,
          coursewareUuid: 'uuid-pendulum',
        }),
      );
    });

    expect(defaultProps.onApplyTemporary).not.toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('按 Escape 键或点击取消按钮触发 onClose', () => {
    render(<CoursewarePropertiesModal {...defaultProps} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    // 点击取消按钮
    const cancelBtn = screen.getByText('取消');
    fireEvent.click(cancelBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
  });
});
