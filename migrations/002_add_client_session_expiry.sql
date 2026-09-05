-- UP
-- SEC-AUTH-03: client_sessions 添加 expires_at 列
ALTER TABLE client_sessions ADD COLUMN expires_at INTEGER;

-- DOWN
-- Note: SQLite does not support DROP COLUMN in earlier versions without table recreation.
