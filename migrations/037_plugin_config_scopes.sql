-- Issue #151：插件配置分层（平台 → 学校 → 班级 → 插件默认值）。
--
-- 旧实现把配置值塞在 plugin_storage 的 `config:<key>` 里，只有一层（等价于平台层）。
-- 新增独立表承载 scope，避免把作用域编码进 key 而无法按 scope 查询/清理。
--
-- 兼容性：
-- * 建表幂等；
-- * 旧值在迁移时原样搬到平台层（scope_type='platform', scope_id=''）；
-- * ConfigService 仍会在新表缺行时回退读 plugin_storage，双重保险。

CREATE TABLE IF NOT EXISTS plugin_config (
  plugin_id   TEXT NOT NULL,
  scope_type  TEXT NOT NULL DEFAULT 'platform',
  scope_id    TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, scope_type, scope_id, key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_config_scope
  ON plugin_config (plugin_id, scope_type, scope_id);

-- 迁移旧值：plugin_storage.key = 'config:<key>' → plugin_config(platform, '', <key>)
INSERT INTO plugin_config (plugin_id, scope_type, scope_id, key, value, updated_at)
SELECT
  plugin_id,
  'platform',
  '',
  substr(key, 8),
  value,
  COALESCE(updated_at, 0)
FROM plugin_storage
WHERE key LIKE 'config:%'
ON CONFLICT (plugin_id, scope_type, scope_id, key) DO NOTHING;

-- DOWN
-- 回滚只删新表/索引：旧值仍在 plugin_storage，回退到旧版 ConfigService 后可继续读取。
DROP INDEX IF EXISTS idx_plugin_config_scope;
DROP TABLE IF EXISTS plugin_config;
