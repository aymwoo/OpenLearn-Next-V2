-- UP
-- 学生已读通知保留策略支持：添加 created_at 时间戳列（Issue #145）
-- 注意：SQLite 在非空表上执行 ALTER TABLE ADD COLUMN 时，禁止使用非字面常量的 DEFAULT 表达式（如 strftime）。
-- 因此遵循 SQLite 标准做法，通过「新建临时表 + 迁移存量数据 + 替换表」实现幂等安全迁移。
CREATE TABLE IF NOT EXISTS student_read_notifications_new (
  student_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')*1000),
  PRIMARY KEY (student_id, notification_id)
);

INSERT OR IGNORE INTO student_read_notifications_new (student_id, notification_id, created_at)
  SELECT student_id, notification_id, CAST(strftime('%s','now')*1000 AS INTEGER) FROM student_read_notifications;

DROP TABLE IF EXISTS student_read_notifications;
ALTER TABLE student_read_notifications_new RENAME TO student_read_notifications;

-- DOWN
ALTER TABLE student_read_notifications DROP COLUMN created_at;
