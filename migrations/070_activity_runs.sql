-- UP
-- 070_activity_runs.sql
--
-- Phase 3: activity run persistence + xuean activity metadata
--
-- 定义（Descriptor）与运行（Run）分离：
--   lesson_activities 仍存学案活动定义；
--   activity_runs 存 provider 的一次运行实例。
--
-- 仅做加法迁移，旧代码可继续忽略新列/新表。

ALTER TABLE lesson_activities ADD COLUMN descriptor_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lesson_activities ADD COLUMN provider_id TEXT;

CREATE TABLE IF NOT EXISTS activity_runs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  lesson_id TEXT,
  class_id TEXT,
  state TEXT NOT NULL,
  actor_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_runs_lesson_state ON activity_runs(lesson_id, state);
CREATE INDEX IF NOT EXISTS idx_activity_runs_provider ON activity_runs(provider_id);

-- DOWN
DROP INDEX IF EXISTS idx_activity_runs_provider;
DROP INDEX IF EXISTS idx_activity_runs_lesson_state;
DROP TABLE IF EXISTS activity_runs;
ALTER TABLE lesson_activities DROP COLUMN provider_id;
ALTER TABLE lesson_activities DROP COLUMN descriptor_version;
