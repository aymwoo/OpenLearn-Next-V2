-- UP
-- 057_reward_redemptions.sql
-- 学分兑换（自由活动）记录表。
-- 设计取舍（design Q6=A）：不新建"学分账户表"，余额仍由
-- student_point_logs 的 SUM(delta_points) 推导；兑换 = 一条负 delta 流水
-- + 一条兑换记录。本表只承载兑换的溯源、幂等与快照，不与流水双写账户。

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  reward_name TEXT,
  cost_points REAL NOT NULL,
  /** 幂等键：同一学生同一业务键只允许兑换一次 */
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  /** 指向本次扣减产生的负向流水（student_point_logs.id） */
  point_log_id TEXT,
  /** 兑换前后的余额快照，便于争议追溯 */
  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL,
  actor_id TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);

-- 幂等唯一约束：重复提交返回既有记录，不重复扣分
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_redemption_idem
  ON reward_redemptions(student_id, idempotency_key);

-- 学生维度查询（我的兑换记录）
CREATE INDEX IF NOT EXISTS idx_reward_redemption_student
  ON reward_redemptions(student_id, created_at);

-- 班级维度查询（教师/运营核销）
CREATE INDEX IF NOT EXISTS idx_reward_redemption_class
  ON reward_redemptions(class_id, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_reward_redemption_class;
DROP INDEX IF EXISTS idx_reward_redemption_student;
DROP INDEX IF EXISTS uq_reward_redemption_idem;
DROP TABLE IF EXISTS reward_redemptions;
