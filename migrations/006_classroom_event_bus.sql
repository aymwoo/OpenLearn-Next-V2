-- UP
-- 课堂事件统一：events 审计表补索引与课堂维度
--
-- 背景：课堂里的状态变更（锁屏、进度、随堂作答、课件 attempt、进度模式）此前
-- 都是 REST 路由里直接 `io.emit`，绕过内核总线，因此不进 `events` 表。统一走
-- 总线后，`events` 成为课堂的事实日志，读取形态也变了：
--   - 按时间窗口查询（课堂报告、排障回溯）
--   - 按 correlationId 串联同一条业务流（一次课件作答的 log → adopt → submit）
--   - 按课节重放整堂课
-- 现有索引只有 (type, timestamp)，上述三种查询都走不到索引。本次补齐：
--   idx_events_timestamp     纯时间窗口查询
--   idx_events_correlation   按 correlationId 串联
--   events.lesson_id         课堂维度列 + (lesson_id, timestamp) 复合索引
--
-- 关于顺序：不额外引入 seq 列。SQLite 每张普通表都有单调递增的内建 rowid，
-- 按 `ORDER BY rowid` 即可得到稳定的事件顺序，无需维护内存计数器，
-- 也避免了进程重启后序号回退的问题。

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlationId);
ALTER TABLE events ADD COLUMN lesson_id TEXT;
CREATE INDEX IF NOT EXISTS idx_events_lesson_time ON events(lesson_id, timestamp);

-- DOWN
-- 只回滚索引：DROP COLUMN 需要 SQLite 3.35+，且留下一个未被写入的 NULL 列是无害的。
DROP INDEX IF EXISTS idx_events_timestamp;
DROP INDEX IF EXISTS idx_events_correlation;
DROP INDEX IF EXISTS idx_events_lesson_time;
