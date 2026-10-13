-- UP
-- 插件公开路由必须由管理员显式批准。manifest 的 auth:false 不再单独放行。
-- plugin_key 同时写入 DB UUID 与 manifest.id，网关用任一身份都能命中。

CREATE TABLE IF NOT EXISTS plugin_public_routes (
  plugin_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_key, method, path)
);

-- DOWN
DROP TABLE IF EXISTS plugin_public_routes;
