-- UP
-- 075_lesson_activity_surface.sql
--
-- 阶段 3「宿主与放置」：学案活动接入 LearningSurface。
--
-- 一个 lesson_activities 活动最多绑定一个 Surface（设计文档 §4.2）。
-- 用部分唯一索引而不是普通唯一索引：大量历史活动没有 Surface，
-- 普通唯一索引在 SQLite 中允许 NULL 重复，语义上没问题，但显式部分索引
-- 更清楚地表达「只约束已绑定 Surface 的行」。
--
-- 本迁移只加列与索引，不创建 Surface：Surface 由活动保存时按需创建。

ALTER TABLE lesson_activities ADD COLUMN surface_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_activities_surface
  ON lesson_activities(surface_id)
  WHERE surface_id IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS idx_lesson_activities_surface;
ALTER TABLE lesson_activities DROP COLUMN surface_id;
