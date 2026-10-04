import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WhiteboardToolbar, type WhiteboardToolbarProps } from '../components/WhiteboardToolbar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock ExtensionPointRenderer
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => null,
}));

describe('Whiteboard Canvas & Toolbar Interactive Journey Tests', () => {
  const defaultToolbarProps: WhiteboardToolbarProps = {
    tool: 'cursor',
    setTool: vi.fn(),
    setSelectedShapeId: vi.fn(),
    highlighterColor: '#facc15',
    setHighlighterColor: vi.fn(),
    onElementAdd: vi.fn(),
    currentPage: 0,
    lessonId: 'lesson-canvas-1',
    safeElements: [],
    selectedShapeId: null,
    showGrid: false,
    setShowGrid: vi.fn(),
    isSyncing: false,
    setIsSyncing: vi.fn(),
    handleClearBoard: vi.fn(),
    handleResetBoard: vi.fn(),
    handleElementDelete: vi.fn(),
    setDialog: vi.fn(),
    setDialogInput: vi.fn(),
    userRole: 'teacher',
  };

  it('1. 几何图形工具切换：点击矩形、圆形、文本工具依次触发 setTool', () => {
    const setTool = vi.fn();
    render(<WhiteboardToolbar {...defaultToolbarProps} setTool={setTool} />);

    const rectBtn = screen.getByTitle('矩形工具 (Rectangle)');
    fireEvent.click(rectBtn);
    expect(setTool).toHaveBeenCalledWith('rect');

    const circleBtn = screen.getByTitle('圆形工具 (Circle)');
    fireEvent.click(circleBtn);
    expect(setTool).toHaveBeenCalledWith('circle');

    const textBtn = screen.getByTitle('文本工具 (Text)');
    fireEvent.click(textBtn);
    expect(setTool).toHaveBeenCalledWith('text');
  });

  it('2. 网格线背景切换：点击网格按钮触发 setShowGrid 回调', () => {
    const setShowGrid = vi.fn();
    render(<WhiteboardToolbar {...defaultToolbarProps} showGrid={false} setShowGrid={setShowGrid} />);

    const gridBtn = screen.getByTitle('开启网格背景');
    fireEvent.click(gridBtn);
    expect(setShowGrid).toHaveBeenCalledTimes(1);
  });

  it('3. 权限差异化测试：教师角色展示“清空白板”，学生角色展示“重置白板”', () => {
    const handleClear = vi.fn();
    const handleReset = vi.fn();

    // 3.1 教师身份
    const { unmount } = render(
      <WhiteboardToolbar
        {...defaultToolbarProps}
        userRole="teacher"
        handleClearBoard={handleClear}
        handleResetBoard={handleReset}
      />,
    );

    const clearBtn = screen.getByTitle('清空白板 (Clear Board)');
    expect(clearBtn).toBeDefined();
    expect(screen.queryByTitle('重置白板 (Reset Board)')).toBeNull();
    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);
    unmount();

    // 3.2 学生身份
    render(
      <WhiteboardToolbar
        {...defaultToolbarProps}
        userRole="student"
        handleClearBoard={handleClear}
        handleResetBoard={handleReset}
      />,
    );

    const resetBtn = screen.getByTitle('重置白板 (Reset Board)');
    expect(resetBtn).toBeDefined();
    expect(screen.queryByTitle('清空白板 (Clear Board)')).toBeNull();
    fireEvent.click(resetBtn);
    expect(handleReset).toHaveBeenCalledTimes(1);
  });

  it('4. 快捷删除按钮：选中元素时呈现“删除选中图形”，点击触发删除与取消选中', () => {
    const handleDelete = vi.fn();
    const setSelectedShapeId = vi.fn();

    const { rerender } = render(
      <WhiteboardToolbar
        {...defaultToolbarProps}
        selectedShapeId={null}
        handleElementDelete={handleDelete}
        setSelectedShapeId={setSelectedShapeId}
      />,
    );
    expect(screen.queryByTitle('删除选中图形')).toBeNull();

    // 选中元素 el-1
    rerender(
      <WhiteboardToolbar
        {...defaultToolbarProps}
        selectedShapeId="el-1"
        handleElementDelete={handleDelete}
        setSelectedShapeId={setSelectedShapeId}
      />,
    );

    const deleteBtn = screen.getByTitle('删除选中图形');
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn);
    expect(handleDelete).toHaveBeenCalledWith('el-1');
    expect(setSelectedShapeId).toHaveBeenCalledWith(null);
  });

  it('5. 课件小组件快捷插入：点击代码沙箱与随机点名触发 onElementAdd', async () => {
    const onElementAdd = vi.fn().mockResolvedValue(undefined);
    render(<WhiteboardToolbar {...defaultToolbarProps} onElementAdd={onElementAdd} />);

    // 插入代码沙箱
    const sandboxBtn = screen.getByTitle('插入代码沙箱 (Code Sandbox)');
    fireEvent.click(sandboxBtn);
    expect(onElementAdd).toHaveBeenCalledWith(
      'code-sandbox',
      expect.objectContaining({
        code: "console.log('Hello Sandbox!');",
        page: 0,
      }),
    );

    // 插入随机点名组件
    const rollCallBtn = screen.getByTitle('插入随机点名组件 (Roll Call)');
    fireEvent.click(rollCallBtn);
    expect(onElementAdd).toHaveBeenCalledWith(
      'rollcall',
      expect.objectContaining({
        page: 0,
      }),
    );
  });
});
