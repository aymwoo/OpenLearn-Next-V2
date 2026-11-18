/**
 * 白板页 → 环节归属纯函数（课中大纲与备课共用）。
 */
export type OutlinePageLike = {
  id?: string;
  title?: string;
  segmentId?: string | null;
  excludedSegmentIds?: readonly string[] | null;
};

export type OutlineSegmentLike = {
  id: string;
};

export type SegmentPageMatch<T extends OutlinePageLike = OutlinePageLike> = {
  page: T;
  globalIdx: number;
};

export function getPagesForSegment<T extends OutlinePageLike>(
  seg: OutlineSegmentLike,
  segIdx: number,
  whiteboardPages: readonly T[],
  timelineSegments: readonly OutlineSegmentLike[],
): SegmentPageMatch<T>[] {
  const explicitMatches = whiteboardPages
    .map((p, globalIdx) => ({ page: p, globalIdx }))
    .filter(({ page }) => page.segmentId === seg.id);

  if (explicitMatches.length > 0) {
    return explicitMatches.filter(({ page }) => !page.excludedSegmentIds?.includes(seg.id));
  }

  const hasAnySegmentBinding = whiteboardPages.some((p) => Boolean(p.segmentId));
  if (!hasAnySegmentBinding) {
    if (whiteboardPages.length === 0) return [];
    if (whiteboardPages.length === timelineSegments.length || whiteboardPages.length < timelineSegments.length) {
      const p = whiteboardPages[segIdx];
      if (!p || p.excludedSegmentIds?.includes(seg.id)) return [];
      return [{ page: p, globalIdx: segIdx }];
    }
    const perSeg = Math.ceil(whiteboardPages.length / (timelineSegments.length || 1));
    const start = segIdx * perSeg;
    const end = Math.min(start + perSeg, whiteboardPages.length);
    return whiteboardPages
      .slice(start, end)
      .map((p, offset) => ({
        page: p,
        globalIdx: start + offset,
      }))
      .filter(({ page }) => !page.excludedSegmentIds?.includes(seg.id));
  }

  return [];
}
