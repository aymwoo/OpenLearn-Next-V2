/**
 * 白板页 → 环节归属纯函数（课中大纲与备课共用）。
 *
 * 归属规则（与编辑器 `LessonPalette` 的页面大纲一致）：
 * 1. 环节声明了 `targetPages`（课程大纲 / AI 生成教案写入）时，按该下标列表取页；
 * 2. 否则共享页（无 `segmentId`）在每个环节都可见，`segmentId` 绑定页只在本环节可见；
 * 3. `excludedSegmentIds` 命中的页在该环节隐藏。
 *
 * 旧实现在「页面无任何环节绑定」时会按索引 1:1 分给各环节（甚至在页数等于环节数时
 * 每环节只留一页），与编辑器里看到的所有页面不一致 —— 课中每个环节因此只剩一页。
 */
export type OutlinePageLike = {
  id?: string;
  title?: string;
  segmentId?: string | null;
  excludedSegmentIds?: readonly string[] | null;
};

export type OutlineSegmentLike = {
  id: string;
  /** 本环节对应的白板页下标；为空时按共享页 / segmentId 规则归属。 */
  targetPages?: readonly number[] | null;
};

export type SegmentPageMatch<T extends OutlinePageLike = OutlinePageLike> = {
  page: T;
  globalIdx: number;
};

export function getPagesForSegment<T extends OutlinePageLike>(
  seg: OutlineSegmentLike,
  _segIdx: number,
  whiteboardPages: readonly T[],
  _timelineSegments: readonly OutlineSegmentLike[],
): SegmentPageMatch<T>[] {
  const targetPages = Array.isArray(seg.targetPages) ? seg.targetPages : null;
  if (targetPages && targetPages.length > 0) {
    return targetPages.flatMap((globalIdx) => {
      const page = whiteboardPages[globalIdx];
      if (!page) return [];
      // 与画布渲染的可见性规则保持一致：绑定到其它环节的页或已隐藏的页不展示。
      if (page.segmentId && page.segmentId !== seg.id) return [];
      if (page.excludedSegmentIds?.includes(seg.id)) return [];
      return [{ page, globalIdx }];
    });
  }

  return whiteboardPages
    .map((page, globalIdx) => ({ page, globalIdx }))
    .filter(({ page }) => !page.segmentId || page.segmentId === seg.id)
    .filter(({ page }) => !page.excludedSegmentIds?.includes(seg.id));
}
