-- UP
-- 047_third_party_theme_system.sql
-- Issue #484：第三方主题系统 —— 共享主题目录、版本历史、每账号隔离偏好与站点默认主题。

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  author TEXT NOT NULL,
  latest_version TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  uploader_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  supports_modes TEXT NOT NULL DEFAULT '["light","dark"]',
  platform_min_version TEXT,
  platform_max_version TEXT,
  manifest_json TEXT NOT NULL,
  styles_css TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS theme_versions (
  theme_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  styles_css TEXT NOT NULL DEFAULT '',
  asset_manifest_json TEXT NOT NULL DEFAULT '[]',
  uploader_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (theme_id, version),
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_theme_preferences (
  principal_key TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL DEFAULT 'light',
  installed_version TEXT,
  mode TEXT NOT NULL DEFAULT 'auto',
  appearance_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_themes_status ON themes(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_theme_versions_theme ON theme_versions(theme_id, created_at);

ALTER TABLE site_settings ADD COLUMN default_theme_id TEXT DEFAULT 'light';

-- DOWN
DROP INDEX IF EXISTS idx_theme_versions_theme;
DROP INDEX IF EXISTS idx_themes_status;
DROP TABLE IF EXISTS user_theme_preferences;
DROP TABLE IF EXISTS theme_versions;
DROP TABLE IF EXISTS themes;
ALTER TABLE site_settings DROP COLUMN default_theme_id;
