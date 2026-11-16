-- UP
-- 057_classroom_session_lifecycle.sql
-- 长周期课次生命周期（Gitee issue IKVNIX / F-0008）：
-- 1) classroom_sessions 增加活动时间、自动归档时间与教师豁免标记。
--    新列默认 NULL，不回填、不改写已部署会话的 stage / ended_at。
-- 2) site_settings.classroom_session_auto_archive_after_ms：僵尸课次自动归档阈值。
--    NULL 表示使用服务端默认（24 小时，且不得低于单次课时长下限）。
-- 3) user_preferences：按账号存储学生「未结束提示」的本次忽略 / 延后到明天偏好。

ALTER TABLE classroom_sessions ADD COLUMN last_activity_at INTEGER;
ALTER TABLE classroom_sessions ADD COLUMN auto_archived_at INTEGER;
ALTER TABLE classroom_sessions ADD COLUMN auto_archive_exempt INTEGER;

ALTER TABLE site_settings ADD COLUMN classroom_session_auto_archive_after_ms INTEGER;

CREATE TABLE IF NOT EXISTS user_preferences (
  principal_key TEXT NOT NULL,
  pref_key TEXT NOT NULL,
  pref_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (principal_key, pref_key)
);

CREATE INDEX IF NOT EXISTS idx_classroom_sessions_stage_activity
  ON classroom_sessions(stage, last_activity_at);

-- DOWN
DROP INDEX IF EXISTS idx_classroom_sessions_stage_activity;
DROP TABLE IF EXISTS user_preferences;
ALTER TABLE site_settings DROP COLUMN classroom_session_auto_archive_after_ms;
ALTER TABLE classroom_sessions DROP COLUMN auto_archive_exempt;
ALTER TABLE classroom_sessions DROP COLUMN auto_archived_at;
ALTER TABLE classroom_sessions DROP COLUMN last_activity_at;
