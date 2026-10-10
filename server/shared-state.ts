// ── Shared module-level state (extracted verbatim from server.ts) ──
// Lesson timeline segments are imported by server.ts and by the route modules
// via the ServerContext. They were module-level `const`s at the top of
// server.ts and are re-exported here so the monolith can be decomposed
// without changing behavior.
//
// NOTE: MFE（Module Federation）边界已于 v0.5.0 彻底移除：`mfe-whiteboard`
// 包只剩空 dist 残留、`mfe_remotes` 表无任何写入方、`GET /api/mfe/remotes`
// 无任何调用方。`MF_REMOTE_CACHE` 及其 TTL/容量治理连同路由一并删除；
// `mfe_remotes` 表仅作为迁移历史保留，不再读写。

// ── Lesson Active Segments ──────────────────────────────────────────────────
/** Active timeline segments for lessons, shared with agents to bind new items */
const MAX_ACTIVE_SEGMENTS = 500;
export const lessonActiveSegments = new Map<string, string>(); // lessonId -> activeSegmentId

export function setActiveSegment(lessonId: string, segmentId: string): void {
  lessonActiveSegments.set(lessonId, segmentId);
  while (lessonActiveSegments.size > MAX_ACTIVE_SEGMENTS) {
    const oldest = lessonActiveSegments.keys().next().value;
    if (oldest === undefined) break;
    lessonActiveSegments.delete(oldest);
  }
}

