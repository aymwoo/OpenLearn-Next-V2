/**
 * 插件卸载的数据语义（Issue #141）——孤立数据登记、归档导出与清除。
 *
 * 背景：`uninstallPlugin` 此前无条件 `DROP TABLE` 插件私有表，并删除
 * `plugin_storage` / `plugin_migrations`，误点卸载即丢失学生数据；而更新路径
 * 却保留业务数据 —— 同一份数据在「更新」与「卸载」两条路径上语义相反。
 *
 * 本模块把卸载数据从「二进制开关」改为显式策略：
 * 1. `keep`（默认）：表、迁移版本、存储键原样保留，仅登记一条孤立数据记录；
 * 2. `purge`（显式 + 二次确认）：先导出 SQL 归档，再删除表/记录/存储键；
 * 3. 重装同 `manifest.id`：`claimOrphanData()` 复用原安装 UUID，
 *    使表前缀（`plugin_<uuid>_`）、`plugin_migrations.plugin_id`、
 *    `plugin_storage.plugin_id` 三者天然命中旧数据，无需数据搬迁。
 *
 * 安全性：
 * - 所有拼进 SQL 的表名都来自 `sqlite_master`，并通过前缀白名单
 *   （`isSafePluginTablePrefix`）与表名白名单双重校验，绝不接受调用方传入的任意标识符；
 * - 导出文件由调用方指定目录（服务端解析为数据目录下的专用目录），
 *   不落在 `/plugins` 静态服务范围内（该静态挂载对任意登录用户开放）。
 */

import fs from 'fs';
import path from 'path';
import { isSafePluginTablePrefix } from './plugin-tables.js';

type SqlStatement = {
  run: (...args: any[]) => any;
  get: (...args: any[]) => any;
  all: (...args: any[]) => any;
};

/** 只依赖 exec + prepare 的最小 DB 形状，便于测试替身与 worker 侧复用。 */
export type OrphanDataDb = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqlStatement;
};

export const ORPHAN_DATA_TABLE = 'plugin_orphan_data';

/** 卸载时的数据处理策略。`keep` 为默认，`purge` 必须显式指定。 */
export type PluginDataPolicy = 'keep' | 'purge';

export interface UninstallPluginOptions {
  /** 默认 `keep`：保留数据；`purge` 需显式指定且调用方必须已完成二次确认。 */
  dataPolicy?: PluginDataPolicy;
  /** purge 归档目录；默认与 pluginsDir 同级的数据目录 `plugin-data-exports`。 */
  exportDir?: string;
  /** 审计日志里的操作者标识。 */
  actorId?: string;
}

export interface UninstallPluginResult {
  pluginId: string;
  manifestId: string;
  dataPolicy: PluginDataPolicy;
  /** keep 策略下继续保留在库中的表（供接口回显/审计）。 */
  keptTables: string[];
  keptRows: number;
  /** purge 策略下实际删除的表数量。 */
  droppedTables: number;
  /** purge 策略下的归档文件路径（先导出后删除；导出失败则中止卸载）。 */
  exportFile?: string;
  orphanRegistered: boolean;
}

export interface OrphanDataRecord {
  manifestId: string;
  pluginId: string;
  pluginName: string | null;
  pluginVersion: string | null;
  tablePrefixes: string[];
  tableNames: string[];
  rowCount: number;
  storageKeys: number;
  migrationVersion: number | null;
  lastExportPath: string | null;
  uninstalledAt: number;
}

export interface PluginTableInfo {
  name: string;
  rowCount: number;
}

/** 表名必须与建表路径同口径：plugin_ 前缀 + 字母数字下划线，且不是孤立数据登记表本身。 */
function isSafePluginTableName(name: string): boolean {
  return /^plugin_[A-Za-z0-9_]+$/.test(name) && name !== ORPHAN_DATA_TABLE;
}

function isSafePluginDataPrefix(prefix: string): boolean {
  return isSafePluginTablePrefix(prefix) && !ORPHAN_DATA_TABLE.startsWith(prefix);
}

/** 标识符 / 字面量转义（SQLite 方言）。 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const ensuredDbs = new WeakSet<object>();

/**
 * 幂等创建孤立数据登记表。
 *
 * 迁移 `034_plugin_orphan_data.sql` 是正式建表路径；这里再兜底一次，
 * 让「迁移未跑到的旧库 / 测试内存库」在卸载时不会因为缺表而丢数据。
 */
export function ensureOrphanDataTable(db: OrphanDataDb): void {
  if (typeof db === 'object' && db !== null) {
    if (ensuredDbs.has(db as object)) return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ORPHAN_DATA_TABLE} (
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
    CREATE INDEX IF NOT EXISTS idx_plugin_orphan_data_manifest ON ${ORPHAN_DATA_TABLE} (manifest_id);
  `);
  if (typeof db === 'object' && db !== null) {
    ensuredDbs.add(db as object);
  }
}

/** 列出插件私有表（含行数），只返回通过安全校验的表。 */
export function listPluginTables(db: OrphanDataDb, prefixes: string[]): PluginTableInfo[] {
  const seen = new Set<string>();
  const tables: PluginTableInfo[] = [];
  for (const prefix of prefixes) {
    if (!isSafePluginDataPrefix(prefix)) continue;
    let rows: Array<{ name: string }> = [];
    try {
      rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(`${prefix}%`) as Array<{ name: string }>;
    } catch {
      continue;
    }
    for (const row of rows) {
      const name = row?.name;
      if (!name || seen.has(name) || !isSafePluginTableName(name) || !name.startsWith(prefix)) continue;
      seen.add(name);
      let rowCount = 0;
      try {
        const count = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`).get() as { c: number } | undefined;
        rowCount = Number(count?.c ?? 0);
      } catch {
        rowCount = 0;
      }
      tables.push({ name, rowCount });
    }
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

/** 统计插件保留在 `plugin_storage` 中的键数量（配置 + 业务键值）。 */
export function countPluginStorageRows(db: OrphanDataDb, keys: string[]): number {
  let total = 0;
  for (const key of keys) {
    if (!key) continue;
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM plugin_storage WHERE plugin_id = ?').get(key) as
        | { c: number }
        | undefined;
      total += Number(row?.c ?? 0);
    } catch {
      // plugin_storage 不存在时视为 0
    }
  }
  return total;
}

/** 读取插件 `ctx.db.migrate()` 的版本记录；无记录返回 null。 */
export function readPluginMigrationVersion(db: OrphanDataDb, pluginId: string): number | null {
  try {
    const row = db.prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ?').get(pluginId) as
      | { version: number }
      | undefined;
    return row ? Number(row.version) : null;
  } catch {
    return null;
  }
}

export interface OrphanDataSummary {
  /** 是否有需要保留/清理的数据。无数据的插件不产生孤立记录，避免管理页噪声。 */
  hasData: boolean;
  tables: PluginTableInfo[];
  rowCount: number;
  storageRows: number;
  migrationVersion: number | null;
}

/** 采集一次「卸载前」数据摘要，供 keep 登记与 purge 决策共用。 */
export function summarizePluginData(
  db: OrphanDataDb,
  prefixes: string[],
  keys: { pluginId: string; manifestId: string },
): OrphanDataSummary {
  const tables = listPluginTables(db, prefixes);
  const rowCount = tables.reduce((sum, t) => sum + t.rowCount, 0);
  const storageRows = countPluginStorageRows(db, [keys.pluginId, keys.manifestId]);
  const migrationVersion = readPluginMigrationVersion(db, keys.pluginId);
  return {
    hasData: tables.length > 0 || migrationVersion !== null || storageRows > 0,
    tables,
    rowCount,
    storageRows,
    migrationVersion,
  };
}

export interface RegisterOrphanDataInput {
  manifestId: string;
  pluginId: string;
  pluginName?: string | null;
  pluginVersion?: string | null;
  tablePrefixes: string[];
  summary: OrphanDataSummary;
  uninstalledAt?: number;
}

/** 登记 / 覆盖一条孤立数据记录（同一 manifest + pluginId 幂等）。 */
export function registerOrphanData(db: OrphanDataDb, input: RegisterOrphanDataInput): OrphanDataRecord {
  ensureOrphanDataTable(db);
  const record: OrphanDataRecord = {
    manifestId: input.manifestId,
    pluginId: input.pluginId,
    pluginName: input.pluginName ?? null,
    pluginVersion: input.pluginVersion ?? null,
    tablePrefixes: input.tablePrefixes.filter(isSafePluginDataPrefix),
    tableNames: input.summary.tables.map((t) => t.name),
    rowCount: input.summary.rowCount,
    storageKeys: input.summary.storageRows,
    migrationVersion: input.summary.migrationVersion,
    lastExportPath: null,
    uninstalledAt: input.uninstalledAt ?? Date.now(),
  };
  db.prepare(
    `INSERT INTO ${ORPHAN_DATA_TABLE}
       (manifest_id, plugin_id, plugin_name, plugin_version, table_prefixes, table_names,
        row_count, storage_keys, migration_version, last_export_path, uninstalled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(manifest_id, plugin_id) DO UPDATE SET
       plugin_name = excluded.plugin_name,
       plugin_version = excluded.plugin_version,
       table_prefixes = excluded.table_prefixes,
       table_names = excluded.table_names,
       row_count = excluded.row_count,
       storage_keys = excluded.storage_keys,
       migration_version = excluded.migration_version,
       uninstalled_at = excluded.uninstalled_at`,
  ).run(
    record.manifestId,
    record.pluginId,
    record.pluginName,
    record.pluginVersion,
    JSON.stringify(record.tablePrefixes),
    JSON.stringify(record.tableNames),
    record.rowCount,
    record.storageKeys,
    record.migrationVersion,
    record.lastExportPath,
    record.uninstalledAt,
  );
  return record;
}

function rowToRecord(row: any): OrphanDataRecord {
  const parseList = (value: unknown): string[] => {
    try {
      const parsed = JSON.parse(String(value ?? '[]'));
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    manifestId: String(row.manifest_id),
    pluginId: String(row.plugin_id),
    pluginName: row.plugin_name ?? null,
    pluginVersion: row.plugin_version ?? null,
    tablePrefixes: parseList(row.table_prefixes),
    tableNames: parseList(row.table_names),
    rowCount: Number(row.row_count ?? 0),
    storageKeys: Number(row.storage_keys ?? 0),
    migrationVersion:
      row.migration_version === null || row.migration_version === undefined ? null : Number(row.migration_version),
    lastExportPath: row.last_export_path ?? null,
    uninstalledAt: Number(row.uninstalled_at ?? 0),
  };
}

/** 列出全部孤立插件数据，最近卸载的排在前面。 */
export function listOrphanData(db: OrphanDataDb): OrphanDataRecord[] {
  ensureOrphanDataTable(db);
  const rows = db.prepare(`SELECT * FROM ${ORPHAN_DATA_TABLE} ORDER BY uninstalled_at DESC`).all() as any[];
  return rows.map(rowToRecord);
}

export function findOrphanDataRecord(db: OrphanDataDb, manifestId: string, pluginId: string): OrphanDataRecord | null {
  ensureOrphanDataTable(db);
  const row = db
    .prepare(`SELECT * FROM ${ORPHAN_DATA_TABLE} WHERE manifest_id = ? AND plugin_id = ?`)
    .get(manifestId, pluginId) as any;
  return row ? rowToRecord(row) : null;
}

/** 更新记录上的最近导出路径（导出与 purge 共用）。 */
export function updateOrphanDataExportPath(db: OrphanDataDb, manifestId: string, pluginId: string, file: string): void {
  ensureOrphanDataTable(db);
  db.prepare(`UPDATE ${ORPHAN_DATA_TABLE} SET last_export_path = ? WHERE manifest_id = ? AND plugin_id = ?`).run(
    file,
    manifestId,
    pluginId,
  );
}

/**
 * 查找同一 `manifest.id` 可被复用的孤立数据（取最近一次卸载的记录），**不删除登记**。
 *
 * 安装流程在成功写入 plugins 行之后才调用 `deleteOrphanDataRecord()` 注销登记：
 * 若安装中途失败，登记仍留在管理页可见可清理，不会出现「表还在但没人知道」的盲区。
 *
 * 同 manifest 存在多条孤立记录时只复用最新一条，其余保留。
 * 安装链路本身已全局串行（installQueue），不会与另一次安装并发。
 */
export function findAdoptableOrphanData(db: OrphanDataDb, manifestId: string): OrphanDataRecord | null {
  ensureOrphanDataTable(db);
  const row = db
    .prepare(`SELECT * FROM ${ORPHAN_DATA_TABLE} WHERE manifest_id = ? ORDER BY uninstalled_at DESC LIMIT 1`)
    .get(manifestId) as any;
  return row ? rowToRecord(row) : null;
}

export function deleteOrphanDataRecord(db: OrphanDataDb, manifestId: string, pluginId: string): void {
  ensureOrphanDataTable(db);
  db.prepare(`DELETE FROM ${ORPHAN_DATA_TABLE} WHERE manifest_id = ? AND plugin_id = ?`).run(manifestId, pluginId);
}

/** 同 manifest 是否还有别的数据持有者（其他孤立记录 / 已安装的同 manifest 插件）。 */
function countOtherDataOwners(db: OrphanDataDb, manifestId: string, pluginId: string): number {
  let others = 0;
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM ${ORPHAN_DATA_TABLE} WHERE manifest_id = ? AND plugin_id != ?`)
      .get(manifestId, pluginId) as { c: number } | undefined;
    others += Number(row?.c ?? 0);
  } catch {
    // 登记表缺失等同于没有其他持有者
  }
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM plugins WHERE id != ? AND manifest LIKE ?`).get(
      pluginId,
      `%"id":"${manifestId}"%`,
    ) as { c: number } | undefined;
    others += Number(row?.c ?? 0);
  } catch {
    // plugins 表在极简测试库里可能不存在
  }
  return others;
}

export interface ExportPluginDataOptions {
  manifestId: string;
  pluginId: string;
  prefixes: string[];
  /** 归档文件目标路径（目录不存在时自动创建）。 */
  targetFile: string;
}

export interface ExportPluginDataResult {
  file: string;
  tables: string[];
  rowCount: number;
}

/**
 * 导出插件数据为可重放的 SQL 归档（CREATE TABLE + INSERT + 迁移版本 + 存储键）。
 *
 * 只导出 `sqlite_master` 中真实存在、且属于本插件前缀的表。
 */
export function exportPluginDataToSql(db: OrphanDataDb, options: ExportPluginDataOptions): ExportPluginDataResult {
  const tables = listPluginTables(db, options.prefixes);
  const lines: string[] = [];
  const exportedTables: string[] = [];
  let totalRows = 0;

  lines.push('-- OpenLearn plugin data archive');
  lines.push(`-- manifest_id: ${options.manifestId}`);
  lines.push(`-- plugin_id: ${options.pluginId}`);
  lines.push(`-- exported_at: ${new Date().toISOString()}`);
  lines.push(`-- tables: ${tables.length}`);
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN TRANSACTION;');

  for (const table of tables) {
    const meta = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(table.name) as
      | { sql: string | null }
      | undefined;
    if (!meta) continue;
    const columns = (
      db.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    if (columns.length === 0) continue;
    lines.push('');
    lines.push(`-- table: ${table.name} (rows: ${table.rowCount})`);
    lines.push(`DROP TABLE IF EXISTS ${quoteIdent(table.name)};`);
    if (meta.sql) lines.push(`${meta.sql};`);
    const rows = db.prepare(`SELECT * FROM ${quoteIdent(table.name)}`).all() as Array<Record<string, unknown>>;
    const columnList = columns.map(quoteIdent).join(', ');
    for (const row of rows) {
      const values = columns.map((col) => sqlLiteral(row[col])).join(', ');
      lines.push(`INSERT INTO ${quoteIdent(table.name)} (${columnList}) VALUES (${values});`);
      totalRows += 1;
    }
    exportedTables.push(table.name);
  }

  // 迁移版本：重装后 `ctx.db.migrate()` 依据它决定是否继续升级，必须随数据一起归档。
  const migrationVersion = readPluginMigrationVersion(db, options.pluginId);
  lines.push('');
  lines.push('-- plugin_migrations');
  lines.push(`CREATE TABLE IF NOT EXISTS plugin_migrations (plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL);`);
  lines.push(
    `INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (${sqlLiteral(options.pluginId)}, ${sqlLiteral(migrationVersion)});`,
  );

  // 存储键（配置 + 业务键值）按 manifestId / pluginId 双键导出，与读写侧口径一致。
  for (const storageKey of [options.pluginId, options.manifestId]) {
    let rows: Array<{ key: string; value: string; updated_at: number }> = [];
    try {
      rows = db
        .prepare('SELECT key, value, updated_at FROM plugin_storage WHERE plugin_id = ?')
        .all(storageKey) as Array<{ key: string; value: string; updated_at: number }>;
    } catch {
      rows = [];
    }
    if (rows.length === 0) continue;
    lines.push('');
    lines.push(`-- plugin_storage (plugin_id: ${storageKey}, rows: ${rows.length})`);
    lines.push(
      `CREATE TABLE IF NOT EXISTS plugin_storage (plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (plugin_id, key));`,
    );
    for (const row of rows) {
      lines.push(
        `INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (${sqlLiteral(storageKey)}, ${sqlLiteral(row.key)}, ${sqlLiteral(row.value)}, ${sqlLiteral(row.updated_at)});`,
      );
    }
  }

  lines.push('COMMIT;');
  lines.push('');

  const dir = path.dirname(options.targetFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(options.targetFile, lines.join('\n'), 'utf-8');

  return { file: options.targetFile, tables: exportedTables, rowCount: totalRows };
}

export interface PurgePluginDataResult {
  droppedTables: string[];
  deletedMigration: boolean;
  deletedStorageRows: number;
  /** 因同 manifest 仍有其他数据持有者而跳过删除按 manifestId 共享的存储键。 */
  skippedSharedStorage: boolean;
}

/** 同 manifest 是否还有别的数据持有者（其他孤立记录 / 已安装的同 manifest 插件）。 */
export function hasOtherDataOwners(db: OrphanDataDb, manifestId: string, pluginId: string): boolean {
  return countOtherDataOwners(db, manifestId, pluginId) > 0;
}

/**
 * 清除一条孤立数据：插件表 + `plugin_migrations` + `plugin_storage` + 登记记录。
 *
 * 若同 manifest 仍有其他孤立记录或已安装实例，则跳过按 manifestId 存放的存储键，
 * 只清理该 pluginId 自己的键空间，避免误删他人数据。
 */
export function purgePluginData(db: OrphanDataDb, record: OrphanDataRecord): PurgePluginDataResult {
  ensureOrphanDataTable(db);
  const prefixes = [...new Set(record.tablePrefixes)].filter(isSafePluginDataPrefix);
  const tables = listPluginTables(db, prefixes);

  const droppedTables: string[] = [];
  for (const table of tables) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${quoteIdent(table.name)}`);
      droppedTables.push(table.name);
    } catch (error) {
      console.warn(`[PluginHost] Failed to drop orphan table "${table.name}":`, error);
    }
  }

  let deletedMigration = false;
  try {
    const result = db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(record.pluginId);
    deletedMigration = Number(result?.changes ?? 0) > 0;
  } catch {
    // plugin_migrations 不存在时视为无记录
  }

  const others = countOtherDataOwners(db, record.manifestId, record.pluginId);
  const storageKeys = others > 0 ? [record.pluginId] : [record.pluginId, record.manifestId];
  let deletedStorageRows = 0;
  for (const key of storageKeys) {
    if (!key) continue;
    try {
      const result = db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(key);
      deletedStorageRows += Number(result?.changes ?? 0);
    } catch {
      // plugin_storage 不存在
    }
  }

  deleteOrphanDataRecord(db, record.manifestId, record.pluginId);

  return {
    droppedTables,
    deletedMigration,
    deletedStorageRows,
    skippedSharedStorage: others > 0,
  };
}
