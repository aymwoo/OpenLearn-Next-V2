-- UP
-- 061_classroom_messages.sql
-- 通讯协议 Tier B（可靠通道）消息表：request/response 消息本身 + 投递确认 +
-- 断线补投游标（设计 Q10=C / Q11=B / Q12=B）。
--
-- 与 pending_side_effects 的职责边界：
--   pending_side_effects = 主写入成功后事件投递失败的「补偿队列」（短期、出错才写）
--   classroom_messages   = 重要消息本身的「可靠投递 + 确认 + 补投游标」（长期、发送即写）
--
-- 游标用单调 seq（AUTOINCREMENT）而非 created_at：严格不漏不重；messageId(id)
-- 仍作幂等键与前端去重键（Q5），双保险。

CREATE TABLE IF NOT EXISTS classroom_messages (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  id               TEXT NOT NULL UNIQUE,      -- messageId(uuid)，幂等 + 前端去重键
  channel          TEXT NOT NULL,             -- 'xuean:task' / 'moodle:quiz'，插件命名空间
  msg_type         TEXT NOT NULL,             -- 'request' | 'response'（Tier B 类型）

  -- 寻址（复用 presence 房间约定：classRoom/userRoom/lesson room）
  lesson_id        TEXT,
  class_id         TEXT,
  target_user_ids  TEXT,                      -- JSON string[]；NULL = 房间广播
  sender_actor_id  TEXT NOT NULL,
  sender_role      TEXT NOT NULL,
  sender_plugin_id TEXT,                      -- 插件发的消息带 plugin id，防冒用

  -- 因果
  correlation_id   TEXT,                      -- request↔response 关联
  payload          TEXT NOT NULL,             -- JSON，业务载荷（平台不解析）

  -- 投递状态机：pending → delivered → acked；失败 → dead_letter；过期 → expired
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  delivered_at     INTEGER,                   -- 服务端 emit 成功
  acked_at         INTEGER,                   -- 客户端回 ACK
  expires_at       INTEGER,                   -- TTL，NULL 不过期

  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- 断线补投：按课节 + 游标 seq 扫描未确认消息
CREATE INDEX IF NOT EXISTS idx_cm_replay
  ON classroom_messages(lesson_id, seq);

-- 班级维度补投/审计
CREATE INDEX IF NOT EXISTS idx_cm_class
  ON classroom_messages(class_id, seq);

-- 状态筛选（配合上面两个索引做 status + seq 范围查）
CREATE INDEX IF NOT EXISTS idx_cm_status
  ON classroom_messages(status, seq);

-- 插件 channel 维度审计
CREATE INDEX IF NOT EXISTS idx_cm_channel
  ON classroom_messages(channel, created_at);

-- 过期清理
CREATE INDEX IF NOT EXISTS idx_cm_expiry
  ON classroom_messages(expires_at);

-- DOWN
DROP INDEX IF EXISTS idx_cm_expiry;
DROP INDEX IF EXISTS idx_cm_channel;
DROP INDEX IF EXISTS idx_cm_status;
DROP INDEX IF EXISTS idx_cm_class;
DROP INDEX IF EXISTS idx_cm_replay;
DROP TABLE IF EXISTS classroom_messages;
