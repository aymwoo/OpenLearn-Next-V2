-- UP
-- 第三方插件的能力授权与出站域名白名单必须由管理员显式批准写入。
-- plugin_key 支持 DB UUID 与 manifest.id 双键查询，确保向后兼容与隔离。

CREATE TABLE IF NOT EXISTS plugin_capability_grants (
  plugin_key TEXT NOT NULL,
  capability TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_key, capability)
);

CREATE TABLE IF NOT EXISTS plugin_network_grants (
  plugin_key TEXT NOT NULL,
  host TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_key, host)
);

-- DOWN
DROP TABLE IF EXISTS plugin_capability_grants;
DROP TABLE IF EXISTS plugin_network_grants;
