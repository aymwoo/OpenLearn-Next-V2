import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WhiteboardToolbar } from '../components/WhiteboardToolbar';
import { WhiteboardDialog } from '../components/WhiteboardDialog';
import { RollCallWrapper } from '../widgets/RollCallWrapper';
import { wrapSrcDocWithBridge } from '../utils/bridgeUtils';
import { HtmlAppletFrame } from '../components/HtmlAppletFrame';

// Mock ExtensionPointRenderer to avoid needing full PluginHostContext in unit test
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />,
}));

describe('Whiteboard Extracted Components & Utilities', () => {
  describe('wrapSrcDocWithBridge', () => {
    it('should inject LMS context and bridge.js into HTML snippet', () => {
      const result = wrapSrcDocWithBridge('<h1>Hello World</h1>', 'lesson-123');
      expect(result).toContain('window.__LMS_STUDENT__ =');
      expect(result).toContain('lesson-123');
      // bridge.js 带 cw 追踪参数（server/routes/bridge.ts 读取 req.query.cw）
      expect(result).toContain('<script src="/bridge.js?cw=lesson-123"></script>');
      expect(result).toContain('<h1>Hello World</h1>');
    });

    it('should inject inline Proxy-based postMessage resilience script to normalize targetOrigin "null"', () => {
      const result = wrapSrcDocWithBridge('<div>Applet</div>', 'lesson-456');
      // Verify self-targeting postMessage override
      expect(result).toContain('origPM = window.postMessage');
      expect(result).toContain("targetOrigin === 'null'");
      // Verify Proxy-based window.parent/window.top shadow pattern
      expect(result).toContain('new Proxy(realRef');
      expect(result).toContain('Object.defineProperty(window, propName');
      expect(result).toContain("proxyWin(window.parent, 'parent')");
      expect(result).toContain("proxyWin(window.top, 'top')");
    });
  });

  describe('WhiteboardToolbar', () => {
    it('should render tool buttons and trigger setTool on click', () => {
      const setTool = vi.fn();
      const setSelectedShapeId = vi.fn();
      render(
        <WhiteboardToolbar
          tool="cursor"
          setTool={setTool}
          setSelectedShapeId={setSelectedShapeId}
          highlighterColor="#facc15"
          setHighlighterColor={vi.fn()}
          onElementAdd={vi.fn()}
          currentPage={0}
          lessonId="lesson-1"
          safeElements={[]}
          selectedShapeId={null}
          showGrid={true}
          setShowGrid={vi.fn()}
          isSyncing={false}
          setIsSyncing={vi.fn()}
          handleClearBoard={vi.fn()}
          handleResetBoard={vi.fn()}
          handleElementDelete={vi.fn()}
          setDialog={vi.fn()}
          setDialogInput={vi.fn()}
        />,
      );

      const penButton = screen.getByTitle('画笔工具 (Pen)');
      expect(penButton).toBeDefined();
      fireEvent.click(penButton);
      expect(setTool).toHaveBeenCalledWith('pen');
    });
  });

  describe('WhiteboardDialog', () => {
    it('should render dialog message and handle confirm action', async () => {
      const onConfirm = vi.fn();
      const setDialog = vi.fn();

      render(
        <WhiteboardDialog
          dialog={{
            type: 'alert',
            title: '测试提示',
            message: '这是一个测试消息',
            onConfirm,
          }}
          dialogInput=""
          setDialogInput={vi.fn()}
          setDialog={setDialog}
        />,
      );

      expect(screen.getByText('测试提示')).toBeDefined();
      expect(screen.getByText('这是一个测试消息')).toBeDefined();

      const confirmBtn = screen.getByText('确定');
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  describe('RollCallWrapper Widget', () => {
    it('should render student roll call picker widget and trigger random pick', () => {
      const onDelete = vi.fn();
      render(
        <RollCallWrapper
          elementId="el-rollcall-1"
          data={{
            allStudents: [
              { id: 's1', name: '张三', email: 'zhangsan@edu.org' },
              { id: 's2', name: '李四', email: 'lisi@edu.org' },
            ],
          }}
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onDelete={onDelete}
        />,
      );

      expect(screen.getByText(/随机点名助手/)).toBeDefined();
      const pickBtn = screen.getByText('开始随机点名');
      expect(pickBtn).toBeDefined();
      // 编辑模式（默认）下提供删除入口
      expect(screen.getByTitle('删除组件')).toBeDefined();
    });

    it('should hide the delete button in readOnly (全班专注锁定) mode', () => {
      const { container } = render(
        <RollCallWrapper
          elementId="el-rollcall-1"
          data={{ allStudents: [{ id: 's1', name: '张三', email: 'zhangsan@edu.org' }] }}
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onDelete={vi.fn()}
          readOnly
        />,
      );

      // 只读跟随模式下组件本体仍可见可交互，但不再暴露删除按钮
      expect(within(container).getByText(/随机点名助手/)).toBeDefined();
      expect(within(container).getByText('开始随机点名')).toBeDefined();
      expect(within(container).queryByTitle('删除组件')).toBeNull();
    });
  });

  describe('HtmlAppletFrame', () => {
    it('should render iframe with credentialless="true" attribute', () => {
      const { container } = render(
        <HtmlAppletFrame
          data={{ title: 'Test Applet', code: '<div>Test</div>' }}
          lessonId="lesson-1"
        />,
      );
      const iframe = container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute('credentialless')).toBe('true');
      expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
      expect(iframe?.getAttribute('referrerpolicy')).toBe('no-referrer');
    });
  });
});
