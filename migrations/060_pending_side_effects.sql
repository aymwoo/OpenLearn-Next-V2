-- UP
-- 060_pending_side_effects.sql
-- 主写入成功、联动副作用（事件/通知/学分）失败待重试的补偿队列（设计 Q3=B / Q4）。
-- 与 pending_commands（等人审批的命令）语义不同，独立成表。

CREATE TABLE IF NOT EXISTS pending_side_effects (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  op TEXT NOT NULL,
  biz_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at INTEGER NOT NULL,
  last_error TEXT,
  origin_actor_id TEXT,
  correlation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_side_effects_biz
  ON pending_side_effects(source, op, biz_key);

CREATE INDEX IF NOT EXISTS idx_pending_side_effects_retry
  ON pending_side_effects(status, next_retry_at);

-- DOWN
DROP INDEX IF EXISTS idx_pending_side_effects_retry;
DROP INDEX IF EXISTS uq_pending_side_effects_biz;
DROP TABLE IF EXISTS pending_side_effects;
