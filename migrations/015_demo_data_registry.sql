-- UP
-- 演示数据登记表（DEMO-SEED-01）
--
-- 一键演示数据的**精确作用域**保障。
--
-- 背景：既有 `POST /api/admin/seed-demo` 依赖标题模糊匹配来识别演示数据
-- （`title LIKE 'E2E %'`），无法区分"演示数据"与"恰好同名的真实数据"，
-- 清理时存在误伤风险。本表记录播种时**实际创建的每一行**，清理时据此
-- 精确删除，不再依赖任何命名约定。
--
-- 约束：
--   1. 清理只删除本表登记的行；未登记的一律不碰。
--   2. 管理员账号（users.role='administrator'）永不删除，代码侧另有兜底断言。

CREATE TABLE IF NOT EXISTS demo_data_registry (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_demo_data_registry_type ON demo_data_registry(entity_type);

-- DOWN
DROP INDEX IF EXISTS idx_demo_data_registry_type;
DROP TABLE IF EXISTS demo_data_registry;
