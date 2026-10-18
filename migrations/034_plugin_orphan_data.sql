-- UP
-- 插件卸载的数据语义（Issue #141）：卸载默认保留数据，purge 需先导出归档。
--
-- `keep`（默认）：插件私有表、`plugin_migrations` 版本记录与 `plugin_storage`
-- 键值原样保留，本表登记一条「孤立插件数据」；
-- 重装同 manifest.id 时复用 plugin_id（原安装 UUID），表前缀 / 迁移版本 / 存储键
-- 三者都会天然命中旧数据，无需搬迁。
CREATE TABLE IF NOT EXISTS plugin_orphan_data (
  manifest_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  plugin_name TEXT,
  plugin_version TEXT,
  table_prefixes TEXT NOT NULL DEFAULT '[]',
  table_names TEXT NOT NULL DEFAULT '[]',
  row_count INTEGER NOT NULL DEFAULT 0,
  storage_keys INTEGER NOT NULL DEFAULT 0,
  migration_version INTEGER,
  last_export_path TEXT,
  uninstalled_at INTEGER NOT NULL,
  PRIMARY KEY (manifest_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_orphan_data_manifest ON plugin_orphan_data (manifest_id);

-- DOWN
DROP INDEX IF EXISTS idx_plugin_orphan_data_manifest;
DROP TABLE IF EXISTS plugin_orphan_data;
