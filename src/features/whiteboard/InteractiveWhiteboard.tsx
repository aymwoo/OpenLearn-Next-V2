import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Circle, Line, Text as KonvaText, Group } from 'react-konva';
import { MousePointer2, Square, Circle as CircleIcon, PenTool, Type, Eraser, Loader2, Presentation, ChevronLeft, ChevronRight, Wand2, Terminal, Activity, Trash2, Settings, Plus, X, Paintbrush, ChevronDown, Undo2, Redo2, RotateCcw, Play, Pause, Maximize2, Minimize2, Edit3, BookOpen, Eye, FileText, Highlighter, Sparkles, HelpCircle, Shuffle, UserCheck, Upload, Grid, LayoutGrid, Copy } from 'lucide-react';
import { Html } from 'react-konva-utils';
import { init as initPptxPreview } from 'pptx-preview';
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';
import RevealMarkdown from 'reveal.js/plugin/markdown';
import { v7 as uuidv7 } from 'uuid';
import Markdown from 'react-markdown';
import { getSocketInstance } from '../../services/socket-service';
import { frontendEventBus } from '../../services/event-bus';
import { appStore } from '../../store/appStore';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { legacyAdapter, objectRegistry, commandManager, layerManager, selectionManager, canvasEventBus } from './canvas-model/index.js';
import type { CanvasObject, CanvasPage } from './canvas-model/index.js';
import { interactionManager, pointerStateMachine, toolManager, viewportController, transformManager, snapEngine, guideEngine, shortcutEngine, clipboardService, contextMenuManager, cursorManager, textEditingManager } from './interaction-engine/index.js';
import { renderingEngine, rendererRegistry, renderScheduler, virtualRenderer, dirtyRegionManager, layerRenderer, cacheManager, imageManager, textEngine, hitTestEngine, animationManager, performanceMonitor, highDPIController, exportService, themeManager, devToolsPanel } from './rendering-engine/index.js';
import { teachingEngine, teachingObjectRegistry, teachingLifecycleManager, teachingRuntimeManager, teachingEventBus, teacherContextManager, studentContextManager, assessmentInterface, learningAnalyticsEngine, aiInterface, teachingPluginSDK } from './teaching-object/index.js';

import { PluginCardRenderer } from './widgets/PluginCardRenderer';
import { RollCallWrapper } from './widgets/RollCallWrapper';
import { CodeSandboxWrapper } from './widgets/CodeSandboxWrapper';
import { MathGraphWrapper } from './widgets/MathGraphWrapper';
import { HelloWorldWrapper } from './widgets/HelloWorldWrapper';
import { RevealPresentationWrapper } from './widgets/RevealPresentationWrapper';
import { wrapSrcDocWithBridge } from './utils/bridgeUtils';
import { WhiteboardToolbar } from './components/WhiteboardToolbar';
import { WhiteboardPageBar } from './components/WhiteboardPageBar';
import { WhiteboardDialog } from './components/WhiteboardDialog';
import { CoursewareEntrySelectorModal } from './components/CoursewareEntrySelectorModal';

interface WhiteboardElement {
  id: string;
  type: string;
  data: string;
}

export interface InteractiveWhiteboardProps {
  lessonId: string;
  elements: WhiteboardElement[];
  onElementAdd: (type: string, data: any) => Promise<void>;
  onElementUpdate?: (elementId: string, data: any) => Promise<void>;
  onElementDelete?: (elementId: string) => Promise<void>;
  onClearBoard?: () => Promise<void>;
  onRefresh?: () => void;
  enableAutoAI?: boolean;
  activeSegmentId?: string | null;
  onSegmentSync?: (segmentId: string) => void;
  userRole?: 'teacher' | 'student';
  isEditMode?: boolean;
}

export interface WhiteboardPageItem {
  id: string;
  title: string;
  order: number;
  segmentId?: string | null;
}

export const DEFAULT_WHITEBOARD_PAGES: WhiteboardPageItem[] = [
  { id: 'page-0', title: 'P1 · 引入导入', order: 0 },
  { id: 'page-1', title: 'P2 · 核心讲解', order: 1 },
  { id: 'page-2', title: 'P3 · 互动练习', order: 2 },
];

// 命令式接口：供外部（如备课画板点击添加）在画板中央插入元素
export interface WhiteboardHandle {
  addElementAtCenter: (type: string, contentData: Record<string, any>) => Promise<void>;
}

export const InteractiveWhiteboard = forwardRef<WhiteboardHandle, InteractiveWhiteboardProps>(
  (
    {
      lessonId,
      elements,
      onElementAdd,
      onElementUpdate,
      onElementDelete,
      onClearBoard,
      onRefresh,
      enableAutoAI,
      activeSegmentId,
      onSegmentSync,
      userRole = 'teacher',
      isEditMode = true,
    }: InteractiveWhiteboardProps,
    ref,
  ) => {
  // 防御：确保 elements 始终是数组（极端情况下 Zustand store 可能返回非数组值）
  const safeElements = Array.isArray(elements) ? elements : [];
  const [tool, setTool] = useState<'cursor' | 'rect' | 'circle' | 'pen' | 'text' | 'presentation' | 'highlighter'>('cursor');
  const [highlighterColor, setHighlighterColor] = useState('#facc15');
  const [currentPage, setCurrentPage] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [isDragOverBoard, setIsDragOverBoard] = useState(false);
  const [pages, setPages] = useState<WhiteboardPageItem[]>(DEFAULT_WHITEBOARD_PAGES);
  const [showPageDrawer, setShowPageDrawer] = useState(false);
  const [editingPageIdx, setEditingPageIdx] = useState<number | null>(null);
  const [editingPageTitle, setEditingPageTitle] = useState('');
  const [activeMenuPageIdx, setActiveMenuPageIdx] = useState<number | null>(null);

  // Sync pages config from safeElements (type === 'page_meta')
  useEffect(() => {
    const metaEl = safeElements.find((el) => el.type === 'page_meta');
    if (metaEl) {
      try {
        const parsed = JSON.parse(metaEl.data);
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          setPages(parsed.pages);
        }
      } catch (e) {
        console.error('Failed to parse whiteboard page_meta:', e);
      }
    }
  }, [elements]);

  const savePagesConfig = (newPages: WhiteboardPageItem[]) => {
    const metaEl = safeElements.find((el) => el.type === 'page_meta');
    if (metaEl && onElementUpdate) {
      onElementUpdate(metaEl.id, { pages: newPages });
    } else if (onElementAdd) {
      onElementAdd('page_meta', { pages: newPages });
    }
    if (socketRef.current) {
      socketRef.current.emit('whiteboard-update', {
        roomId: lessonId,
        type: 'page-meta-update',
        payload: { pages: newPages },
      });
    }
  };

  const handleSwitchPage = (idx: number) => {
    setCurrentPage(idx);
    setActiveMenuPageIdx(null);
    if (socketRef.current) {
      socketRef.current.emit('whiteboard-update', {
        roomId: lessonId,
        type: 'page-change',
        payload: { page: idx },
      });
    }
  };

  const handleAddPage = (customTitle?: string) => {
    const nextIdx = pages.length;
    const newPage: WhiteboardPageItem = {
      id: `page-${Date.now()}-${nextIdx}`,
      title: customTitle || `P${nextIdx + 1} · 备课页面`,
      order: nextIdx,
    };
    const nextPages = [...pages, newPage];
    setPages(nextPages);
    setCurrentPage(nextIdx);
    savePagesConfig(nextPages);
    if (socketRef.current) {
      socketRef.current.emit('whiteboard-update', {
        roomId: lessonId,
        type: 'page-change',
        payload: { page: nextIdx },
      });
    }
  };

  const handleRenamePage = (idx: number, newTitle: string) => {
    if (!newTitle.trim()) {
      setEditingPageIdx(null);
      return;
    }
    const nextPages = pages.map((p, i) => (i === idx ? { ...p, title: newTitle.trim() } : p));
    setPages(nextPages);
    savePagesConfig(nextPages);
    setEditingPageIdx(null);
    setEditingPageTitle('');
  };

  const handleDuplicatePage = (idx: number) => {
    const targetPage = pages[idx];
    if (!targetPage) return;
    const newIdx = idx + 1;
    const newPage: WhiteboardPageItem = {
      id: `page-${Date.now()}-${newIdx}`,
      title: `${targetPage.title} (副本)`,
      order: newIdx,
    };

    const nextPages = [
      ...pages.slice(0, newIdx),
      newPage,
      ...pages.slice(newIdx).map((p) => ({ ...p, order: p.order + 1 })),
    ];
    setPages(nextPages);
    setCurrentPage(newIdx);
    savePagesConfig(nextPages);

    const pageElements = safeElements.filter((el) => el.type !== 'page_meta' && (() => {
      try {
        const d = JSON.parse(el.data);
        return (d.page ?? 0) === idx || d.pageId === targetPage.id;
      } catch {
        return idx === 0;
      }
    })());

    pageElements.forEach((el) => {
      try {
        const d = JSON.parse(el.data);
        if (onElementAdd) {
          onElementAdd(el.type, {
            ...d,
            page: newIdx,
            pageId: newPage.id,
            x: (d.x ?? 100) + 20,
            y: (d.y ?? 100) + 20,
          });
        }
      } catch (e) {
        console.error('Failed duplicating page element:', e);
      }
    });
  };

  const handleDeletePage = (idx: number) => {
    if (pages.length <= 1) {
      setDialog({ title: '无法删除', message: '至少需要保留一个白板页面！', type: 'alert' });
      return;
    }

    const pageToDelete = pages[idx];
    const pageElements = safeElements.filter((el) => el.type !== 'page_meta' && (() => {
      try {
        const d = JSON.parse(el.data);
        return (d.page ?? 0) === idx || d.pageId === pageToDelete.id;
      } catch {
        return idx === 0;
      }
    })());

    const performDelete = () => {
      if (onElementDelete) {
        pageElements.forEach((el) => onElementDelete(el.id));
      }
      const nextPages = pages.filter((_, i) => i !== idx).map((p, i) => ({ ...p, order: i }));
      setPages(nextPages);
      const nextCurrentPage = Math.min(currentPage, nextPages.length - 1);
      setCurrentPage(nextCurrentPage);
      savePagesConfig(nextPages);
    };

    if (pageElements.length > 0) {
      setDialog({
        title: '确认删除白板页面',
        message: `页面 [${pageToDelete.title}] 包含 ${pageElements.length} 个组件，删除页面将同时清理该页面的组件，是否确定删除？`,
        type: 'confirm',
        onConfirm: performDelete,
      });
    } else {
      performDelete();
    }
  };

  const handleMovePage = (idx: number, direction: 'left' | 'right') => {
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= pages.length) return;

    const nextPages = [...pages];
    const item = nextPages[idx];
    nextPages[idx] = nextPages[targetIdx];
    nextPages[targetIdx] = item;

    nextPages.forEach((p, i) => {
      p.order = i;
    });
    setPages(nextPages);

    if (currentPage === idx) {
      setCurrentPage(targetIdx);
    } else if (currentPage === targetIdx) {
      setCurrentPage(idx);
    }
    savePagesConfig(nextPages);
  };
  // currentDrawing holds the shape currently being drawn, so elements is source of truth for others.
  const [currentDrawing, setCurrentDrawing] = useState<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const stageRef = useRef<any>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const socketRef = useRef<any>(null);
  const [remoteDrawings, setRemoteDrawings] = useState<Record<string, any>>({});
  // Quiz: elementId -> option student selected (not yet submitted)
  const [quizSelection, setQuizSelection] = useState<Record<string, string>>({});
  // Quiz submission result: elementId -> submitted answer + score
  const [quizAnswers, setQuizAnswers] = useState<Record<string, { option: string; score?: number; isCorrect?: boolean }>>({});
  const [quizSubmitting, setQuizSubmitting] = useState<Record<string, boolean>>({});
  // Fullscreen: when set, only this element is rendered full-viewport
  const [fullscreenElementId, setFullscreenElementId] = useState<string | null>(null);
  const [activeDragElement, setActiveDragElement] = useState<{ id: string; currentX: number; currentY: number; startPointerX: number; startPointerY: number; data: any } | null>(null);
  const dragRef = useRef<{
    id: string;
    currentX: number;
    currentY: number;
    startPointerX: number;
    startPointerY: number;
    data: any;
  } | null>(null);

  const resizeRef = useRef<{
    id: string;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);

  const resizingStateRef = useRef<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [selectedShapeId, _setSelectedShapeId] = useState<string | null>(null);
  const setSelectedShapeId = (id: string | null | ((prev: string | null) => string | null)) => {
    if (userRole === 'teacher') {
      if (typeof id === 'function') {
        _setSelectedShapeId(id);
      } else {
        _setSelectedShapeId(id);
      }
    }
  };

  const [contextMenu, _setContextMenu] = useState<{ x: number; y: number; elementId?: string } | null>(null);
  const setContextMenu = (val: { x: number; y: number; elementId?: string } | null) => {
    if (userRole === 'teacher') {
      _setContextMenu(val);
    }
  };
  const [activeResizeElement, setActiveResizeElement] = useState<{
    id: string;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);
  const [resizingState, setResizingState] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  
  const idleTimerRef = useRef<any>(null);
  const [dialog, setDialog] = useState<{
    type: 'confirm' | 'prompt' | 'alert';
    title: string;
    message: string;
    placeholder?: string;
    onConfirm: (inputValue?: string) => void | Promise<void>;
  } | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [editingProperties, setEditingProperties] = useState<any>(null);
  const [propertyUndoStack, setPropertyUndoStack] = useState<{ [elementId: string]: string[] }>({});
  const [propertyRedoStack, setPropertyRedoStack] = useState<{ [elementId: string]: string[] }>({});

  const [systemResources, setSystemResources] = useState<any[]>([]);
  const [loadingResources, setLoadingResources] = useState<boolean>(false);
  
  const [coursewares, setCoursewares] = useState<any[]>([]);
  const [zipCandidates, setZipCandidates] = useState<string[]>([]);
  const [zipUploadInfo, setZipUploadInfo] = useState<{ uuid: string; name: string } | null>(null);
  const [showEntrySelector, setShowEntrySelector] = useState<boolean>(false);

  const fetchCoursewares = async () => {
    try {
      const res = await fetch('/api/courseware');
      if (res.ok) {
        const data = await res.json();
        setCoursewares(data);
      }
    } catch (e) {
      console.error('Error fetching coursewares:', e);
    }
  };

  const fetchSystemResources = async () => {
    try {
      setLoadingResources(true);
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setSystemResources(data);
      }
    } catch (e) {
      console.error('Error fetching system resources:', e);
    } finally {
      setLoadingResources(false);
    }
  };

  useEffect(() => {
    if (selectedShapeId) {
      const selectedEl = safeElements.find(e => e.id === selectedShapeId);
      if (selectedEl) {
        if (selectedEl.type === 'html-applet') {
          fetchSystemResources();
          fetchCoursewares();
        }
        try {
          setEditingProperties(JSON.parse(selectedEl.data));
        } catch (e) {
          setEditingProperties({});
        }
      } else {
        setEditingProperties(null);
      }
    } else {
      setEditingProperties(null);
    }
  }, [selectedShapeId, elements]);

  const handleUpdateElementData = async (updatedFields: any) => {
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;
    let parsedData = {};
    try {
      parsedData = JSON.parse(selectedEl.data);
    } catch (err) {}

    const updatedData = {
      ...parsedData,
      ...updatedFields
    };

    const oldStr = selectedEl.data;
    const newStr = JSON.stringify(updatedData);

    if (oldStr !== newStr) {
      setPropertyUndoStack(prev => {
        const stack = prev[selectedEl.id] ? [...prev[selectedEl.id]] : [];
        if (stack.length >= 30) stack.shift();
        stack.push(oldStr);
        return {
          ...prev,
          [selectedEl.id]: stack
        };
      });
      setPropertyRedoStack(prev => ({
        ...prev,
        [selectedEl.id]: []
      }));
    }

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        await onElementUpdate(selectedEl.id, updatedData);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("更新属性失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleUndoProp = async () => {
    if (!selectedShapeId) return;
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;

    const stack = propertyUndoStack[selectedShapeId] || [];
    if (stack.length === 0) return;

    const previousSnapshot = stack[stack.length - 1];
    const remainingUndo = stack.slice(0, stack.length - 1);

    const currentSnapshot = selectedEl.data;
    setPropertyRedoStack(prev => {
      const rStack = prev[selectedShapeId] ? [...prev[selectedShapeId]] : [];
      rStack.push(currentSnapshot);
      return { ...prev, [selectedShapeId]: rStack };
    });

    setPropertyUndoStack(prev => ({
      ...prev,
      [selectedShapeId]: remainingUndo
    }));

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        const parsedPrev = JSON.parse(previousSnapshot);
        setEditingProperties(parsedPrev);
        await onElementUpdate(selectedShapeId, parsedPrev);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("撤销修改失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleRedoProp = async () => {
    if (!selectedShapeId) return;
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;

    const rStack = propertyRedoStack[selectedShapeId] || [];
    if (rStack.length === 0) return;

    const nextSnapshot = rStack[rStack.length - 1];
    const remainingRedo = rStack.slice(0, rStack.length - 1);

    const currentSnapshot = selectedEl.data;
    setPropertyUndoStack(prev => {
      const uStack = prev[selectedShapeId] ? [...prev[selectedShapeId]] : [];
      uStack.push(currentSnapshot);
      return { ...prev, [selectedShapeId]: uStack };
    });

    setPropertyRedoStack(prev => ({
      ...prev,
      [selectedShapeId]: remainingRedo
    }));

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        const parsedNext = JSON.parse(nextSnapshot);
        setEditingProperties(parsedNext);
        await onElementUpdate(selectedShapeId, parsedNext);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("重做修改失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleLocalPropChange = (key: string, value: any) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        [key]: value
      };
    });
  };

  const handlePropBlur = (key: string, value: any) => {
    handleUpdateElementData({ [key]: value });
  };

  const handlePropsUpdate = (updates: Record<string, any>) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...updates
      };
    });
    handleUpdateElementData(updates);
  };

  const handleNumericPropBlur = (key: string, value: string | number) => {
    const num = parseFloat(value as string);
    if (!isNaN(num)) {
      handleUpdateElementData({ [key]: num });
    }
  };

  const handleOptionChangeLocal = (index: number, value: string) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      const newOpts = [...(prev.options || [])];
      newOpts[index] = value;
      return {
        ...prev,
        options: newOpts
      };
    });
  };

  const handleOptionBlur = (index: number, value: string) => {
    if (!editingProperties) return;
    const newOpts = [...(editingProperties.options || [])];
    newOpts[index] = value;
    handleUpdateElementData({ options: newOpts });
  };

  const handleAddOption = () => {
    if (!editingProperties) return;
    const currentOpts = editingProperties.options || [];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nextLabel = alphabet[currentOpts.length] || `Option ${currentOpts.length + 1}`;
    const newOpts = [...currentOpts, `选项 ${nextLabel}`];
    
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return { ...prev, options: newOpts };
    });
    handleUpdateElementData({ options: newOpts });
  };

  const handleRemoveOption = (index: number) => {
    if (!editingProperties) return;
    const newOpts = (editingProperties.options || []).filter((_: any, i: number) => i !== index);
    
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return { ...prev, options: newOpts };
    });
    handleUpdateElementData({ options: newOpts });
  };

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const getElementFloatingPosition = (el: WhiteboardElement) => {
    try {
      const data = JSON.parse(el.data);
      if (el.type === 'pen' && data.points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (let i = 0; i < data.points.length; i += 2) {
          const px = data.points[i];
          const py = data.points[i + 1];
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
        }
        return {
          x: (minX + maxX) / 2,
          y: minY - 36
        };
      } else if (el.type === 'rectangle' || (el.type === 'shape' && data.shape === 'rect')) {
        const rectX = data.x ?? 0;
        const rectY = data.y ?? 0;
        const rectW = data.width ?? 0;
        const rectH = data.height ?? 0;
        return {
          x: rectX + rectW / 2,
          y: (rectH < 0 ? rectY + rectH : rectY) - 36
        };
      } else if (el.type === 'circle' || (el.type === 'shape' && data.shape === 'circle')) {
        const circX = data.x ?? 0;
        const circY = data.y ?? 0;
        const circR = data.radius ?? 0;
        return {
          x: circX,
          y: circY - circR - 36
        };
      } else if (el.type === 'text') {
        const textX = data.x ?? 0;
        const textY = data.y ?? 0;
        return {
          x: textX + 40,
          y: textY - 36
        };
      } else if (data.x !== undefined && data.y !== undefined) {
        return {
          x: data.x + (data.width ? data.width / 2 : 150),
          y: data.y - 36
        };
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  const handleElementDragStart = (e: React.PointerEvent, elementId: string, elementData: any) => {
    if (userRole !== 'teacher') return;
    e.preventDefault();
    const initialX = elementData.x ?? 0;
    const initialY = elementData.y ?? 0;
    const dragInfo = {
      id: elementId,
      currentX: initialX,
      currentY: initialY,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      data: elementData
    };
    dragRef.current = dragInfo;
    setActiveDragElement(dragInfo);
  };

  const handleElementDragMove = (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleElementDragEnd = async (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleResizeStart = (
    e: React.PointerEvent,
    id: string,
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    currentX: number,
    currentY: number,
    currentWidth: number,
    currentHeight: number
  ) => {
    if (userRole !== 'teacher') return;
    e.preventDefault();
    e.stopPropagation();
    
    const resizeInfo = {
      id,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
      initialWidth: currentWidth,
      initialHeight: currentHeight
    };
    const stateInfo = {
      id,
      x: currentX,
      y: currentY,
      width: currentWidth,
      height: currentHeight
    };
    
    resizeRef.current = resizeInfo;
    resizingStateRef.current = stateInfo;
    setActiveResizeElement(resizeInfo);
    setResizingState(stateInfo);
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleResizeEnd = async (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  // Window-level dragging event listeners
  useEffect(() => {
    if (!activeDragElement) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startPointerX;
      const dy = e.clientY - dragRef.current.startPointerY;
      const initialX = dragRef.current.data.x ?? 0;
      const initialY = dragRef.current.data.y ?? 0;
      
      dragRef.current.currentX = initialX + dx;
      dragRef.current.currentY = initialY + dy;
      
      setActiveDragElement({
        ...dragRef.current
      });
    };

    const onPointerUp = async (e: PointerEvent) => {
      if (!dragRef.current) return;
      const finalX = dragRef.current.currentX;
      const finalY = dragRef.current.currentY;
      const elementId = dragRef.current.id;
      const elementData = dragRef.current.data;
      
      dragRef.current = null;
      setActiveDragElement(null);
      
      if (onElementUpdate) {
        setIsSyncing(true);
        try {
          await onElementUpdate(elementId, { ...elementData, x: finalX, y: finalY });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        } catch (err) {
          console.error("Drag end update error:", err);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeDragElement, onElementUpdate, lessonId]);

  // Window-level resizing event listeners
  useEffect(() => {
    if (!activeResizeElement || !resizingState) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!resizeRef.current || !resizingStateRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;

      let nextX = resizeRef.current.initialX;
      let nextY = resizeRef.current.initialY;
      let nextW = resizeRef.current.initialWidth;
      let nextH = resizeRef.current.initialHeight;

      const minWidth = 150;
      const minHeight = 100;

      const { corner } = resizeRef.current;

      if (corner === 'bottom-right') {
        nextW = Math.max(minWidth, resizeRef.current.initialWidth + dx);
        nextH = Math.max(minHeight, resizeRef.current.initialHeight + dy);
      } else if (corner === 'bottom-left') {
        const pW = resizeRef.current.initialWidth - dx;
        if (pW >= minWidth) {
          nextW = pW;
          nextX = resizeRef.current.initialX + dx;
        }
        nextH = Math.max(minHeight, resizeRef.current.initialHeight + dy);
      } else if (corner === 'top-right') {
        nextW = Math.max(minWidth, resizeRef.current.initialWidth + dx);
        const pH = resizeRef.current.initialHeight - dy;
        if (pH >= minHeight) {
          nextH = pH;
          nextY = resizeRef.current.initialY + dy;
        }
      } else if (corner === 'top-left') {
        const pW = resizeRef.current.initialWidth - dx;
        if (pW >= minWidth) {
          nextW = pW;
          nextX = resizeRef.current.initialX + dx;
        }
        const pH = resizeRef.current.initialHeight - dy;
        if (pH >= minHeight) {
          nextH = pH;
          nextY = resizeRef.current.initialY + dy;
        }
      }

      resizingStateRef.current = {
        id: resizeRef.current.id,
        x: nextX,
        y: nextY,
        width: nextW,
        height: nextH
      };

      setResizingState({
        ...resizingStateRef.current
      });
    };

    const onPointerUp = async (e: PointerEvent) => {
      if (!resizeRef.current || !resizingStateRef.current) return;
      const { id } = resizeRef.current;
      const { x, y, width, height } = resizingStateRef.current;

      resizeRef.current = null;
      resizingStateRef.current = null;
      setActiveResizeElement(null);
      setResizingState(null);

      const targetEl = safeElements.find(el => el.id === id);
      if (targetEl && onElementUpdate) {
        try {
          const currentData = JSON.parse(targetEl.data);
          setIsSyncing(true);
          await onElementUpdate(id, { ...currentData, x, y, width, height });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        } catch (err) {
          console.error("Resize end update error:", err);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeResizeElement, resizingState, elements, onElementUpdate, lessonId]);

  const handleElementDelete = (elementId: string) => {
    setDialog({
      type: 'confirm',
      title: '删除组件',
      message: '您确定要从白板中删除这个组件或图形吗？该操作不可撤销。',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          if (onElementDelete) {
            await onElementDelete(elementId);
          } else {
            await fetch(`/api/lessons/${lessonId}/whiteboard/${elementId}`, {
              method: 'DELETE'
            });
          }
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Delete element failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  const handleClearBoard = () => {
    setDialog({
      type: 'confirm',
      title: '清空白板',
      message: '您确定要清空画布上的所有组件、图形和线条吗？此操作将永久清空白板且不可逆！',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          if (onClearBoard) {
            await onClearBoard();
          } else {
            await fetch(`/api/lessons/${lessonId}/whiteboard`, {
              method: 'DELETE'
            });
          }
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Clear board failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  const handleResetBoard = () => {
    setDialog({
      type: 'confirm',
      title: '重置白板',
      message: '您确定要将白板重置为开始上课的状态吗？您在白板上做的所有临时修改都将被重置。',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          await fetch(`/api/lessons/${lessonId}/whiteboard/reset`, {
            method: 'POST'
          });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Reset board failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          handleElementDelete(selectedShapeId);
          setSelectedShapeId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShapeId]);

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!enableAutoAI) return;
    idleTimerRef.current = setTimeout(async () => {
      // 1 minute idle, auto-ask
      setIsSyncing(true);
      try {
        const res = await fetch(`/api/lessons/${lessonId}/ai-tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements: safeElements.map(e => ({ type: e.type, data: JSON.parse(e.data) })) })
        });
        if (res.ok) {
           frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
           if (onRefresh) onRefresh();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSyncing(false);
      }
    }, 60000);
  };

  useEffect(() => {
    resetIdleTimer();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [elements]); // Reset timer on new external elements too, or just user interaction

  // Socket 连接：直接获取宿主 Socket 单例（替代 MfeContext DI）
  useEffect(() => {
    const socket = getSocketInstance();
    socketRef.current = socket;

    socket.emit('join-room', lessonId);

    const handleWhiteboardSync = (data: any) => {
      if (data.type === 'temp-draw') {
         setRemoteDrawings(prev => ({ ...prev, [data.userId]: data.payload }));
      } else if (data.type === 'temp-end') {
         setRemoteDrawings(prev => {
            const next = { ...prev };
            delete next[data.userId];
            return next;
         });
      } else if (data.type === 'refresh') {
         if (onRefresh) onRefresh();
      } else if (data.type === 'segment-change') {
         if (onSegmentSync && data.payload?.segmentId) {
            onSegmentSync(data.payload.segmentId);
         }
      } else if (data.type === 'page-change') {
         if (typeof data.payload?.page === 'number') {
            setCurrentPage(data.payload.page);
         }
      } else if (data.type === 'page-meta-update') {
         if (Array.isArray(data.payload?.pages)) {
            setPages(data.payload.pages);
         }
      }
    };

    socketRef.current.on('whiteboard-sync', handleWhiteboardSync);

    return () => {
      socketRef.current?.off('whiteboard-sync', handleWhiteboardSync);
    }
  }, [lessonId, onRefresh, onSegmentSync]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // Use offsetWidth and offsetHeight for accurate display size calculations including border
        if (containerRef.current) {
          setContainerSize({
            width: containerRef.current.offsetWidth,
            height: containerRef.current.offsetHeight,
          });
        }
      }
    });
    observer.observe(containerRef.current);
    
    // Fallback: also run an initial resize and register window resize
    const handleWindowResize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  const handleMouseDown = (e: any) => {
    resetIdleTimer();
    setContextMenu(null);
    if (tool === 'cursor') {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedShapeId(null);
      }
      return;
    }
    if (isSyncing) return;
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    if (tool === 'pen') {
      setCurrentDrawing({ type: 'pen', points: [pos.x, pos.y], color: 'black' });
    } else if (tool === 'highlighter') {
      setCurrentDrawing({ type: 'highlighter', points: [pos.x, pos.y], color: highlighterColor });
    } else if (tool === 'rect') {
      setCurrentDrawing({ type: 'rectangle', x: pos.x, y: pos.y, width: 0, height: 0, stroke: 'blue' });
    } else if (tool === 'circle') {
      setCurrentDrawing({ type: 'circle', x: pos.x, y: pos.y, radius: 0, stroke: 'green' });
    } else if (tool === 'text') {
      setCurrentDrawing({ type: 'text', x: pos.x, y: pos.y, text: 'Click to edit...', fontSize: 16, color: 'black' });
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !currentDrawing) return;
    const pos = e.target.getStage().getPointerPosition();
    
    if (currentDrawing.type === 'pen' || currentDrawing.type === 'highlighter') {
      setCurrentDrawing({
        ...currentDrawing,
        points: currentDrawing.points.concat([pos.x, pos.y])
      });
    } else if (currentDrawing.type === 'rectangle') {
      setCurrentDrawing({
        ...currentDrawing,
        width: pos.x - currentDrawing.x,
        height: pos.y - currentDrawing.y
      });
    } else if (currentDrawing.type === 'circle') {
      const radius = Math.sqrt(Math.pow(pos.x - currentDrawing.x, 2) + Math.pow(pos.y - currentDrawing.y, 2));
      setCurrentDrawing({
        ...currentDrawing,
        radius
      });
    }
  };

  const handleMouseUp = async () => {
    if (!isDrawing || !currentDrawing) return;
    setIsDrawing(false);
    
    const drawingToSubmit = { ...currentDrawing, page: currentPage, segmentId: activeSegmentId };
    setCurrentDrawing(null); // Optimistically remove, the parent API fetch will restore it. Actually, wait. The user might see it disappear.
    // It's better to immediately call onElementAdd which is hopefully fast.
    
    setIsSyncing(true);
    try {
      await onElementAdd(drawingToSubmit.type, drawingToSubmit);
      frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!socketRef.current || !socketRef.current.id) return;
    if (currentDrawing) {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'temp-draw', userId: socketRef.current.id, payload: { ...currentDrawing, page: currentPage, segmentId: activeSegmentId } });
    } else {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'temp-end', userId: socketRef.current.id });
    }
  }, [currentDrawing, lessonId, currentPage, activeSegmentId]);

  useEffect(() => {
    if (activeSegmentId && socketRef.current) {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'segment-change', payload: { segmentId: activeSegmentId } });
    }
  }, [activeSegmentId, lessonId]);

  const renderDrawingRaw = (drawing: any) => {
    if (!drawing) return null;
    const drawPage = drawing.page ?? 0;
    const currentObj = pages[currentPage];
    const pageMatches = (drawing.pageId && currentObj?.id) ? drawing.pageId === currentObj.id : drawPage === currentPage;
    if (!pageMatches) return null;
    if (activeSegmentId && drawing.segmentId && drawing.segmentId !== activeSegmentId) return null;
    if (drawing.type === 'pen') {
      return (
        <Line
          points={drawing.points}
          stroke={drawing.color}
          strokeWidth={4}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
        />
      );
    }
    if (drawing.type === 'highlighter') {
      return (
        <Line
          points={drawing.points}
          stroke={drawing.color || '#facc15'}
          strokeWidth={18}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
          opacity={0.5}
        />
      );
    }
    if (drawing.type === 'rectangle') {
      return <Rect x={drawing.x} y={drawing.y} width={drawing.width} height={drawing.height} stroke={drawing.stroke} />;
    }
    if (drawing.type === 'circle') {
      return <Circle x={drawing.x} y={drawing.y} radius={drawing.radius} stroke={drawing.stroke} />;
    }
    if (drawing.type === 'text') {
      return <KonvaText x={drawing.x} y={drawing.y} text={drawing.text} fontSize={drawing.fontSize} fill={drawing.color} />;
    }
    return null;
  };

  const renderActiveDrawing = () => renderDrawingRaw(currentDrawing ? { ...currentDrawing, page: currentPage, segmentId: activeSegmentId } : null);

  const renderRemoteDrawings = () => {
    return Object.values(remoteDrawings).map((drawing, i) => (
      <React.Fragment key={i}>
        {renderDrawingRaw(drawing)}
      </React.Fragment>
    ));
  };

  // Render incoming elements
  const renderElement = (el: WhiteboardElement) => {
    try {
      const data = JSON.parse(el.data);
      const isDraggingThis = activeDragElement?.id === el.id;
      const isResizingThis = resizingState?.id === el.id;
      const displayX = isResizingThis ? resizingState.x : (isDraggingThis ? activeDragElement.currentX : (data.x ?? 0));
      const displayY = isResizingThis ? resizingState.y : (isDraggingThis ? activeDragElement.currentY : (data.y ?? 0));

      const getInitialWidth = (type: string) => {
        if (type === 'plugin') return data.width || 500;
        if (type === 'hello-world') return 160;
        if (type === 'quiz') return 300;
        if (type === 'rollcall') return 320;
        if (type === 'assignment') return 310;
        if (type === 'html-applet') return 400;
        if (type === 'code-sandbox') return 400;
        if (type === 'math-graph') return 400;
        if (type === 'presentation') return 600;
        return 300;
      };

      const getInitialHeight = (type: string) => {
        if (type === 'plugin') return data.height || 400;
        if (type === 'hello-world') return 64;
        if (type === 'quiz') return 280;
        if (type === 'rollcall') return 310;
        if (type === 'assignment') return 250;
        if (type === 'html-applet') return 300;
        if (type === 'code-sandbox') return 320;
        if (type === 'math-graph') return 350;
        if (type === 'presentation') return 400;
        return 300;
      };

      const displayWidth = isResizingThis ? resizingState.width : (data.width ?? getInitialWidth(el.type));
      const displayHeight = isResizingThis 
        ? resizingState.height 
        : (data.isMinimized 
            ? 32 
            : (data.height ?? getInitialHeight(el.type)));
      const isThisSelected = selectedShapeId === el.id;

      const renderResizeHandles = () => {
        if (!isThisSelected) return null;
        return (
          <>
            {/* Outline highlight */}
            <div className="absolute -inset-1 border-2 border-indigo-500 rounded-lg pointer-events-none z-50 shadow-md animate-pulse duration-1000 animate-in fade-in" />
            {/* Corner Resize Handles */}
            <div 
              className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nwse-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'top-left', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nesw-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'top-right', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nesw-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'bottom-left', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nwse-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'bottom-right', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
          </>
        );
      };

      if (el.type === 'plugin') {
        const isTeacherView = userRole === 'teacher';
        const widgetId = isTeacherView ? data.teacherWidgetId : data.studentWidgetId;
        const slot = isTeacherView ? 'teacher.dashboard.widget' : 'student.view';

        return (
          <Group key={el.id}>
            <Html
              divProps={{
                style: {
                  position: 'absolute',
                  top: `${displayY}px`,
                  left: `${displayX}px`,
                  pointerEvents: 'none',
                  zIndex: isThisSelected ? 20 : 10
                }
              }}
            >
              <div 
                onPointerDown={(e) => {
                  setSelectedShapeId(el.id);
                  e.stopPropagation();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  if (containerRect) {
                    setContextMenu({
                      x: e.clientX - containerRect.left,
                      y: e.clientY - containerRect.top,
                      elementId: el.id
                    });
                  }
                }}
                className="bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative" 
                style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
              >
                <div 
                  className="bg-indigo-50 text-indigo-750 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-indigo-150 cursor-move select-none shrink-0"
                  onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                  onPointerMove={handleElementDragMove}
                  onPointerUp={handleElementDragEnd}
                >
                  <span>{data.title || 'Plugin Component'}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-indigo-650 hover:text-indigo-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                    <button 
                      onClick={() => handleElementDelete(el.id)}
                      onPointerDown={e => e.stopPropagation()}
                      className="p-1 hover:bg-slate-200/50 rounded-full text-indigo-600 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                      title="删除组件"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                {!data.isMinimized && (
                  <div className="flex-grow bg-white overflow-auto relative min-h-0 p-2">
                    <PluginCardRenderer 
                      pluginId={data.pluginId} 
                      slot={slot} 
                      widgetId={widgetId} 
                      elementId={el.id}
                      lessonId={lessonId}
                    />
                  </div>
                )}
                {!data.isMinimized && renderResizeHandles()}
              </div>
            </Html>
          </Group>
        );
      }

      if (el.type === 'hello-world') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
                style: {
                  position: 'absolute',
                  top: `${displayY}px`,
                  left: `${displayX}px`,
                  pointerEvents: 'none',
                  zIndex: isThisSelected ? 20 : 10
                }
              }}
            >
              <div 
                onPointerDown={(e) => {
                  setSelectedShapeId(el.id);
                  e.stopPropagation();
                }}
                className="bg-transparent"
                style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
              >
                <HelloWorldWrapper
                  elementId={el.id}
                  data={data}
                  onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                  onPointerMove={handleElementDragMove}
                  onPointerUp={handleElementDragEnd}
                  onDelete={() => handleElementDelete(el.id)}
                  onElementUpdate={onElementUpdate}
                  lessonId={lessonId}
                />
                {renderResizeHandles()}
              </div>
            </Html>
          </Group>
        );
      }

      if (el.type === 'rollcall') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-transparent"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <RollCallWrapper
                elementId={el.id}
                data={data}
                onElementUpdate={onElementUpdate}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }

      if (el.type === 'quiz') {
        return null;
      }
      if (el.type === 'assignment') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative select-none" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-orange-50 text-orange-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-orange-100 cursor-move select-none shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Assignment Upload Task</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-orange-600 hover:text-orange-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-orange-655 hover:text-orange-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-orange-600 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="p-4 text-center flex-1 overflow-y-auto flex flex-col justify-center min-h-0">
                  <p className="font-semibold text-gray-800 mb-1 text-xs">{data.title}</p>
                  <p className="text-xs text-gray-500 mb-3 line-clamp-3">{data.description}</p>
                  <button 
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-1.5 rounded transition-colors text-xs shadow-sm cursor-pointer" 
                    onClick={() => {
                      setDialog({
                        type: 'alert',
                        title: '作业文件上传',
                        message: `系统已经成功模拟拉起本地文件选择和上传流程！\n已准备上传作业: ${data.title ?? '白板作业'}`,
                        onConfirm: () => setDialog(null)
                      });
                    }}
                  >
                    Upload File
                  </button>
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'html-applet') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-gray-100 text-gray-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-gray-200 cursor-move select-none shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Interactive Courseware</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-gray-600 hover:text-gray-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-gray-650 hover:text-gray-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-gray-650 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="flex-1 bg-white overflow-hidden relative min-h-0">
                  <iframe
                    className="w-full h-full border-none"
                    src={data.coursewareUuid ? `/runtime/${data.coursewareUuid}/` : (data.resourceId ? `/api/resources/${data.resourceId}/` : undefined)}
                    srcDoc={data.coursewareUuid || data.resourceId ? undefined : wrapSrcDocWithBridge(data.code, lessonId)}
                    sandbox="allow-scripts allow-forms allow-downloads"
                  />
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'pen') {
        const isSelected = selectedShapeId === el.id;
        return (
          <Line
            key={el.id}
            id={el.id}
            points={data.points}
            stroke={isSelected ? '#3b82f6' : (data.color || 'black')}
            strokeWidth={isSelected ? 6 : 4}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              const nextPoints = data.points.map((val: number, i: number) => {
                return i % 2 === 0 ? val + deltaX : val + deltaY;
              });
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, points: nextPoints });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'highlighter') {
        const isSelected = selectedShapeId === el.id;
        return (
          <Line
            key={el.id}
            id={el.id}
            points={data.points}
            stroke={isSelected ? '#3b82f6' : (data.color || '#facc15')}
            strokeWidth={isSelected ? 24 : 18}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            opacity={0.5}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              const nextPoints = data.points.map((val: number, i: number) => {
                return i % 2 === 0 ? val + deltaX : val + deltaY;
              });
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, points: nextPoints });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'rectangle' || (el.type === 'shape' && data.shape === 'rect')) {
        const isSelected = selectedShapeId === el.id;
        return (
          <Rect 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            width={data.width} 
            height={data.height} 
            fill={data.fill || 'transparent'} 
            stroke={isSelected ? '#3b82f6' : (data.stroke || 'blue')}
            strokeWidth={isSelected ? 3 : 1}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'circle' || (el.type === 'shape' && data.shape === 'circle')) {
        const isSelected = selectedShapeId === el.id;
        return (
          <Circle 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            radius={data.radius} 
            fill={data.fill || 'transparent'} 
            stroke={isSelected ? '#3b82f6' : (data.stroke || 'green')}
            strokeWidth={isSelected ? 3 : 1}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'text') {
        const isSelected = selectedShapeId === el.id;
        return (
          <KonvaText 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            text={data.text} 
            fontSize={data.fontSize || 16} 
            fill={isSelected ? '#3b82f6' : (data.color || 'black')}
            fontStyle={isSelected ? 'bold' : 'normal'}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'code-sandbox') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="relative rounded-lg shadow-xl"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <CodeSandboxWrapper 
                elementId={el.id} 
                data={data} 
                onElementUpdate={onElementUpdate ? async (id, d) => {
                   await onElementUpdate(id, d);
                   frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                } : undefined}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'math-graph') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="relative rounded-lg shadow-xl"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <MathGraphWrapper 
                elementId={el.id} 
                data={data} 
                onElementUpdate={onElementUpdate ? async (id, d) => {
                   await onElementUpdate(id, d);
                   frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                } : undefined}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'presentation') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-305 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative select-none" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-purple-100 text-purple-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-purple-200 cursor-move shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Interactive Presentation</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-purple-600 hover:text-purple-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-purple-650 hover:text-purple-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-purple-600 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="flex-1 min-h-0 relative bg-white" style={{ pointerEvents: 'auto' }}>
                  <RevealPresentationWrapper 
                    elementId={el.id} 
                    data={data} 
                    userRole={userRole}
                    onElementUpdate={onElementUpdate ? async (id, d) => {
                       await onElementUpdate(id, d);
                       frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                    } : undefined} 
                  />
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  const handleWhiteboardDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverBoard) setIsDragOverBoard(true);
  };

  const handleWhiteboardDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverBoard(true);
  };

  const handleWhiteboardDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only reset if leaving container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverBoard(false);
    }
  };

  // 组装元素 data：合并内容字段与定位字段，并补齐各类型的默认值
  const buildElementData = (
    type: string,
    content: Record<string, any>,
    x: number,
    y: number,
  ): Record<string, any> => {
    const base = { x, y, page: currentPage, segmentId: activeSegmentId };
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
        return { ...base, code: content.code ?? '' };
      case 'assignment':
        return { ...base, title: content.title ?? 'New Assignment', description: content.description ?? '' };
      case 'hello-world':
        return base;
      case 'rollcall':
        return { ...base, allStudents: [] };
      default:
        return { ...base, ...content };
    }
  };

  // 命令式接口：在画板中央插入元素（供备课画板点击添加）
  const addElementAtCenter = async (type: string, contentData: Record<string, any>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.round(rect.width / 2);
    const y = Math.round(rect.height / 2);
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
  };

  useImperativeHandle(ref, () => ({ addElementAtCenter }));

  const handleWhiteboardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      let payloadStr = e.dataTransfer.getData('application/json');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('text/plain');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('text');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('Text');
      
      console.log("Whiteboard drop triggered. Payload:", payloadStr);
      if (!payloadStr) return;
      
      let payload;
      try {
        payload = JSON.parse(payloadStr);
      } catch (err) {
        console.error("Failed to parse drop JSON payload:", err);
        return;
      }
      
      if (typeof payload !== 'object' || !payload) return;

      if (!containerRef.current) {
        console.warn("containerRef.current is not loaded on drop");
        return;
      }
      const stageBox = containerRef.current.getBoundingClientRect();
      let dropX = e.clientX - stageBox.left;
      let dropY = e.clientY - stageBox.top;
      
      console.log(`Adding whiteboard element of type ${payload.type} at (${dropX}, ${dropY})`);
      setIsSyncing(true);
      try {
        await onElementAdd(payload.type, buildElementData(payload.type, payload, dropX, dropY));
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
      console.error("Drop error", err);
    }
  };

  return (
    <div className="flex-1 flex flex-row min-h-0 overflow-hidden bg-white">
      <div 
        className="flex-1 flex flex-col min-h-0 bg-white relative min-w-0"
        onDragOver={handleWhiteboardDragOver}
        onDragEnter={handleWhiteboardDragEnter}
        onDrop={handleWhiteboardDrop}
      >
      <WhiteboardToolbar
        tool={tool}
        setTool={setTool}
        setSelectedShapeId={setSelectedShapeId}
        highlighterColor={highlighterColor}
        setHighlighterColor={setHighlighterColor}
        onElementAdd={onElementAdd}
        currentPage={currentPage}
        activeSegmentId={activeSegmentId}
        lessonId={lessonId}
        safeElements={safeElements}
        selectedShapeId={selectedShapeId}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        userRole={userRole}
        isSyncing={isSyncing}
        setIsSyncing={setIsSyncing}
        handleClearBoard={handleClearBoard}
        handleResetBoard={handleResetBoard}
        handleElementDelete={handleElementDelete}
        setDialog={setDialog}
        setDialogInput={setDialogInput}
        onRefresh={onRefresh}
      />
      
      <div 
        ref={containerRef} 
        className="flex-1 bg-slate-50/70 rounded-2xl border border-slate-200/80 relative overflow-hidden w-full mb-14 shadow-inner transition-all"
        style={{
          backgroundImage: showGrid ? 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)' : 'none',
          backgroundSize: '24px 24px',
          backgroundColor: '#f8fafc'
        }}
        onDragOver={handleWhiteboardDragOver}
        onDragEnter={handleWhiteboardDragEnter}
        onDragLeave={handleWhiteboardDragLeave}
        onDrop={async (e) => {
          setIsDragOverBoard(false);
          await handleWhiteboardDrop(e);
        }}
      >
        {/* Drag dropzone hover hint */}
        {isDragOverBoard && (
          <div className="absolute inset-0 border-2 border-dashed border-indigo-500 bg-indigo-500/10 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center text-indigo-600 font-bold text-sm z-30 animate-in fade-in pointer-events-none">
            <Plus size={32} className="mb-2 text-indigo-600 animate-bounce" />
            <span>释放鼠标将组件放入当前白板页面</span>
          </div>
        )}

        {/* Empty state hint */}
        {safeElements.filter((el) => {
          if (el.type === 'page_meta') return false;
          try {
            const d = JSON.parse(el.data);
            const elPage = d.page ?? 0;
            const currentObj = pages[currentPage];
            const pageMatches = (d.pageId && currentObj?.id) ? d.pageId === currentObj.id : elPage === currentPage;
            if (!pageMatches) return false;
            if (activeSegmentId && d.segmentId && d.segmentId !== activeSegmentId) return false;
            return true;
          } catch {
            return currentPage === 0;
          }
        }).length === 0 && !fullscreenElementId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-slate-400 p-6 z-0">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50/80 border border-indigo-100/80 flex items-center justify-center mb-3 shadow-2xs">
              <Sparkles className="w-7 h-7 text-indigo-500 animate-pulse" />
            </div>
            <p className="font-bold text-sm text-slate-700 mb-1">交互式备课白板</p>
            <p className="text-xs text-slate-400 max-w-sm text-center">
              从左侧组件库拖拽组件至此处，或使用顶部工具栏插入画笔、几何图形与 AI 助教
            </p>
          </div>
        )}

        <div className="absolute inset-0 w-full h-full overflow-hidden">
          {containerSize.width > 0 && containerSize.height > 0 && (
            fullscreenElementId ? (
              /* ── Fullscreen overlay ── */
              (() => {
                const fsEl = safeElements.find(e => e.id === fullscreenElementId);
                if (!fsEl) { setFullscreenElementId(null); return null; }
                let fsData: any = {};
                try { fsData = JSON.parse(fsEl.data); } catch (_) {}
                const pad = 16;
                const fsW = containerSize.width - pad * 2;
                const fsH = containerSize.height - pad * 2;
                return (
                  <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
                    <div className="relative bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ width: Math.max(400, fsW), height: Math.max(300, fsH) }}>
                      <div className="bg-indigo-50 text-indigo-700 px-4 py-2 flex justify-between items-center text-sm font-semibold border-b border-indigo-100 shrink-0">
                        <span>{fsEl.type === 'quiz' ? '📝 随堂测验' : fsEl.type === 'timer' ? '⏱ 计时器' : fsEl.type === 'assignment' ? '📋 作业' : fsEl.type === 'code-sandbox' ? '💻 代码沙箱' : fsEl.type === 'html-applet' ? '🌐 交互课件' : fsEl.type === 'rollcall' ? '🎲 随机点名' : fsEl.type}</span>
                        <button
                          onClick={() => setFullscreenElementId(null)}
                          className="p-1.5 hover:bg-indigo-200/50 rounded-lg text-indigo-600 hover:text-indigo-900 transition-colors cursor-pointer flex items-center gap-1 text-xs"
                        >
                          <Minimize2 size={14} /> 退出全屏
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-6">
                        {fsEl.type === 'quiz' && (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <h3 className="text-xl font-bold text-gray-800">{fsData.question}</h3>
                            <div className="flex flex-col gap-3">
                              {(fsData.options || []).map((opt: string, i: number) => (
                                <button key={i} className="px-5 py-4 text-left bg-gray-50 border-2 border-gray-200 rounded-xl text-base hover:bg-gray-100 transition-colors">
                                  <span className="font-bold text-indigo-600 mr-3">{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}.</span>
                                  {opt}
                                </button>
                              ))}
                            </div>
                            {fsData.submissions && Object.keys(fsData.submissions).length > 0 && (
                              <div className="mt-4 p-4 bg-gray-50 rounded-xl">
                                <p className="text-sm font-semibold text-gray-600">提交统计: {Object.keys(fsData.submissions).length} 人已作答</p>
                              </div>
                            )}
                          </div>
                        )}
                        {fsEl.type === 'timer' && (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                              <div className="text-8xl font-mono font-bold text-orange-600 mb-4">
                                {String(Math.floor((fsData.remaining ?? fsData.duration ?? 60) / 60)).padStart(2, '0')}:{String((fsData.remaining ?? fsData.duration ?? 60) % 60).padStart(2, '0')}
                              </div>
                              <p className="text-lg text-gray-500">{fsData.label || '计时器'}</p>
                            </div>
                          </div>
                        )}
                        {fsEl.type === 'assignment' && (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <h3 className="text-xl font-bold text-gray-800">{fsData.title}</h3>
                            <p className="text-gray-600 text-base whitespace-pre-wrap">{fsData.description}</p>
                            <button className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 rounded-xl transition-colors text-base shadow-sm cursor-pointer">Upload File</button>
                          </div>
                        )}
                        {fsEl.type === 'code-sandbox' && (
                          <div className="h-full flex flex-col gap-4">
                            <textarea value={fsData.code || ''} readOnly className="flex-1 p-4 bg-gray-900 text-green-400 font-mono text-sm rounded-xl resize-none" />
                          </div>
                        )}
                        {fsEl.type === 'html-applet' && (
                          <div className="h-full flex items-center justify-center">
                            <div className="text-center text-gray-500">
                              <BookOpen size={64} className="mx-auto mb-4 text-indigo-300" />
                              <p className="text-lg font-semibold">{fsData.title || '交互课件'}</p>
                              {fsData.coursewareUuid && <iframe src={`/runtime/${fsData.coursewareUuid}/`} className="w-full h-[60vh] mt-4 rounded-xl border" />}
                            </div>
                          </div>
                        )}
                        {fsEl.type === 'rollcall' && (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                              <div className="text-6xl font-bold text-indigo-600 mb-4">{fsData.selectedStudent || '点击点名'}</div>
                              <p className="text-lg text-gray-500">随机点名</p>
                            </div>
                          </div>
                        )}
                        {!['quiz', 'timer', 'assignment', 'code-sandbox', 'html-applet', 'rollcall'].includes(fsEl.type) && (
                          <div className="flex items-center justify-center h-full text-gray-400 text-sm">此组件类型暂不支持全屏预览</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
            <Stage
            width={containerSize.width}
            height={containerSize.height}
            onMouseDown={handleMouseDown}
            onMousemove={handleMouseMove}
            onMouseup={handleMouseUp}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (containerRect) {
                const x = e.evt.clientX - containerRect.left;
                const y = e.evt.clientY - containerRect.top;
                
                const node = e.target;
                const targetId = node.id();
                
                if (targetId) {
                  setSelectedShapeId(targetId);
                  setContextMenu({
                    x,
                    y,
                    elementId: targetId
                  });
                } else {
                  setContextMenu({
                    x,
                    y
                  });
                }
              }
            }}
            ref={stageRef}
            className="w-full h-full cursor-crosshair"
          >
            <Layer>
              {safeElements.filter(el => {
                if (el.type === 'page_meta') return false;
                try {
                  const data = JSON.parse(el.data);
                  const elPage = data.page ?? 0;
                  const currentObj = pages[currentPage];
                  const pageMatches = (data.pageId && currentObj?.id) ? data.pageId === currentObj.id : elPage === currentPage;
                  if (!pageMatches) return false;
                  if (activeSegmentId && data.segmentId && data.segmentId !== activeSegmentId) return false;
                  return true;
                } catch (e) {
                  return currentPage === 0;
                }
              }).map(renderElement)}
              {/* Show drawing in progress */}
              {renderActiveDrawing()}
              {/* Show remote drawings */}
              {renderRemoteDrawings()}
            </Layer>
          </Stage>
          )
        )}

        {/* Floating Context-sensitive Deletion Pill above selected shape */}
        {selectedShapeId && (() => {
          const selectedEl = safeElements.find(e => e.id === selectedShapeId);
          if (!selectedEl) return null;
          const pos = getElementFloatingPosition(selectedEl);
          if (!pos) return null;
          
          const left = Math.max(10, Math.min(containerSize.width - 150, pos.x - 60));
          const top = Math.max(10, Math.min(containerSize.height - 50, pos.y));
          
          return (
            <div 
              style={{ left: `${left}px`, top: `${top}px`, pointerEvents: 'auto' }}
              className="absolute bg-white text-gray-800 shadow-xl border border-red-200 rounded-lg py-1 px-2 flex items-center gap-1.5 z-30 animate-in fade-in slide-in-from-bottom-2 duration-150 animate-out fade-out duration-100"
            >
              <span className="text-xs font-semibold px-1 text-gray-500 capitalize select-none">{selectedEl.type}</span>
              <div className="w-[1px] h-3 bg-gray-200" />
              <button 
                onClick={() => {
                  handleElementDelete(selectedShapeId);
                  setSelectedShapeId(null);
                }}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-white hover:bg-red-600 px-2 py-0.5 rounded transition-all font-medium cursor-pointer"
              >
                <Trash2 size={12} />
                删除
              </button>
            </div>
          );
        })()}

        {/* Elegant Right-Click Context Menu */}
        {contextMenu && (
          <div 
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, pointerEvents: 'auto' }}
            className="absolute bg-white rounded-lg shadow-2xl border border-gray-200 py-1.5 w-44 z-40 font-sans text-sm animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {contextMenu.elementId ? (
              <>
                <div className="px-3 py-1 text-[11px] text-gray-500 font-bold uppercase tracking-wider select-none">
                  组件选项
                </div>
                <button 
                  onClick={() => {
                    const elId = contextMenu.elementId;
                    if (elId) {
                      handleElementDelete(elId);
                      if (selectedShapeId === elId) {
                        setSelectedShapeId(null);
                      }
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-red-600 hover:bg-red-50 transition-colors text-xs font-semibold"
                >
                  <Trash2 size={14} />
                  删除此组件
                </button>
              </>
            ) : (
              <>
                <div className="px-3 py-1 text-[11px] text-gray-400 font-bold uppercase tracking-wider select-none">
                  白板操作
                </div>
                <button 
                  onClick={() => {
                    setTool('cursor');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'cursor' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <MousePointer2 size={14} />
                  选择工具 (Cursor)
                </button>
                <button 
                  onClick={() => {
                    setTool('pen');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'pen' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <PenTool size={14} />
                  画笔工具 (Pen)
                </button>
                <button 
                  onClick={() => {
                    setTool('highlighter');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'highlighter' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Highlighter size={14} />
                  高亮荧光笔 (Highlighter)
                </button>
                <button 
                  onClick={() => {
                    setTool('rect');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'rect' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Square size={14} />
                  矩形工具 (Rectangle)
                </button>
                <button 
                  onClick={() => {
                    setTool('circle');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'circle' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <CircleIcon size={14} />
                  圆形工具 (Circle)
                </button>
                <button 
                  onClick={() => {
                    setTool('text');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'text' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Type size={14} />
                  文本工具 (Text)
                </button>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      <WhiteboardPageBar
        pages={pages}
        currentPage={currentPage}
        showPageDrawer={showPageDrawer}
        setShowPageDrawer={setShowPageDrawer}
        editingPageIdx={editingPageIdx}
        setEditingPageIdx={setEditingPageIdx}
        editingPageTitle={editingPageTitle}
        setEditingPageTitle={setEditingPageTitle}
        activeMenuPageIdx={activeMenuPageIdx}
        setActiveMenuPageIdx={setActiveMenuPageIdx}
        safeElements={safeElements}
        handleSwitchPage={handleSwitchPage}
        handleRenamePage={handleRenamePage}
        handleDuplicatePage={handleDuplicatePage}
        handleMovePage={handleMovePage}
        handleDeletePage={handleDeletePage}
        handleAddPage={handleAddPage}
      />

      <WhiteboardDialog
        dialog={dialog}
        dialogInput={dialogInput}
        setDialogInput={setDialogInput}
        setDialog={setDialog}
      />

      <CoursewareEntrySelectorModal
        showEntrySelector={showEntrySelector}
        setShowEntrySelector={setShowEntrySelector}
        zipUploadInfo={zipUploadInfo}
        zipCandidates={zipCandidates}
        handlePropsUpdate={handlePropsUpdate}
        fetchCoursewares={fetchCoursewares}
      />
    </div>

    {/* 注入右侧属性编辑器侧边栏 */}
    {isEditMode && selectedShapeId && editingProperties && (() => {
       const selectedEl = safeElements.find(e => e.id === selectedShapeId);
       if (!selectedEl) return null;
       
       return (
          <div className="w-80 h-full max-h-full bg-slate-50 border-l border-slate-200 flex flex-col font-sans text-xs select-none shadow-xl shrink-0 z-20 animate-in slide-in-from-right duration-200" onPointerDown={e => e.stopPropagation()}>
            {/* 顶栏 */}
            <div className="px-4 py-3 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-slate-500 animate-spin" style={{ animationDuration: '6s' }} />
                <span className="font-bold text-slate-800 text-sm">属性编辑器</span>
              </div>
              <div className="flex items-center gap-1.5 font-sans">
                {/* 撤销 (Undo) 按钮 */}
                <button
                  onClick={handleUndoProp}
                  disabled={(propertyUndoStack[selectedShapeId] || []).length === 0}
                  className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
                    (propertyUndoStack[selectedShapeId] || []).length === 0
                      ? 'text-slate-350 bg-transparent border-transparent opacity-40 cursor-not-allowed'
                      : 'text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-200 active:bg-slate-150'
                  }`}
                  title="撤销属性修改"
                >
                  <Undo2 size={13} />
                  {((propertyUndoStack[selectedShapeId] || []).length > 0) && (
                    <span className="text-[10px] font-bold text-slate-500">{(propertyUndoStack[selectedShapeId] || []).length}</span>
                  )}
                </button>

                {/* 重做 (Redo) 按钮 */}
                <button
                  onClick={handleRedoProp}
                  disabled={(propertyRedoStack[selectedShapeId] || []).length === 0}
                  className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
                    (propertyRedoStack[selectedShapeId] || []).length === 0
                      ? 'text-slate-350 bg-transparent border-transparent opacity-40 cursor-not-allowed'
                      : 'text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-200 active:bg-slate-150'
                  }`}
                  title="重做属性修改"
                >
                  <Redo2 size={13} />
                  {((propertyRedoStack[selectedShapeId] || []).length > 0) && (
                    <span className="text-[10px] font-bold text-slate-500">{(propertyRedoStack[selectedShapeId] || []).length}</span>
                  )}
                </button>

                <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

                <button 
                  onClick={() => setSelectedShapeId(null)} 
                  className="text-slate-400 hover:text-slate-650 hover:bg-slate-100 p-1 rounded-full transition-all cursor-pointer"
                  title="关闭属性编辑器"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 基本标签和信息 */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">组件类型</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-650 rounded text-[10px] font-bold uppercase tracking-wider">
                    {selectedEl.type}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">组件标识</span>
                  <span className="font-mono text-slate-500 text-[10px] truncate max-w-[155px]" title={selectedEl.id}>
                    {selectedEl.id}
                  </span>
                </div>
              </div>

              {/* 通用属性: X, Y 坐标及宽高 */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                  物理定位 & 尺寸
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">X 坐标</label>
                    <input 
                      type="number"
                      value={Math.round(editingProperties.x ?? 0)}
                      onChange={(e) => handleLocalPropChange('x', parseFloat(e.target.value) || 0)}
                      onBlur={(e) => handleNumericPropBlur('x', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">Y 坐标</label>
                    <input 
                      type="number"
                      value={Math.round(editingProperties.y ?? 0)}
                      onChange={(e) => handleLocalPropChange('y', parseFloat(e.target.value) || 0)}
                      onBlur={(e) => handleNumericPropBlur('y', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {selectedEl.type !== 'pen' && selectedEl.type !== 'circle' && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">宽度 (Width)</label>
                      <input 
                        type="number"
                        min="50"
                        value={Math.round(editingProperties.width ?? 300)}
                        onChange={(e) => handleLocalPropChange('width', parseFloat(e.target.value) || 50)}
                        onBlur={(e) => handleNumericPropBlur('width', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">高度 (Height)</label>
                      <input 
                        type="number"
                        min="50"
                        value={Math.round(editingProperties.height ?? 300)}
                        onChange={(e) => handleLocalPropChange('height', parseFloat(e.target.value) || 50)}
                        onBlur={(e) => handleNumericPropBlur('height', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {selectedEl.type === 'circle' && (
                  <div className="mt-2">
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">半径 (Radius)</label>
                    <input 
                      type="number"
                      min="5"
                      value={Math.round(editingProperties.radius ?? 50)}
                      onChange={(e) => handleLocalPropChange('radius', parseFloat(e.target.value) || 5)}
                      onBlur={(e) => handleNumericPropBlur('radius', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* 1. QUIZ (测验配置) */}
              {selectedEl.type === 'quiz' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    随堂测验配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">测验题目 (Question)</label>
                    <textarea
                      value={editingProperties.question || ''}
                      onChange={(e) => handleLocalPropChange('question', e.target.value)}
                      onBlur={(e) => handlePropBlur('question', e.target.value)}
                      className="w-full h-20 p-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                      placeholder="编写问题描述..."
                    />
                  </div>

                  {/* Correct answer selector */}
                  {(editingProperties.options || []).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <label className="block text-[10px] text-amber-700 font-bold mb-1.5">
                        ⚠️ 正确答案 (Correct Answer)
                      </label>
                      <select
                        value={editingProperties.correctAnswer || ''}
                        onChange={(e) => {
                          handleLocalPropChange('correctAnswer', e.target.value);
                          handlePropBlur('correctAnswer', e.target.value);
                        }}
                        className={`w-full px-2 py-1.5 border rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer ${
                          editingProperties.correctAnswer
                            ? 'border-green-300 bg-green-50 text-green-800'
                            : 'border-amber-300 bg-white text-amber-800'
                        }`}
                      >
                        <option value="">-- 请选择正确答案 --</option>
                        {(editingProperties.options || []).map((opt: string, idx: number) => (
                          <option key={idx} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {!editingProperties.correctAnswer && (
                        <p className="text-[9px] text-amber-600 mt-1">未设置正确答案将无法自动判分</p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-[10px] text-slate-400 font-semibold">
                      选项列表 (Options)
                    </label>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {(editingProperties.options || []).map((opt: string, idx: number) => {
                        const optionLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                        const label = optionLabels[idx] || (idx + 1);
                        return (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-700 bg-slate-100 rounded px-1.5 py-1 text-center shrink-0 min-w-[22px]">
                              {label}
                            </span>
                            <input 
                              type="text"
                              value={opt || ''}
                              onChange={(e) => handleOptionChangeLocal(idx, e.target.value)}
                              onBlur={(e) => handleOptionBlur(idx, e.target.value)}
                              className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-xs font-medium"
                            />
                            <button
                              onClick={() => handleRemoveOption(idx)}
                              title="删除选项"
                              className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-md shrink-0 transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    
                    <button
                      onClick={handleAddOption}
                      className="w-full mt-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold border border-slate-200/80 rounded-lg flex items-center justify-center gap-1 hover:text-slate-700 transition-all text-[11px] cursor-pointer"
                    >
                      <Plus size={12} /> 添加选项
                    </button>
                  </div>
                </div>
              )}

              {/* 2. ASSIGNMENT (作业配置) */}
              {selectedEl.type === 'assignment' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    作业选项配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">作业任务标题 (Title)</label>
                    <input 
                      type="text"
                      value={editingProperties.title || ''}
                      onChange={(e) => handleLocalPropChange('title', e.target.value)}
                      onBlur={(e) => handlePropBlur('title', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="作业名..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">详细作业要求描述</label>
                    <textarea
                      value={editingProperties.description || ''}
                      onChange={(e) => handleLocalPropChange('description', e.target.value)}
                      onBlur={(e) => handlePropBlur('description', e.target.value)}
                      className="w-full h-24 p-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                      placeholder="请输入详细的作业指南..."
                    />
                  </div>
                </div>
              )}

              {/* 3. CODE SANDBOX 和 HTML APPLET 和 Sandbox */}
              {(selectedEl.type === 'code-sandbox' || selectedEl.type === 'html-applet') && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5 flex justify-between items-center">
                    <span>动态运行代码定制</span>
                    {selectedEl.type === 'html-applet' && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold">HTML Applet</span>
                    )}
                  </h4>

                  {selectedEl.type === 'html-applet' && (
                    <div className="space-y-3 border-b border-slate-100 pb-3">
                      <div>
                        <label className="block text-[10px] text-indigo-600 font-bold mb-1">选择 AI 互动课件 (ZIP/HTML):</label>
                        <select
                          value={editingProperties.coursewareUuid || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handlePropsUpdate({ coursewareUuid: val, resourceId: '' });
                          }}
                          className="w-full text-xs p-2 bg-slate-50 border border-indigo-200 hover:border-indigo-300 rounded-lg text-slate-750 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-semibold"
                        >
                          <option value="">-- 使用系统资源或自定义代码 --</option>
                          {coursewares.map(c => (
                            <option key={c.id} value={c.uuid}>
                              📁 [互动课件] {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">选择已有的系统资源:</label>
                        <select
                          value={editingProperties.resourceId || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handlePropsUpdate({ resourceId: val, coursewareUuid: '' });
                          }}
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-slate-750 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-semibold"
                        >
                          <option value="">-- 使用互动课件或自定义代码 --</option>
                          {systemResources.map(r => (
                            <option key={r.id} value={r.id}>
                              [{r.type === 'folder' ? '文件夹' : '单HTML'}] {r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px] text-slate-500 space-y-2">
                        <span className="font-bold text-slate-600 block">上传资源 (会自动保存到对应库):</span>
                        <div className="grid grid-cols-2 gap-2">
                          {/* Courseware ZIP/HTML Upload */}
                          <label className="col-span-2 flex flex-col items-center justify-center p-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-indigo-700 text-[10px]">✨ 上传 AI 互动课件 (.zip/.html)</span>
                            <input
                              type="file"
                              accept=".zip,.html,.htm"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const result = event.target?.result as string;
                                  try {
                                    const res = await fetch('/api/courseware/upload', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        name: file.name.replace(/\.[^/.]+$/, ""),
                                        filename: file.name,
                                        base64Data: result
                                      })
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      if (data.need_select_entry) {
                                        setZipCandidates(data.candidates);
                                        setZipUploadInfo({ uuid: data.uuid, name: data.name });
                                        setShowEntrySelector(true);
                                      } else {
                                        handlePropsUpdate({ coursewareUuid: data.uuid, resourceId: '' });
                                        
                                        fetchCoursewares();
                                      }
                                    } else {
                                      const errData = await res.json();
                                      alert("上传失败: " + (errData.error || res.statusText));
                                    }
                                  } catch (err) {
                                    console.error('Courseware upload failed:', err);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                          </label>

                          {/* Single HTML File Upload */}
                          <label className="flex flex-col items-center justify-center p-2 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-slate-600 text-[10px]">📄 上传系统HTML文件</span>
                            <input
                              type="file"
                              accept=".html,.htm"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const text = event.target?.result as string;
                                  try {
                                    const res = await fetch('/api/resources', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        name: file.name,
                                        type: 'html',
                                        content: text
                                      })
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      handlePropsUpdate({ resourceId: data.id, coursewareUuid: '' });
                                      fetchSystemResources();
                                    }
                                  } catch (err) {
                                    console.error('Upload failed:', err);
                                  }
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>

                          {/* Folder Upload */}
                          <label className="flex flex-col items-center justify-center p-2 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-slate-600 text-[10px]">📁 上传系统文件夹</span>
                            <input
                              type="file"
                              {...{
                                webkitdirectory: "",
                                directory: "",
                              } as any}
                              multiple
                              className="hidden"
                              onChange={async (e) => {
                                const files = e.target.files;
                                if (!files || files.length === 0) return;
                                
                                const filesToUpload: { path: string; content: string }[] = [];
                                let folderName = '';
                                
                                for (let i = 0; i < files.length; i++) {
                                  const file = files[i];
                                  const relPath = file.webkitRelativePath || file.name;
                                  if (!folderName) {
                                    folderName = relPath.split('/')[0] || 'uploaded_resource';
                                  }
                                  
                                  const ext = file.name.split('.').pop()?.toLowerCase();
                                  const isBinary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext || '');
                                  
                                  await new Promise<void>((resolve) => {
                                    const reader = new FileReader();
                                    reader.onload = (evt) => {
                                      const content = evt.target?.result as string;
                                      filesToUpload.push({
                                        path: relPath,
                                        content: content
                                      });
                                      resolve();
                                    };
                                    if (isBinary) {
                                      reader.readAsDataURL(file);
                                    } else {
                                      reader.readAsText(file);
                                    }
                                  });
                                }

                                try {
                                  const res = await fetch('/api/resources', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      name: folderName,
                                      type: 'folder',
                                      content: JSON.stringify(filesToUpload)
                                    })
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    handlePropsUpdate({ resourceId: data.id, coursewareUuid: '' });
                                    fetchSystemResources();
                                  }
                                } catch (err) {
                                  console.error('Folder upload failed:', err);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {(!editingProperties.resourceId && !editingProperties.coursewareUuid || selectedEl.type === 'code-sandbox') && (
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">沙箱程序代码 (Source Code)</label>
                      <textarea
                        value={editingProperties.code || ''}
                        onChange={(e) => handleLocalPropChange('code', e.target.value)}
                        onBlur={(e) => handlePropBlur('code', e.target.value)}
                        className="w-full h-48 p-3 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-900 text-slate-100 resize-none leading-relaxed"
                        placeholder="// 编写交互沙箱代码..."
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 4. MATH GRAPH */}
              {selectedEl.type === 'math-graph' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    函数解析拟合
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">
                      函数表达式 y = f(x)
                    </label>
                    <input 
                      type="text"
                      value={editingProperties.equation || ''}
                      onChange={(e) => handleLocalPropChange('equation', e.target.value)}
                      onBlur={(e) => handlePropBlur('equation', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-100"
                    />
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      支持标准 JS 表达式。 示例：<br />
                      • <code className="bg-slate-100 px-1 rounded">Math.sin(x)</code> 正负弦波形<br />
                      • <code className="bg-slate-100 px-1 rounded">Math.cos(x) * x</code> 振幅衰减
                    </p>
                  </div>
                </div>
              )}

              {/* 5. PRESENTATION */}
              {selectedEl.type === 'presentation' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    幻灯片 Markdown 文案
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">Markdown 源代码</label>
                    <textarea
                      value={editingProperties.markdown || ''}
                      onChange={(e) => handleLocalPropChange('markdown', e.target.value)}
                      onBlur={(e) => handlePropBlur('markdown', e.target.value)}
                      className="w-full h-64 p-2.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-100 resize-none font-medium leading-relaxed bg-slate-50"
                      placeholder="修改 Markdown 内容..."
                    />
                  </div>
                </div>
              )}

              {/* 6. TEXT (文字颜色样式) */}
              {selectedEl.type === 'text' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    文字属性管理
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文本内容</label>
                    <input 
                      type="text"
                      value={editingProperties.text || ''}
                      onChange={(e) => handleLocalPropChange('text', e.target.value)}
                      onBlur={(e) => handlePropBlur('text', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文字大小 (FontSize)</label>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      value={editingProperties.fontSize || 16}
                      onChange={(e) => handleLocalPropChange('fontSize', parseInt(e.target.value) || 10)}
                      onBlur={(e) => handleNumericPropBlur('fontSize', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文字填充颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#000000'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 7. RECTANGLE 和 SHAPE */}
              {(selectedEl.type === 'rectangle' || selectedEl.type === 'shape') && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    矩形样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">外边框颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.stroke || '#000000'}
                        onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                        onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.stroke || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 8. CIRCLE */}
              {selectedEl.type === 'circle' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    圆形样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">外边框颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.stroke || '#000000'}
                        onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                        onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.stroke || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 9. PEN */}
              {selectedEl.type === 'pen' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    线条样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">折线颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#000000'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 10. HIGHLIGHTER */}
              {selectedEl.type === 'highlighter' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    高亮荧光标记 (Highlighter)
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">荧光笔颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#facc15'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#facc15'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 text-center select-none pt-2 font-medium">
                提示：属性在失焦或修改时自动同步，多端可见。
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div className="p-3 border-t border-slate-200 bg-white flex flex-col gap-2 shrink-0">
              <button
                onClick={() => handleUpdateElementData(editingProperties)}
                disabled={isSyncing}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-all shadow-sm hover:shadow active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 text-xs"
              >
                {isSyncing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    正在广播同步...
                  </>
                ) : (
                  <>
                    <Paintbrush size={13} />
                    应用修改并强制同步
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  handleElementDelete(selectedShapeId);
                  setSelectedShapeId(null);
                }}
                className="w-full py-2 bg-red-50 hover:bg-red-105 text-red-650 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 border border-red-200 cursor-pointer text-xs"
              >
                <Trash2 size={13} />
                删除当前组件
              </button>
            </div>
          </div>
       );
    })()}

  </div>
  );
});

