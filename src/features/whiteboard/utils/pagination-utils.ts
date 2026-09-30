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
export function belongsToPage(
  el: WhiteboardElementLike,
  targetPage: number,
  pages: WhiteboardPageItem[],
): boolean {
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
 * 过滤出当前页 + 当前环节 (activeSegmentId) 下应渲染的画布元素
 * 保证跨环节元素隔离（MUT-M6 的直接防线）
 */
export function filterCurrentPageElements<T extends WhiteboardElementLike>(
  elements: T[],
  currentPage: number,
  pages: WhiteboardPageItem[],
  activeSegmentId?: string | null,
): T[] {
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
): { newPages: WhiteboardPageItem[]; newIndex: number; newPage: WhiteboardPageItem } {
  const nextIdx = pages.length;
  const newPage: WhiteboardPageItem = {
    id: `page-${now}-${nextIdx}`,
    title: customTitle || `P${nextIdx + 1} · 备课页面`,
    order: nextIdx,
  };
  const newPages = [...pages, newPage];
  return { newPages, newIndex: nextIdx, newPage };
}

/**
 * 重命名页面
 */
export function renamePageItem(
  pages: WhiteboardPageItem[],
  idx: number,
  newTitle: string,
): WhiteboardPageItem[] {
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
