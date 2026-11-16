-- ============================================================================
-- 061_activity_peer_reviews.sql
-- Issue IKVO15 · P1 — 跨课节互评（轻量版）
-- 学生对同学提交的活动进行评分与评语。
-- 防刷：每个 (reviewer_id, reviewee_id, activity_id) 唯一，只取最后一次评分。
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_peer_reviews (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewee_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(activity_id, reviewer_id, reviewee_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_reviews_activity ON activity_peer_reviews(activity_id);
CREATE INDEX IF NOT EXISTS idx_peer_reviews_reviewee ON activity_peer_reviews(reviewee_id);

-- DOWN
DROP TABLE IF EXISTS activity_peer_reviews;
