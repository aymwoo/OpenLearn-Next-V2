import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  WhiteboardPropertiesSidebar,
  type WhiteboardPropertiesSidebarProps,
} from '../components/WhiteboardPropertiesSidebar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock 子面板避免外部依赖
vi.mock('../components/AssignmentBindingField', () => ({
  AssignmentBindingField: () => <div data-testid="mock-assignment-binding" />,
}));
vi.mock('../components/AssignmentPeerProgressPanel', () => ({
  AssignmentPeerProgressPanel: () => <div data-testid="mock-peer-progress" />,
}));

describe('WhiteboardPropertiesSidebar Component Tests', () => {
  const defaultProps: WhiteboardPropertiesSidebarProps = {
    isEditMode: true,
    selectedShapeId: 'el-rect-1',
    setSelectedShapeId: vi.fn(),
    activePropertiesElementId: null,
    setActivePropertiesElementId: vi.fn(),
    safeElements: [
      {
        id: 'el-rect-1',
        type: 'rect',
        data: JSON.stringify({ strokeColor: '#000000', fillColor: '#ffffff' }),
      },
      {
        id: 'el-text-1',
        type: 'text',
        data: JSON.stringify({ text: 'Hello OpenLearn', fontSize: 16 }),
      },
      {
        id: 'el-highlighter-1',
        type: 'highlighter',
        data: JSON.stringify({ color: '#facc15' }),
      },
    ],
    editingProperties: {
      x: 100,
      y: 150,
      width: 200,
      height: 120,
      stroke: '#000000',
      fill: '#ffffff',
      color: '#000000',
    },
    handleLocalPropChange: vi.fn(),
    handlePropBlur: vi.fn(),
    handleNumericPropBlur: vi.fn(),
    handlePropsUpdate: vi.fn(),
    handleUpdateElementData: vi.fn(),
    handleElementDelete: vi.fn(),
    handleUndoProp: vi.fn(),
    handleRedoProp: vi.fn(),
    propertyUndoStack: {},
    propertyRedoStack: {},
    isSyncing: false,
    lessonId: 'lesson-prop-1',
    classId: 'class-prop-1',
    fullscreenBroadcastClassId: null,
    coursewares: [],
    fetchCoursewares: vi.fn().mockResolvedValue([]),
    setZipCandidates: vi.fn(),
    setZipUploadInfo: vi.fn(),
    setShowEntrySelector: vi.fn(),
    handleAddOption: vi.fn(),
    handleRemoveOption: vi.fn(),
    handleOptionChangeLocal: vi.fn(),
    handleOptionBlur: vi.fn(),
  };

  it('1. 非编辑模式下不渲染侧边栏', () => {
    const { container } = render(<WhiteboardPropertiesSidebar {...defaultProps} isEditMode={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. 未选中任何元素时（selectedShapeId 为 null）不渲染侧边栏', () => {
    const { container } = render(<WhiteboardPropertiesSidebar {...defaultProps} selectedShapeId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('3. 选中矩形图形时正确展示标题、类型与坐标定位输入框', () => {
    render(<WhiteboardPropertiesSidebar {...defaultProps} />);

    expect(screen.getByText('属性编辑器')).toBeDefined();
    expect(screen.getByText('rect')).toBeDefined();
    expect(screen.getByText('el-rect-1')).toBeDefined();

    // 检查 X, Y, Width, Height 字段
    const xInput = screen.getByDisplayValue('100');
    expect(xInput).toBeDefined();

    fireEvent.change(xInput, { target: { value: '180' } });
    expect(defaultProps.handleLocalPropChange).toHaveBeenCalledWith('x', 180);

    fireEvent.blur(xInput);
    expect(defaultProps.handleNumericPropBlur).toHaveBeenCalledWith('x', '100');
  });

  it('4. 属性撤销与重做按钮在栈为空时处于 disabled 状态，非空时可点击', () => {
    const undoMock = vi.fn();
    const redoMock = vi.fn();

    // 4.1 栈为空
    const { unmount } = render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        handleUndoProp={undoMock}
        handleRedoProp={redoMock}
        propertyUndoStack={{}}
        propertyRedoStack={{}}
      />,
    );

    const undoBtn = screen.getByTitle('撤销属性修改');
    const redoBtn = screen.getByTitle('重做属性修改');
    expect(undoBtn.hasAttribute('disabled')).toBe(true);
    expect(redoBtn.hasAttribute('disabled')).toBe(true);
    unmount();

    // 4.2 栈有内容
    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        handleUndoProp={undoMock}
        handleRedoProp={redoMock}
        propertyUndoStack={{ 'el-rect-1': [{ x: 50 }] }}
        propertyRedoStack={{ 'el-rect-1': [{ x: 120 }] }}
      />,
    );

    const activeUndoBtn = screen.getByTitle('撤销属性修改');
    const activeRedoBtn = screen.getByTitle('重做属性修改');
    expect(activeUndoBtn.hasAttribute('disabled')).toBe(false);
    expect(activeRedoBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(activeUndoBtn);
    expect(undoMock).toHaveBeenCalledTimes(1);

    fireEvent.click(activeRedoBtn);
    expect(redoMock).toHaveBeenCalledTimes(1);
  });

  it('5. 点击关闭按钮，清空选中元素与活跃属性状态', () => {
    const setSelectedShapeId = vi.fn();
    const setActivePropertiesElementId = vi.fn();

    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        setSelectedShapeId={setSelectedShapeId}
        setActivePropertiesElementId={setActivePropertiesElementId}
      />,
    );

    const closeBtn = screen.getByTitle('关闭属性编辑器');
    fireEvent.click(closeBtn);

    expect(setSelectedShapeId).toHaveBeenCalledWith(null);
    expect(setActivePropertiesElementId).toHaveBeenCalledWith(null);
  });

  it('6. 选定荧光笔（highlighter）时呈现荧光笔颜色配置', () => {
    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        selectedShapeId="el-highlighter-1"
        editingProperties={{ color: '#facc15' }}
      />,
    );

    expect(screen.getByText('高亮荧光标记 (Highlighter)')).toBeDefined();
    expect(screen.getByText('荧光笔颜色')).toBeDefined();
    expect(screen.getByText('#facc15')).toBeDefined();
  });

  it('7. 点击“应用修改并强制同步”按钮触发 handleUpdateElementData', () => {
    const handleUpdate = vi.fn();
    render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

    const applyBtn = screen.getByText('应用修改并强制同步');
    fireEvent.click(applyBtn);
    expect(handleUpdate).toHaveBeenCalledWith(defaultProps.editingProperties);
  });

  it('8. 点击“删除当前组件”按钮触发 handleElementDelete 并清除选中态', () => {
    const handleDelete = vi.fn();
    const setSelectedShapeId = vi.fn();

    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        handleElementDelete={handleDelete}
        setSelectedShapeId={setSelectedShapeId}
      />,
    );

    const deleteBtn = screen.getByText('删除当前组件');
    fireEvent.click(deleteBtn);

    expect(handleDelete).toHaveBeenCalledWith('el-rect-1');
    expect(setSelectedShapeId).toHaveBeenCalledWith(null);
  });
});
