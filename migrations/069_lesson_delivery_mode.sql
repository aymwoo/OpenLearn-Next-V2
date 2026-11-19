-- UP
-- 069_lesson_delivery_mode.sql
-- 课程交付模式：whiteboard（白板）或 xuean（学案）。
-- 列保持可空。NULL 表示升级前的旧课，读取时按白板处理，不改既有课堂路径。
-- 不使用 teaching_mode_id：那是门户风格标签，不驱动向导或课中引擎。

ALTER TABLE lessons ADD COLUMN delivery_mode TEXT;

-- DOWN
ALTER TABLE lessons DROP COLUMN delivery_mode;
