import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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

  it('3. 选中矩形图形时正确展示标题、类型与尺寸输入框（位置仅靠拖动，不提供 X/Y）', () => {
    render(<WhiteboardPropertiesSidebar {...defaultProps} />);

    expect(screen.getByText('属性编辑器')).toBeDefined();
    expect(screen.getByText('rect')).toBeDefined();
    expect(screen.getByText('el-rect-1')).toBeDefined();

    // Issue #97：位置只在画布上拖动调整，属性栏不再提供 X/Y 坐标输入
    expect(screen.queryByText('X 坐标')).toBeNull();
    expect(screen.queryByText('Y 坐标')).toBeNull();
    expect(screen.queryByDisplayValue('100'), 'x=100 不应再渲染成输入框').toBeNull();
    expect(screen.queryByDisplayValue('150'), 'y=150 不应再渲染成输入框').toBeNull();
    expect(screen.queryByText('物理定位 & 尺寸')).toBeNull();
    expect(screen.getByText('尺寸')).toBeDefined();

    // 宽高仍然可编辑
    const widthInput = screen.getByDisplayValue('200');
    fireEvent.change(widthInput, { target: { value: '260' } });
    expect(defaultProps.handleLocalPropChange).toHaveBeenCalledWith('width', 260);

    fireEvent.blur(widthInput);
    expect(defaultProps.handleNumericPropBlur).toHaveBeenCalledWith('width', '200');

    const heightInput = screen.getByDisplayValue('120');
    fireEvent.change(heightInput, { target: { value: '90' } });
    expect(defaultProps.handleLocalPropChange).toHaveBeenCalledWith('height', 90);
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

  it('7. 点击“保存”按钮触发 handleUpdateElementData', () => {
    const handleUpdate = vi.fn();
    render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

    const applyBtn = screen.getByText('保存');
    fireEvent.click(applyBtn);
    expect(handleUpdate).toHaveBeenCalledWith(defaultProps.editingProperties);
  });

  describe('保存结果就地反馈（按钮下方）', () => {
    it('7a. 返回 saved → 按钮下方出现「已保存」', async () => {
      const handleUpdate = vi.fn().mockResolvedValue('saved');
      render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

      expect(screen.queryByTestId('save-feedback-success')).toBeNull();
      fireEvent.click(screen.getByText('保存'));

      expect(await screen.findByTestId('save-feedback-success')).toBeDefined();
      expect(screen.getByText('已保存')).toBeDefined();
    });

    it('7b. 返回 failed → 提示保存失败（而不是只 console.error）', async () => {
      const handleUpdate = vi.fn().mockResolvedValue('failed');
      render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

      fireEvent.click(screen.getByText('保存'));

      expect(await screen.findByTestId('save-feedback-error')).toBeDefined();
      expect(screen.getByText('保存失败，请重试')).toBeDefined();
    });

    it('7c. 返回 noop（未落库）→ 不提示，绝不谎报成功', async () => {
      const handleUpdate = vi.fn().mockResolvedValue('noop');
      render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

      fireEvent.click(screen.getByText('保存'));
      await new Promise((r) => setTimeout(r, 30));

      expect(screen.queryByTestId('save-feedback-success')).toBeNull();
      expect(screen.queryByTestId('save-feedback-error')).toBeNull();
    });

    it('7d. 旧调用方返回 undefined（未接新约定）→ 同样不提示', async () => {
      const handleUpdate = vi.fn().mockResolvedValue(undefined);
      render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

      fireEvent.click(screen.getByText('保存'));
      await new Promise((r) => setTimeout(r, 30));

      expect(screen.queryByTestId('save-feedback-success')).toBeNull();
    });

    it('7e. “已保存”会在超时后自动消失', async () => {
      vi.useFakeTimers();
      try {
        const handleUpdate = vi.fn().mockResolvedValue('saved');
        render(<WhiteboardPropertiesSidebar {...defaultProps} handleUpdateElementData={handleUpdate} />);

        fireEvent.click(screen.getByText('保存'));
        // 先让 await handleUpdateElementData 的 promise 链结完，提示才会被设置
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByTestId('save-feedback-success')).toBeDefined();

        // 再推进计时器，让自动消失生效
        await act(async () => {
          vi.advanceTimersByTime(3_000);
        });
        expect(screen.queryByTestId('save-feedback-success')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('9. Issue #107：选择正确答案时一次写入 correctIndex（权威）与 correctAnswer（兼容）', () => {
    const handlePropsUpdate = vi.fn();
    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        selectedShapeId="el-quiz-1"
        activePropertiesElementId="el-quiz-1"
        safeElements={[
          { id: 'el-quiz-1', type: 'quiz', data: JSON.stringify({ question: 'Q', options: ['甲', '乙', '丙'] }) },
        ]}
        editingProperties={{
          question: 'Q',
          options: ['甲', '乙', '丙'],
          // 新建测验的默认数据只有索引
          correctIndex: 0,
        }}
        handlePropsUpdate={handlePropsUpdate}
      />,
    );

    // 默认答案 A 被回显（旧实现读 correctAnswer，默认数据下显示「未设置」）
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('0');

    fireEvent.change(select, { target: { value: '2' } });
    expect(handlePropsUpdate).toHaveBeenCalledWith({ correctIndex: 2, correctAnswer: '丙' });
  });

  it('10. Issue #107：旧数据只有 correctAnswer 文本时下拉仍回显正确选项', () => {
    render(
      <WhiteboardPropertiesSidebar
        {...defaultProps}
        selectedShapeId="el-quiz-2"
        activePropertiesElementId="el-quiz-2"
        safeElements={[
          {
            id: 'el-quiz-2',
            type: 'quiz',
            data: JSON.stringify({ question: 'Q', options: ['甲', '乙', '丙'], correctAnswer: '乙' }),
          },
        ]}
        editingProperties={{ question: 'Q', options: ['甲', '乙', '丙'], correctAnswer: '乙' }}
      />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect(screen.queryByText('未设置正确答案将无法自动判分')).toBeNull();
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
