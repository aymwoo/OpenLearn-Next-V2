-- File storage extension: split physical blobs (file_blobs), logical assets (file_assets),
-- and legacy URL aliases (file_aliases), plus admin config column on site_settings and asset linkage on plugin_assignment_files.

CREATE TABLE IF NOT EXISTS file_blobs (
  id TEXT PRIMARY KEY,
  backend_id TEXT NOT NULL DEFAULT 'local',
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_blobs_backend_key ON file_blobs(backend_id, storage_key);
CREATE INDEX IF NOT EXISTS idx_file_blobs_sha256 ON file_blobs(backend_id, sha256);

CREATE TABLE IF NOT EXISTS file_assets (
  id TEXT PRIMARY KEY,
  blob_id TEXT NOT NULL REFERENCES file_blobs(id),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  author_id TEXT,
  course_id TEXT,
  lesson_id TEXT,
  purpose TEXT NOT NULL,
  access_scope TEXT NOT NULL DEFAULT 'authenticated',
  metadata_json TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_assets_blob ON file_assets(blob_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_course ON file_assets(course_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_lesson ON file_assets(lesson_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_author ON file_assets(author_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_purpose ON file_assets(purpose, deleted_at);

CREATE TABLE IF NOT EXISTS file_aliases (
  alias TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_aliases_asset ON file_aliases(asset_id);

ALTER TABLE site_settings ADD COLUMN file_storage_config TEXT;
ALTER TABLE plugin_assignment_files ADD COLUMN asset_id TEXT;
CREATE INDEX IF NOT EXISTS idx_assignment_files_asset ON plugin_assignment_files(asset_id);

-- DOWN
DROP INDEX IF EXISTS idx_assignment_files_asset;
ALTER TABLE plugin_assignment_files DROP COLUMN asset_id;
ALTER TABLE site_settings DROP COLUMN file_storage_config;
DROP INDEX IF EXISTS idx_file_aliases_asset;
DROP TABLE IF EXISTS file_aliases;
DROP INDEX IF EXISTS idx_file_assets_purpose;
DROP INDEX IF EXISTS idx_file_assets_author;
DROP INDEX IF EXISTS idx_file_assets_lesson;
DROP INDEX IF EXISTS idx_file_assets_course;
DROP INDEX IF EXISTS idx_file_assets_blob;
DROP TABLE IF EXISTS file_assets;
DROP INDEX IF EXISTS idx_file_blobs_sha256;
DROP INDEX IF EXISTS idx_file_blobs_backend_key;
DROP TABLE IF EXISTS file_blobs;
