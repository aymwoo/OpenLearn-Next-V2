import { useState, useCallback } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from '../../../services/event-bus';
import { paletteItemRegistry } from '../../teacher/lesson-editor/palette-item-registry';
import type { ExtensionPointConfig } from '../../../plugin-host/types';

export interface UseWhiteboardDropOptions {
  lessonId: string;
  currentPage: number;
  activeSegmentId?: string | null;
  whiteboardRenderers: ExtensionPointConfig[] | undefined;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setIsSyncing: (syncing: boolean) => void;
  onElementAdd: (type: string, data: Record<string, unknown>) => Promise<void>;
  onRefresh?: () => void;
}

export function useWhiteboardDrop({
  lessonId,
  currentPage,
  activeSegmentId,
  whiteboardRenderers,
  containerRef,
  setIsSyncing,
  onElementAdd,
  onRefresh,
}: UseWhiteboardDropOptions) {
  const [isDragOverBoard, setIsDragOverBoard] = useState(false);

  const handleWhiteboardDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverBoard(true);
  }, []);

  const handleWhiteboardDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverBoard(true);
  }, []);

  const handleWhiteboardDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverBoard(false);
    }
  }, []);

  // 组装元素 data：合并内容字段与定位字段，并补齐各类型的默认值
  const buildElementData = useCallback(
    (type: string, content: Record<string, unknown>, x: number, y: number): Record<string, unknown> => {
      const base = { x, y, page: currentPage, segmentId: activeSegmentId };
      const pluginConfig = paletteItemRegistry.get(type);
      const pluginDefaults = pluginConfig?.defaultData || {};
      const extRenderer = whiteboardRenderers?.find((ext) => {
        const anyExt = ext as unknown as {
          targetType?: string;
          route?: string;
          slotProps?: { elementType?: string; targetType?: string; defaultData?: Record<string, unknown> };
        };
        return (
          anyExt.targetType === type ||
          ext.id === type ||
          anyExt.route === type ||
          `${ext.pluginId}/${ext.id}` === type ||
          anyExt.slotProps?.elementType === type ||
          anyExt.slotProps?.targetType === type
        );
      });
      const slotProps = (extRenderer as unknown as { slotProps?: { defaultData?: Record<string, unknown> } })
        ?.slotProps;
      const rendererDefaults = slotProps?.defaultData || {};
      switch (type) {
        case 'code-sandbox':
          return { ...base, code: content.code ?? "console.log('Hello Sandbox!');" };
        case 'math-graph':
          return { ...base, equation: content.equation ?? 'Math.sin(x)' };
        case 'presentation':
          return {
            ...base,
            markdown: content.markdown ?? '# Title Slide\n---\n## Slide 2',
            width: 600,
            height: 400,
            slideX: 0,
            slideY: 0,
          };
        case 'quiz':
          return {
            ...base,
            question: content.question ?? 'New Quiz',
            options: Array.isArray(content.options) ? content.options : ['A', 'B', 'C', 'D'],
          };
        case 'html-applet':
          return {
            ...base,
            title: content.title ?? '',
            code: content.code ?? '',
            coursewareUuid: content.coursewareUuid ?? undefined,
            resourceId: content.resourceId ?? undefined,
          };
        case 'assignment':
          return { ...base, title: content.title ?? 'New Assignment', description: content.description ?? '' };
        case 'hello-world':
          return base;
        case 'rollcall':
          return { ...base, allStudents: [] };
        default:
          return { ...base, ...pluginDefaults, ...rendererDefaults, ...content };
      }
    },
    [currentPage, activeSegmentId, whiteboardRenderers],
  );

  // 命令式接口：在画板中央插入元素（供备课画板点击添加）
  const addElementAtCenter = useCallback(
    async (type: string, contentData: Record<string, unknown>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.round(rect.width / 2 + containerRef.current.scrollLeft);
      const y = Math.round(rect.height / 2 + containerRef.current.scrollTop);
      setIsSyncing(true);
      try {
        await onElementAdd(type, buildElementData(type, contentData, x, y));
        frontendEventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_updated',
          source: 'whiteboard',
          payload: { lessonId },
          timestamp: Date.now(),
          correlationId: lessonId,
        });
        if (onRefresh) onRefresh();
      } catch (err) {
        console.error('addElementAtCenter error', err);
      } finally {
        setIsSyncing(false);
      }
    },
    [containerRef, setIsSyncing, onElementAdd, buildElementData, lessonId, onRefresh],
  );

  const handleWhiteboardDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        let payloadStr = e.dataTransfer.getData('application/json');
        if (!payloadStr) payloadStr = e.dataTransfer.getData('text/plain');
        if (!payloadStr) payloadStr = e.dataTransfer.getData('text');
        if (!payloadStr) payloadStr = e.dataTransfer.getData('Text');

        if (!payloadStr) return;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(payloadStr);
        } catch (err) {
          console.error('Failed to parse drop JSON payload:', err);
          return;
        }

        if (typeof payload !== 'object' || !payload) return;

        if (!containerRef.current) {
          console.warn('containerRef.current is not loaded on drop');
          return;
        }
        const stageBox = containerRef.current.getBoundingClientRect();
        const dropX = e.clientX - stageBox.left + containerRef.current.scrollLeft;
        const dropY = e.clientY - stageBox.top + containerRef.current.scrollTop;

        setIsSyncing(true);
        try {
          const typeStr = typeof payload.type === 'string' ? payload.type : '';
          await onElementAdd(typeStr, buildElementData(typeStr, payload, dropX, dropY));
          frontendEventBus.publish({
            id: uuidv7(),
            type: 'whiteboard.element_updated',
            source: 'whiteboard',
            payload: { lessonId },
            timestamp: Date.now(),
            correlationId: lessonId,
          });
          if (onRefresh) onRefresh();
        } finally {
          setIsSyncing(false);
        }
      } catch (err) {
        console.error('Drop error', err);
      }
    },
    [containerRef, setIsSyncing, onElementAdd, buildElementData, lessonId, onRefresh],
  );

  return {
    isDragOverBoard,
    setIsDragOverBoard,
    handleWhiteboardDragOver,
    handleWhiteboardDragEnter,
    handleWhiteboardDragLeave,
    buildElementData,
    addElementAtCenter,
    handleWhiteboardDrop,
  };
}
