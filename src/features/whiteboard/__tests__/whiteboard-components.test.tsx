import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhiteboardToolbar } from '../components/WhiteboardToolbar';
import { WhiteboardDialog } from '../components/WhiteboardDialog';
import { RollCallWrapper } from '../widgets/RollCallWrapper';
import { wrapSrcDocWithBridge } from '../utils/bridgeUtils';

// Mock ExtensionPointRenderer to avoid needing full PluginHostContext in unit test
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />
}));

describe('Whiteboard Extracted Components & Utilities', () => {
  describe('wrapSrcDocWithBridge', () => {
    it('should inject LMS context and bridge.js into HTML snippet', () => {
      const result = wrapSrcDocWithBridge('<h1>Hello World</h1>', 'lesson-123');
      expect(result).toContain('window.__LMS_STUDENT__ =');
      expect(result).toContain('lesson-123');
      expect(result).toContain('<script src="/bridge.js"></script>');
      expect(result).toContain('<h1>Hello World</h1>');
    });

    it('should inject inline postMessage resilience script to normalize targetOrigin "null"', () => {
      const result = wrapSrcDocWithBridge('<div>Applet</div>', 'lesson-456');
      expect(result).toContain('origPM = window.postMessage');
      expect(result).toContain("targetOrigin === 'null'");
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
        />
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
            onConfirm
          }}
          dialogInput=""
          setDialogInput={vi.fn()}
          setDialog={setDialog}
        />
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
              { id: 's2', name: '李四', email: 'lisi@edu.org' }
            ]
          }}
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onDelete={onDelete}
        />
      );

      expect(screen.getByText(/随机点名助手/)).toBeDefined();
      const pickBtn = screen.getByText('开始随机点名');
      expect(pickBtn).toBeDefined();
    });
  });
});
