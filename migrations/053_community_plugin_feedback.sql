-- UP
-- 053_community_plugin_feedback.sql
-- 社区插件市场：用户 +Star（GitHub 风格一键标星）与评分评价（1-5 星 + 文字评论）。

CREATE TABLE IF NOT EXISTS community_plugin_stars (
  plugin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_plugin_stars_plugin
  ON community_plugin_stars (plugin_id);

CREATE TABLE IF NOT EXISTS community_plugin_reviews (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  plugin_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (plugin_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_plugin_reviews_plugin
  ON community_plugin_reviews (plugin_id, updated_at DESC);

-- DOWN
DROP INDEX IF EXISTS idx_community_plugin_reviews_plugin;
DROP TABLE IF EXISTS community_plugin_reviews;
DROP INDEX IF EXISTS idx_community_plugin_stars_plugin;
DROP TABLE IF EXISTS community_plugin_stars;
