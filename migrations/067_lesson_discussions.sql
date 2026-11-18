-- ============================================================================
-- 067_lesson_discussions.sql
-- Issue IKVO15 · P2 — 活动讨论区
-- 学生在活动下发帖/回复。parent_id 支持嵌套回复。
-- ============================================================================

CREATE TABLE IF NOT EXISTS lesson_discussions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_discussions_activity ON lesson_discussions(activity_id);
CREATE INDEX IF NOT EXISTS idx_discussions_parent ON lesson_discussions(parent_id);

-- DOWN
DROP TABLE IF EXISTS lesson_discussions;
