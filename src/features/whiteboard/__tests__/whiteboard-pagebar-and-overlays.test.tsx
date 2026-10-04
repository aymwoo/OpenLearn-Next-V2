import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WhiteboardPageBar, type WhiteboardPageBarProps } from '../components/WhiteboardPageBar';
import { WhiteboardEmptyState } from '../components/WhiteboardEmptyState';
import { WhiteboardTilingOverlay } from '../components/WhiteboardTilingOverlay';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Whiteboard PageBar & Overlays Component Tests', () => {
  describe('WhiteboardPageBar', () => {
    const defaultPageBarProps: WhiteboardPageBarProps = {
      pages: [
        { id: 'page-0', title: '第 1 页：导入与提问', order: 0 },
        { id: 'page-1', title: '第 2 页：物理实验探究', order: 1 },
        { id: 'page-2', title: '第 3 页：随堂巩固练习', order: 2 },
      ],
      currentPage: 0,
      showPageDrawer: false,
      setShowPageDrawer: vi.fn(),
      editingPageIdx: null,
      setEditingPageIdx: vi.fn(),
      editingPageTitle: '',
      setEditingPageTitle: vi.fn(),
      activeMenuPageIdx: null,
      setActiveMenuPageIdx: vi.fn(),
      safeElements: [],
      handleSwitchPage: vi.fn(),
      handleRenamePage: vi.fn(),
      handleDuplicatePage: vi.fn(),
      handleMovePage: vi.fn(),
      handleDeletePage: vi.fn(),
      handleAddPage: vi.fn(),
    };

    it('1. 渲染多页导航栏与大纲徽标，当前为第 0 页时上一页按钮处于禁用状态', () => {
      render(<WhiteboardPageBar {...defaultPageBarProps} />);

      expect(screen.getByText('大纲 (3)')).toBeDefined();
      expect(screen.getByText('第 1 页：导入与提问')).toBeDefined();
      expect(screen.getByText('第 2 页：物理实验探究')).toBeDefined();

      const prevBtn = screen.getByTitle('上一页');
      expect(prevBtn.hasAttribute('disabled')).toBe(true);

      const nextBtn = screen.getByTitle('下一页');
      expect(nextBtn.hasAttribute('disabled')).toBe(false);
      fireEvent.click(nextBtn);
      expect(defaultPageBarProps.handleSwitchPage).toHaveBeenCalledWith(1);
    });

    it('2. 点击大纲按钮触发 setShowPageDrawer 切换显隐', () => {
      const setShowDrawer = vi.fn();
      render(<WhiteboardPageBar {...defaultPageBarProps} setShowPageDrawer={setShowDrawer} />);

      const outlineBtn = screen.getByTitle('页面大纲与预览 (Pages Outline)');
      fireEvent.click(outlineBtn);
      expect(setShowDrawer).toHaveBeenCalledWith(true);
    });

    it('3. 点击新增页面按钮触发 handleAddPage', () => {
      const handleAdd = vi.fn();
      render(<WhiteboardPageBar {...defaultPageBarProps} handleAddPage={handleAdd} />);

      const addBtn = screen.getByTitle('新建白板页面');
      fireEvent.click(addBtn);
      expect(handleAdd).toHaveBeenCalledTimes(1);
    });

    it('4. 处于编辑标题模式时（editingPageIdx === 1），支持键盘快捷键 Enter 确认与 Escape 取消', () => {
      const handleRename = vi.fn();
      const setEditingIdx = vi.fn();
      const setTitle = vi.fn();

      render(
        <WhiteboardPageBar
          {...defaultPageBarProps}
          editingPageIdx={1}
          editingPageTitle="新修改的页面标题"
          setEditingPageTitle={setTitle}
          handleRenamePage={handleRename}
          setEditingPageIdx={setEditingIdx}
        />,
      );

      const input = screen.getByDisplayValue('新修改的页面标题');
      expect(input).toBeDefined();

      // Enter 键触发重命名提交
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(handleRename).toHaveBeenCalledWith(1, '新修改的页面标题');

      // Escape 键退出编辑
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(setEditingIdx).toHaveBeenCalledWith(null);
    });
  });

  describe('WhiteboardEmptyState', () => {
    it('1. isVisible=false 时返回 null，不渲染任何 DOM', () => {
      const { container } = render(<WhiteboardEmptyState isVisible={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('2. isVisible=true 时渲染空状态引导文案与图标', () => {
      render(<WhiteboardEmptyState isVisible={true} />);
      expect(screen.getByText('交互式备课白板')).toBeDefined();
      expect(screen.getByText(/从左侧组件库拖拽组件至此处/)).toBeDefined();
    });
  });

  describe('WhiteboardTilingOverlay', () => {
    const mockSplitter: any = {
      id: 'sp-1',
      orientation: 'horizontal',
      x: 0,
      y: 200,
      length: 800,
      thickness: 8,
    };

    it('1. autoTileEnabled=false 或 readOnly=true 时不渲染平铺覆盖层', () => {
      const { container, rerender } = render(
        <WhiteboardTilingOverlay
          autoTileEnabled={false}
          readOnly={false}
          tilingSplitters={[mockSplitter]}
          activeSplitterDrag={null}
          activeDropZoneAction={null}
          handleSplitterPointerDown={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();

      rerender(
        <WhiteboardTilingOverlay
          autoTileEnabled={true}
          readOnly={true}
          tilingSplitters={[mockSplitter]}
          activeSplitterDrag={null}
          activeDropZoneAction={null}
          handleSplitterPointerDown={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('2. autoTileEnabled=true 时渲染分割条并在 PointerDown 时调用 handleSplitterPointerDown', () => {
      const onPointerDown = vi.fn();
      render(
        <WhiteboardTilingOverlay
          autoTileEnabled={true}
          readOnly={false}
          tilingSplitters={[mockSplitter]}
          activeSplitterDrag={null}
          activeDropZoneAction={null}
          handleSplitterPointerDown={onPointerDown}
        />,
      );

      const splitterEl = screen.getByTestId('splitter-horizontal-sp-1');
      expect(splitterEl).toBeDefined();
      expect(splitterEl.getAttribute('title')).toBe('拖动调整上下分割高度');

      fireEvent.pointerDown(splitterEl);
      expect(onPointerDown).toHaveBeenCalledTimes(1);
    });
  });
});
