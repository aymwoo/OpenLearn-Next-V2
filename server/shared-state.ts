// ── Shared module-level state (extracted verbatim from server.ts) ──
// These two Maps are imported by server.ts and by the route modules via the
// ServerContext. They were module-level `const`s at the top of server.ts and
// are re-exported here so the monolith can be decomposed without changing
// behavior.

// ── MFE Remote Entry Cache ──────────────────────────────────────────────────
/** In-memory cache for MFE remote entry URLs (D-24: cache-first strategy) */
export const MF_REMOTE_CACHE = new Map<string, { entry: string; meta: Record<string, any> }>();

// ── Lesson Active Segments ──────────────────────────────────────────────────
/** Active timeline segments for lessons, shared with agents to bind new items */
export const lessonActiveSegments = new Map<string, string>(); // lessonId -> activeSegmentId
