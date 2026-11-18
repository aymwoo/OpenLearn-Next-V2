-- UP
-- 058_reward_catalog.sql
-- 学分兑换的奖励/自由活动目录（设计 Q7=B）。
-- 价格、库存、上下架、资格、有效期由目录统一维护，兑换时由服务端读取，
-- 不接受客户端自报价格。reward_redemptions.reward_id 指向本表 id（软关联，
-- 不建物理外键，避免迁移顺序与清理策略耦合）。

CREATE TABLE IF NOT EXISTS reward_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  icon TEXT,
  color TEXT,
  /** 兑换所需学分（> 0） */
  cost_points REAL NOT NULL,
  /** 库存：NULL = 不限量；>= 0 为剩余可兑换数 */
  stock INTEGER,
  /** 已兑换次数（审计与展示，兑换成功时 +1） */
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  /** 上架状态：active 可兑换，inactive 下架 */
  status TEXT NOT NULL DEFAULT 'active',
  /** 资格条件 JSON：{ minPoints?, roles?, classIds? }，空对象/NULL 表示无门槛 */
  eligibility_json TEXT,
  /** 有效期（ms timestamp，NULL = 长期有效） */
  available_from INTEGER,
  available_until INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 目录浏览：上架项按排序
CREATE INDEX IF NOT EXISTS idx_reward_catalog_listing
  ON reward_catalog(status, sort_order, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_reward_catalog_listing;
DROP TABLE IF EXISTS reward_catalog;
