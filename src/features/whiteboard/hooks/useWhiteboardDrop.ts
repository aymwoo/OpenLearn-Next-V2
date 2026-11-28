import { useState, useCallback } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from '../../../services/event-bus';
import { paletteItemRegistry } from '../../teacher/lesson-editor/palette-item-registry';
import { getElementCapability } from '../core/element-capabilities';
import type { ExtensionPointConfig } from '../../../plugin-host/types';

export interface UseWhiteboardDropOptions {
  lessonId: string;
  currentPage: number;
  /** 当前页的稳定 id：随元素落库为 pageId，删页/移页后不因全局下标错位而串页（IKW19P ④） */
  currentPageId?: string | null;
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
  currentPageId,
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
      const base = { x, y, page: currentPage, pageId: currentPageId, segmentId: activeSegmentId };
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
      // 内置类型的创建默认值统一登记在能力表；这里只负责把「定位字段 + 默认值」
      // 拼起来，不再维护第二份按类型分派的 switch。
      const createDefaults = getElementCapability(type).createDefaults;
      if (createDefaults) {
        return { ...base, ...createDefaults(content) };
      }
      return { ...base, ...pluginDefaults, ...rendererDefaults, ...content };
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
