-- UP
-- 059_credit_awards.sql
-- 学分发放幂等记录（设计 Q8=B：统一 awardCredits 入口）。
-- 每次成功发放写一条，唯一 (student_id, idempotency_key) 防重复发放/防刷；
-- 重放同一 key 返回原流水，不重复加分。negative delta = 扣回（如兑换撤销）。

CREATE TABLE IF NOT EXISTS credit_awards (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  dimension_id TEXT NOT NULL,
  delta_points REAL NOT NULL,
  /** 来源白名单标识：attendance / assignment / quiz / interaction / courseware / ai_practice / manual / plugin:<id> */
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  /** 幂等键：同一学生同一业务动作只发一次（如 attendance:class:date） */
  idempotency_key TEXT NOT NULL,
  /** 积分流水 id（student_point_logs.id），审计桥梁 */
  point_log_id TEXT NOT NULL,
  /** 操作者（教师/管理员/系统），审计用 */
  actor_id TEXT,
  created_at INTEGER NOT NULL
);

-- 幂等：同一学生同一业务键只发一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_awards_idem
  ON credit_awards(student_id, idempotency_key);

-- 审计/查询：按学生、按来源
CREATE INDEX IF NOT EXISTS idx_credit_awards_student
  ON credit_awards(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_awards_source
  ON credit_awards(source, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_credit_awards_source;
DROP INDEX IF EXISTS idx_credit_awards_student;
DROP INDEX IF EXISTS uq_credit_awards_idem;
DROP TABLE IF EXISTS credit_awards;
