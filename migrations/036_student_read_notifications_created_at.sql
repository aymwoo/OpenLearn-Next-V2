-- UP
-- 学生已读通知保留策略支持：添加 created_at 时间戳列（Issue #145）
ALTER TABLE student_read_notifications ADD COLUMN created_at INTEGER DEFAULT (strftime('%s','now')*1000);

-- DOWN
