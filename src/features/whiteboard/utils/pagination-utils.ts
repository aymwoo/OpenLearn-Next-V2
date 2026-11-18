/**
 * 白板分页与元素过滤纯逻辑工具函数
 *
 * 从 InteractiveWhiteboard.tsx 抽取，提供可测试、无副作用的纯计算逻辑，
 * 消除测试体自证式重复代码，确保环节（segment）隔离与切页逻辑被严格覆盖。
 */

export interface WhiteboardPageItem {
  id: string;
  title: string;
  order: number;
  segmentId?: string | null;
  /**
   * 无 segmentId 的共享页在这些环节的大纲中隐藏。
   * 教师在某一环节删除共享页时只写入当前环节，不从 page_meta 摘掉这条记录，
   * 避免其它环节因共用全局下标而一起丢页。
   */
  excludedSegmentIds?: string[];
}

export const DEFAULT_WHITEBOARD_PAGES: WhiteboardPageItem[] = [
  { id: 'page-0', title: 'P1 · 引入导入', order: 0 },
  { id: 'page-1', title: 'P2 · 核心讲解', order: 1 },
  { id: 'page-2', title: 'P3 · 互动练习', order: 2 },
];

export interface WhiteboardElementLike {
  id: string;
  type: string;
  data: string;
}

/**
 * 判断元素是否属于指定页面
 */
export function belongsToPage(el: WhiteboardElementLike, targetPage: number, pages: WhiteboardPageItem[]): boolean {
  if (el.type === 'page_meta') return false;
  try {
    const data = JSON.parse(el.data);
    const elPage = data.page ?? 0;
    const currentObj = pages[targetPage];
    return data.pageId && currentObj?.id ? data.pageId === currentObj.id : elPage === targetPage;
  } catch {
    return targetPage === 0;
  }
}

/**
 * 当前环节是否应展示这一页。
 * 未指定环节时展示全部；指定环节时展示本环节页，以及尚未从本环节隐藏的共享页（无 segmentId）。
 */
export function isPageVisibleInSegment(page: WhiteboardPageItem, activeSegmentId?: string | null): boolean {
  if (!activeSegmentId) return true;
  if (page.excludedSegmentIds?.includes(activeSegmentId)) return false;
  return !page.segmentId || page.segmentId === activeSegmentId;
}

/**
 * 过滤出当前活跃教学环节 (activeSegmentId) 应展示的页面列表
 * 若未指定 activeSegmentId，返回全量 pages；
 * 若指定 activeSegmentId，返回未绑定环节（通用页）或 segmentId 等于 activeSegmentId 的页面。
 */
export function getSegmentVisiblePages(
  pages: WhiteboardPageItem[],
  activeSegmentId?: string | null,
): WhiteboardPageItem[] {
  if (!activeSegmentId) return pages;
  return pages.filter((p) => isPageVisibleInSegment(p, activeSegmentId));
}

/**
 * 过滤出当前页 + 当前环节 (activeSegmentId) 下应渲染的画布元素
 * 保证跨环节元素隔离（MUT-M6 的直接防线）
 */
export function filterCurrentPageElements<T extends WhiteboardElementLike>(
  elements: T[],
  currentPage: number,
  pages: WhiteboardPageItem[],
  activeSegmentId?: string | null,
): T[] {
  const currentPageObj = pages[currentPage];
  if (activeSegmentId && currentPageObj && !isPageVisibleInSegment(currentPageObj, activeSegmentId)) {
    return [];
  }
  return elements.filter((el) => {
    if (!belongsToPage(el, currentPage, pages)) return false;
    try {
      const data = JSON.parse(el.data);
      if (activeSegmentId && data.segmentId && data.segmentId !== activeSegmentId) return false;
      return true;
    } catch {
      return currentPage === 0;
    }
  });
}

/**
 * 创建新页面数据并返回新页面列表和新页面索引
 * 确保新建后切页到末尾（MUT-M1 的直接防线）
 */
export function createPageItem(
  pages: WhiteboardPageItem[],
  customTitle?: string,
  now = Date.now(),
  segmentId?: string | null,
): { newPages: WhiteboardPageItem[]; newIndex: number; newPage: WhiteboardPageItem } {
  const nextIdx = pages.length;
  const newPage: WhiteboardPageItem = {
    id: `page-${now}-${nextIdx}`,
    title: customTitle || `P${nextIdx + 1} · 备课页面`,
    order: nextIdx,
    ...(segmentId ? { segmentId } : {}),
  };
  const newPages = [...pages, newPage];
  return { newPages, newIndex: nextIdx, newPage };
}

/**
 * 重命名页面
 */
export function renamePageItem(pages: WhiteboardPageItem[], idx: number, newTitle: string): WhiteboardPageItem[] {
  const trimmed = newTitle.trim();
  if (!trimmed) return pages;
  return pages.map((p, i) => (i === idx ? { ...p, title: trimmed } : p));
}

/**
 * 复制指定页面
 */
export function duplicatePageItem(
  pages: WhiteboardPageItem[],
  idx: number,
  now = Date.now(),
): { newPages: WhiteboardPageItem[]; newIndex: number; newPage: WhiteboardPageItem } | null {
  const targetPage = pages[idx];
  if (!targetPage) return null;
  const newIdx = idx + 1;
  const newPage: WhiteboardPageItem = {
    id: `page-${now}-${newIdx}`,
    title: `${targetPage.title} (副本)`,
    order: newIdx,
    ...(targetPage.segmentId ? { segmentId: targetPage.segmentId } : {}),
  };
  const newPages = [
    ...pages.slice(0, newIdx),
    newPage,
    ...pages.slice(newIdx).map((p) => ({ ...p, order: p.order + 1 })),
  ];
  return { newPages, newIndex: newIdx, newPage };
}

/**
 * 移动页面（向左或向右）
 */
export function movePageItem(
  pages: WhiteboardPageItem[],
  idx: number,
  direction: 'left' | 'right',
): { newPages: WhiteboardPageItem[]; targetIndex: number } | null {
  const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= pages.length) return null;

  const nextPages = [...pages];
  const item = nextPages[idx];
  nextPages[idx] = nextPages[targetIdx];
  nextPages[targetIdx] = item;

  nextPages.forEach((p, i) => {
    p.order = i;
  });

  return { newPages: nextPages, targetIndex: targetIdx };
}

export type SegmentPageDeleteAction = 'remove' | 'exclude' | 'refuse';

export interface SegmentPageDeletePlan {
  action: SegmentPageDeleteAction;
  nextPages: WhiteboardPageItem[];
  /** 被移除或从当前环节隐藏的那一页；拒绝时为 null */
  targetPage: WhiteboardPageItem | null;
  targetIndex: number;
  reason?: 'missing' | 'other-segment' | 'last-page' | 'already-excluded';
}

/**
 * 规划「删除当前环节的一页」。
 *
 * 页面身份是 `pages[].id`（以及可选的 segmentId），不是全局下标。
 * - 已绑定其它环节：拒绝，避免下标串页。
 * - 已绑定当前环节：只从 page_meta 摘掉这一条。
 * - 无 segmentId 的共享页：在当前环节写入 excludedSegmentIds，记录仍留给其它环节。
 *   直接 splice 会挪动后续下标，其它环节大纲里的「第 N 页」会跟着消失。
 * - 未指定环节：保持旧行为，按这一条记录从全局列表删除。
 */
export function planDeleteSegmentPage(
  pages: readonly WhiteboardPageItem[],
  pageIndex: number,
  activeSegmentId?: string | null,
): SegmentPageDeletePlan {
  const targetPage = pages[pageIndex];
  if (!targetPage) {
    return { action: 'refuse', nextPages: [...pages], targetPage: null, targetIndex: pageIndex, reason: 'missing' };
  }
  if (activeSegmentId && targetPage.segmentId && targetPage.segmentId !== activeSegmentId) {
    return {
      action: 'refuse',
      nextPages: [...pages],
      targetPage: null,
      targetIndex: pageIndex,
      reason: 'other-segment',
    };
  }

  const sharedPage = !targetPage.segmentId;
  if (activeSegmentId && sharedPage) {
    const excluded = [...(targetPage.excludedSegmentIds ?? [])];
    if (excluded.includes(activeSegmentId)) {
      return {
        action: 'refuse',
        nextPages: [...pages],
        targetPage: null,
        targetIndex: pageIndex,
        reason: 'already-excluded',
      };
    }
    excluded.push(activeSegmentId);
    const nextPages = pages.map((page, index) =>
      index === pageIndex ? { ...page, excludedSegmentIds: excluded } : page,
    );
    return { action: 'exclude', nextPages, targetPage, targetIndex: pageIndex };
  }

  if (pages.length <= 1) {
    return {
      action: 'refuse',
      nextPages: [...pages],
      targetPage: null,
      targetIndex: pageIndex,
      reason: 'last-page',
    };
  }

  const nextPages = pages.filter((page) => page.id !== targetPage.id).map((page, index) => ({ ...page, order: index }));
  return { action: 'remove', nextPages, targetPage, targetIndex: pageIndex };
}

function readElementPageFields(raw: string): {
  corrupt: boolean;
  segmentId: string | null;
  pageId?: string;
  page: number;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { corrupt: true, segmentId: null, page: 0 };
    }
    const data = parsed as Record<string, unknown>;
    return {
      corrupt: false,
      segmentId: typeof data.segmentId === 'string' ? data.segmentId : null,
      pageId: typeof data.pageId === 'string' ? data.pageId : undefined,
      page: typeof data.page === 'number' ? data.page : 0,
    };
  } catch {
    return { corrupt: true, segmentId: null, page: 0 };
  }
}

/**
 * 选出真正属于这一页、且属于本次删除范围的元素。
 *
 * 有 pageId 时只认页面 id，不再用全局下标把其它环节的「第 N 页」一起选中。
 * exclude（隐藏共享页）只清理当前环节自己的元素，无 segmentId 的共享内容留给仍在展示该页的环节。
 */
export function selectElementsOnPage<T extends WhiteboardElementLike>(
  elements: readonly T[],
  page: WhiteboardPageItem,
  pageIndex: number,
  options: { activeSegmentId?: string | null; mode: 'remove' | 'exclude' },
): T[] {
  const { activeSegmentId, mode } = options;
  return elements.filter((el) => {
    if (el.type === 'page_meta') return false;
    const fields = readElementPageFields(el.data);
    if (fields.corrupt) {
      return mode === 'remove' && pageIndex === 0 && !activeSegmentId;
    }
    if (mode === 'exclude') {
      if (!activeSegmentId || fields.segmentId !== activeSegmentId) return false;
    } else if (activeSegmentId && fields.segmentId && fields.segmentId !== activeSegmentId) {
      return false;
    }
    if (fields.pageId && page.id) return fields.pageId === page.id;
    return fields.page === pageIndex;
  });
}
