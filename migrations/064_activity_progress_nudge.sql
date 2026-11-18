-- ============================================================================
-- 064_activity_progress_nudge.sql
-- Issue IKVO15 · P1 — 一键催办
-- 扩展 activity_progress 表，增加催办时间戳与次数。
-- ============================================================================

ALTER TABLE activity_progress ADD COLUMN nudged_at INTEGER;
ALTER TABLE activity_progress ADD COLUMN nudge_count INTEGER NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE activity_progress DROP COLUMN nudged_at;
ALTER TABLE activity_progress DROP COLUMN nudge_count;
