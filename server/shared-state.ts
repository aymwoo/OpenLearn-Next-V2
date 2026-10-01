// ── Shared module-level state (extracted verbatim from server.ts) ──
// These two Maps are imported by server.ts and by the route modules via the
// ServerContext. They were module-level `const`s at the top of server.ts and
// are re-exported here so the monolith can be decomposed without changing
// behavior.

// ── MFE Remote Entry Cache ──────────────────────────────────────────────────
/**
 * In-memory cache for MFE remote entry URLs (D-24: cache-first strategy).
 *
 * Phase B4（路线图 B4）内存泄漏治理：
 *   - TTL 惰性过期：get 时超过 5 分钟的条目视为失效并剔除（读多写少场景，
 *     无需后台定时器）；
 *   - 容量上限：set 时超过 100 条按插入序淘汰最旧条目，防写入风暴下无限增长。
 */
const MF_CACHE_TTL_MS = 5 * 60 * 1000;
const MF_CACHE_MAX_ENTRIES = 100;

interface MFRemoteCacheEntry {
  entry: string;
  meta: Record<string, any>;
  ts: number;
}

export const MF_REMOTE_CACHE = new Map<string, MFRemoteCacheEntry>();

export function cacheGetMfRemote(name: string): MFRemoteCacheEntry | undefined {
  const hit = MF_REMOTE_CACHE.get(name);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > MF_CACHE_TTL_MS) {
    MF_REMOTE_CACHE.delete(name);
    return undefined;
  }
  return hit;
}

export function cacheSetMfRemote(name: string, entry: string, meta: Record<string, any>): void {
  MF_REMOTE_CACHE.set(name, { entry, meta, ts: Date.now() });
  while (MF_REMOTE_CACHE.size > MF_CACHE_MAX_ENTRIES) {
    const oldest = MF_REMOTE_CACHE.keys().next().value;
    if (oldest === undefined) break;
    MF_REMOTE_CACHE.delete(oldest);
  }
}

// ── Lesson Active Segments ──────────────────────────────────────────────────
/** Active timeline segments for lessons, shared with agents to bind new items */
export const lessonActiveSegments = new Map<string, string>(); // lessonId -> activeSegmentId
