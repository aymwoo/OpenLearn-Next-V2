import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { parseElementData } from '../utils/element-cache';
import {
  belongsToPage,
  filterCurrentPageElements,
  createPageItem,
  renamePageItem,
  duplicatePageItem,
  movePageItem,
  type WhiteboardPageItem,
  DEFAULT_WHITEBOARD_PAGES,
} from '../utils/pagination-utils';

export interface WhiteboardElementLike {
  id: string;
  type: string;
  data: string;
}

export interface UseWhiteboardPagesOptions<T extends WhiteboardElementLike> {
  elements: T[];
  safeElements: T[];
  initialPage?: number;
  activeSegmentId?: string | null;
  lessonId: string;
  userRole?: 'teacher' | 'student';
  socketRef: React.MutableRefObject<{ emit?: (event: string, ...args: unknown[]) => void } | null | undefined>;
  onElementAdd?: (type: string, data: Record<string, unknown>) => Promise<unknown> | void;
  onElementUpdate?: (elementId: string, data: Record<string, unknown>) => Promise<unknown> | void;
  onElementDelete?: (elementId: string) => Promise<unknown> | void;
  onPagesStateChange?: (state: { pages: WhiteboardPageItem[]; currentPage: number }) => void;
  setDialog: (
    dialog: {
      title: string;
      message: string;
      type: 'alert' | 'confirm';
      onConfirm: () => void;
    } | null,
  ) => void;
}

export function useWhiteboardPages<T extends WhiteboardElementLike>({
  elements,
  safeElements,
  initialPage,
  activeSegmentId,
  lessonId,
  userRole,
  socketRef,
  onElementAdd,
  onElementUpdate,
  onElementDelete,
  onPagesStateChange,
  setDialog,
}: UseWhiteboardPagesOptions<T>) {
  const [pages, setPages] = useState<WhiteboardPageItem[]>(() => {
    const metaEl = (Array.isArray(elements) ? elements : []).find((el) => el.type === 'page_meta');
    if (metaEl) {
      const parsed = parseElementData(metaEl);
      if (Array.isArray(parsed?.pages) && parsed.pages.length > 0) {
        return parsed.pages;
      }
    }
    return DEFAULT_WHITEBOARD_PAGES;
  });

  const [currentPage, setCurrentPage] = useState<number>(() => {
    const target = Number(initialPage);
    if (Number.isFinite(target) && target >= 0) {
      return target;
    }
    if (activeSegmentId) {
      const metaEl = (Array.isArray(elements) ? elements : []).find((el) => el.type === 'page_meta');
      const parsed = metaEl ? parseElementData(metaEl) : null;
      const candidatePages =
        Array.isArray(parsed?.pages) && parsed.pages.length > 0 ? parsed.pages : DEFAULT_WHITEBOARD_PAGES;
      const targetIdx = candidatePages.findIndex((p: WhiteboardPageItem) => p.segmentId === activeSegmentId);
      if (targetIdx !== -1) {
        return targetIdx;
      }
    }
    return 0;
  });

  const [showPageDrawer, setShowPageDrawer] = useState(false);
  const [editingPageIdx, setEditingPageIdx] = useState<number | null>(null);
  const [editingPageTitle, setEditingPageTitle] = useState('');
  const [activeMenuPageIdx, setActiveMenuPageIdx] = useState<number | null>(null);

  // 同步给外部监听者（如备课组件边栏的大纲）
  const lastReportedPagesStateRef = useRef<{ pages: WhiteboardPageItem[]; currentPage: number } | null>(null);
  useEffect(() => {
    if (
      lastReportedPagesStateRef.current?.currentPage === currentPage &&
      lastReportedPagesStateRef.current?.pages === pages
    ) {
      return;
    }
    lastReportedPagesStateRef.current = { pages, currentPage };
    onPagesStateChange?.({ pages, currentPage });
  }, [pages, currentPage, onPagesStateChange]);

  // Sync pages config from safeElements (type === 'page_meta')
  useEffect(() => {
    const metaEl = safeElements.find((el) => el.type === 'page_meta');
    if (metaEl) {
      const parsed = parseElementData(metaEl);
      if (Array.isArray(parsed?.pages) && parsed.pages.length > 0) {
        setPages(parsed.pages);
      }
    }
  }, [safeElements]);

  // 会话恢复：若 initialPage 为异步拉取（初始为 undefined），在恢复值到达后只跳转一次
  const initialPageAppliedRef = useRef(Number.isFinite(Number(initialPage)) && Number(initialPage) >= 0);
  useEffect(() => {
    if (initialPageAppliedRef.current) return;
    if (!Array.isArray(pages) || pages.length === 0) return;
    if (initialPage === undefined || initialPage === null) return;
    const target = Number(initialPage);
    if (Number.isFinite(target) && target > 0 && target < pages.length) {
      setCurrentPage(target);
    }
    initialPageAppliedRef.current = true;
  }, [pages, initialPage]);

  const belongsToCurrentPage = useCallback(
    (el: WhiteboardElementLike): boolean => belongsToPage(el, currentPage, pages),
    [pages, currentPage],
  );

  /** 当前页 + 当前环节下应渲染的元素（画布渲染用） */
  const currentPageElements = useMemo(
    (): T[] => filterCurrentPageElements(safeElements, currentPage, pages, activeSegmentId) as T[],
    [safeElements, currentPage, pages, activeSegmentId],
  );
  const getCurrentPageElements = useCallback((): T[] => currentPageElements, [currentPageElements]);

  // 会话保存：教师切页时防抖回写（课堂会话恢复用）。学生端不发（视图跟随广播）。
  const viewStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedPageRef = useRef<number | null>(null);

  useEffect(() => {
    lastPersistedPageRef.current = null;
    return () => {
      if (viewStateTimerRef.current) {
        clearTimeout(viewStateTimerRef.current);
        viewStateTimerRef.current = null;
      }
    };
  }, [lessonId]);

  const persistPageChange = useCallback(
    (page: number) => {
      if (userRole !== 'teacher' || !lessonId) return;
      if (lastPersistedPageRef.current === page) return;
      if (viewStateTimerRef.current) clearTimeout(viewStateTimerRef.current);
      viewStateTimerRef.current = setTimeout(() => {
        fetch(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/view-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPage: page }),
        })
          .then((res) => {
            if (res.ok) {
              lastPersistedPageRef.current = page;
            } else if (res.status === 429) {
              console.warn('[InteractiveWhiteboard] view-state rate-limited (HTTP 429), skipping transient update.');
            }
          })
          .catch(() => {});
      }, 500);
    },
    [userRole, lessonId],
  );

  const savePagesConfig = useCallback(
    (newPages: WhiteboardPageItem[]) => {
      const metaEl = safeElements.find((el) => el.type === 'page_meta');
      if (metaEl && onElementUpdate) {
        onElementUpdate(metaEl.id, { pages: newPages });
      } else if (onElementAdd) {
        onElementAdd('page_meta', { pages: newPages });
      }
      if (socketRef.current?.emit) {
        socketRef.current.emit('whiteboard-update', {
          roomId: lessonId,
          type: 'page-meta-update',
          payload: { pages: newPages },
        });
      }
    },
    [safeElements, onElementUpdate, onElementAdd, socketRef, lessonId],
  );

  const programmaticPageSwitchRef = useRef(false);
  const handleSwitchPage = useCallback(
    (idx: number) => {
      programmaticPageSwitchRef.current = true;
      setCurrentPage(idx);
      setActiveMenuPageIdx(null);
      if (socketRef.current?.emit) {
        socketRef.current.emit('whiteboard-update', {
          roomId: lessonId,
          type: 'page-change',
          payload: { page: idx },
        });
      }
      // 会话保存：防抖回写当前页（教师离开后重进可恢复）
      persistPageChange(idx);
    },
    [socketRef, lessonId, persistPageChange],
  );

  const handleAddPage = useCallback(
    (customTitle?: string) => {
      const { newPages, newIndex } = createPageItem(pages, customTitle, Date.now(), activeSegmentId);
      setPages(newPages);
      setCurrentPage(newIndex);
      savePagesConfig(newPages);
      if (socketRef.current?.emit) {
        socketRef.current.emit('whiteboard-update', {
          roomId: lessonId,
          type: 'page-change',
          payload: { page: newIndex },
        });
      }
    },
    [pages, activeSegmentId, savePagesConfig, socketRef, lessonId],
  );

  const handleRenamePage = useCallback(
    (idx: number, newTitle: string) => {
      if (!newTitle.trim()) {
        setEditingPageIdx(null);
        return;
      }
      const nextPages = renamePageItem(pages, idx, newTitle);
      setPages(nextPages);
      savePagesConfig(nextPages);
      setEditingPageIdx(null);
      setEditingPageTitle('');
    },
    [pages, savePagesConfig],
  );

  const handleDuplicatePage = useCallback(
    (idx: number) => {
      const targetPage = pages[idx];
      if (!targetPage) return;
      const dupResult = duplicatePageItem(pages, idx);
      if (!dupResult) return;
      const { newPages, newIndex, newPage } = dupResult;

      setPages(newPages);
      setCurrentPage(newIndex);
      savePagesConfig(newPages);

      const pageElements = safeElements.filter(
        (el) =>
          el.type !== 'page_meta' &&
          (() => {
            try {
              const d = JSON.parse(el.data);
              return (d.page ?? 0) === idx || d.pageId === targetPage.id;
            } catch {
              return idx === 0;
            }
          })(),
      );

      pageElements.forEach((el) => {
        try {
          const d = JSON.parse(el.data);
          if (onElementAdd) {
            onElementAdd(el.type, {
              ...d,
              page: newIndex,
              pageId: newPage.id,
              x: (d.x ?? 100) + 20,
              y: (d.y ?? 100) + 20,
            });
          }
        } catch (e) {
          console.error('Failed duplicating page element:', e);
        }
      });
    },
    [pages, savePagesConfig, safeElements, onElementAdd],
  );

  const handleDeletePage = useCallback(
    (idx: number) => {
      if (pages.length <= 1) {
        setDialog({ title: '无法删除', message: '至少需要保留一个白板页面！', type: 'alert', onConfirm: () => {} });
        return;
      }

      const pageToDelete = pages[idx];
      const pageElements = safeElements.filter(
        (el) =>
          el.type !== 'page_meta' &&
          (() => {
            try {
              const d = JSON.parse(el.data);
              return (d.page ?? 0) === idx || d.pageId === pageToDelete.id;
            } catch {
              return idx === 0;
            }
          })(),
      );

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
    },
    [pages, safeElements, onElementDelete, currentPage, savePagesConfig, setDialog],
  );

  const handleMovePage = useCallback(
    (idx: number, direction: 'left' | 'right') => {
      const moveResult = movePageItem(pages, idx, direction);
      if (!moveResult) return;
      const { newPages, targetIndex } = moveResult;
      setPages(newPages);

      if (currentPage === idx) {
        setCurrentPage(targetIndex);
      } else if (currentPage === targetIndex) {
        setCurrentPage(idx);
      }
      savePagesConfig(newPages);
    },
    [pages, currentPage, savePagesConfig],
  );

  return {
    pages,
    setPages,
    currentPage,
    setCurrentPage,
    showPageDrawer,
    setShowPageDrawer,
    editingPageIdx,
    setEditingPageIdx,
    editingPageTitle,
    setEditingPageTitle,
    activeMenuPageIdx,
    setActiveMenuPageIdx,
    belongsToCurrentPage,
    currentPageElements,
    getCurrentPageElements,
    persistPageChange,
    savePagesConfig,
    handleSwitchPage,
    handleAddPage,
    handleRenamePage,
    handleDuplicatePage,
    handleDeletePage,
    handleMovePage,
    programmaticPageSwitchRef,
  };
}
