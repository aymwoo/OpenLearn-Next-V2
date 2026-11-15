/**
 * 插件更新前快照与安全回滚子系统。
 *
 * 职责：
 * 1. 更新前自动生成完整快照：插件目录文件（含 package.zip、index.js、frontend.js、storage/ 等）、
 *    `plugins` 主记录、插件私有表（结构 + 索引 + 全量数据）、`plugin_migrations`、
 *    `plugin_storage`、`plugin_config` 及能力/网络/公开路由授权记录；
 * 2. 存储隔离：快照存放在 `pluginsDir` 同级目录 `<data>/plugin-update-snapshots/<pluginId>/<snapshotId>/`，
 *    绝不置于 `/plugins` 静态服务挂载范围内；
 * 3. 保留策略：默认每个插件仅保留最近 1 份可用快照（`DEFAULT_PLUGIN_SNAPSHOT_RETENTION = 1`），
 *    可通过环境变量 `OPENLEARN_PLUGIN_SNAPSHOT_RETENTION` 覆盖；
 * 4. 安全回滚：升级失败自动回滚 + 升级后发现 Bug 由管理员手动一键回滚（文件原子替换 + SQLite 单事务还原）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type { PluginExecutionMode } from './types.js';
import { listAllowedPluginTablePrefixes, isSafePluginTablePrefix } from './plugin-tables.js';
import { listPluginTables } from './orphan-data.js';
import { invalidatePluginConfigCache } from './config-service.js';

export const DEFAULT_PLUGIN_SNAPSHOT_RETENTION = 1;
export const SNAPSHOT_RETENTION_ENV = 'OPENLEARN_PLUGIN_SNAPSHOT_RETENTION';

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._@-]+$/;
const SAFE_TABLE_NAME_RE = /^plugin_[A-Za-z0-9_]+$/;
const ORPHAN_DATA_TABLE = 'plugin_orphan_data';

export type PluginSnapshotStatus = 'creating' | 'ready' | 'rolled_back';

export interface PluginSnapshotMeta {
  snapshotId: string;
  pluginId: string;
  manifestId: string;
  pluginName: string;
  fromVersion: string;
  toVersion: string | null;
  status: PluginSnapshotStatus;
  createdAt: number;
  wasActive: boolean;
  executionMode: PluginExecutionMode;
  tableCount: number;
  rowCount: number;
  storageRows: number;
  configRows: number;
  migrationVersion: number | null;
  sizeBytes: number;
}

export interface PluginSnapshotHandle {
  meta: PluginSnapshotMeta;
  snapshotDir: string;
}

interface SerializedTable {
  name: string;
  createSql: string;
  indexes: string[];
  columns: string[];
  rows: unknown[][];
}

interface SerializedPluginRow {
  id: string;
  name: string;
  manifest: string;
  source_code: string | null;
  file_path: string | null;
  status: string;
  execution_mode: string | null;
  loader_version: string | null;
  version: string | null;
  created_at: number | null;
  updated_at: number | null;
}

interface PluginDbSnapshot {
  pluginRow: SerializedPluginRow;
  tables: SerializedTable[];
  hasMigrationRow: boolean;
  migrationVersion: number | null;
  storageRows: Array<{ plugin_id: string; key: string; value: string; updated_at: number | null }>;
  configRows: Array<{
    plugin_id: string;
    scope_type: string;
    scope_id: string;
    key: string;
    value: string;
    updated_at: number;
  }>;
  capabilityGrants: Array<{ plugin_key: string; capability: string; approved_at: number }>;
  networkGrants: Array<{ plugin_key: string; host: string; approved_at: number }>;
  publicRoutes: Array<{ plugin_key: string; method: string; path: string; approved_at: number }>;
}

/** 解析快照保留份数，默认 1 份，最小 1 份。 */
export function resolveSnapshotRetention(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env[SNAPSHOT_RETENTION_ENV]);
  if (Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  return DEFAULT_PLUGIN_SNAPSHOT_RETENTION;
}

/** 快照根目录：与 `pluginsDir` 同级，避免被 `/plugins` 静态中间件暴露。 */
export function getPluginSnapshotsRoot(pluginsDir: string): string {
  return path.join(path.dirname(path.resolve(pluginsDir)), 'plugin-update-snapshots');
}

function assertSafeSegment(segment: string, label: string): string {
  const trimmed = segment.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || !SAFE_SEGMENT_RE.test(trimmed)) {
    throw new Error(`[PluginSnapshot] Invalid ${label}: "${segment}"`);
  }
  return trimmed;
}

/** 校验并拼接单个插件快照目录路径。 */
export function getPluginSnapshotDir(pluginsDir: string, pluginId: string, snapshotId: string): string {
  const root = getPluginSnapshotsRoot(pluginsDir);
  const safePluginId = assertSafeSegment(pluginId, 'pluginId');
  const safeSnapshotId = assertSafeSegment(snapshotId, 'snapshotId');
  const resolved = path.resolve(root, safePluginId, safeSnapshotId);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`[PluginSnapshot] Path traversal blocked for "${pluginId}/${snapshotId}"`);
  }
  return resolved;
}

function getPluginSnapshotsForPluginDir(pluginsDir: string, pluginId: string): string {
  const root = getPluginSnapshotsRoot(pluginsDir);
  const safePluginId = assertSafeSegment(pluginId, 'pluginId');
  const resolved = path.resolve(root, safePluginId);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`[PluginSnapshot] Path traversal blocked for "${pluginId}"`);
  }
  return resolved;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`).get(tableName) as
    { ok: number } | undefined;
  return Boolean(row);
}

function encodeCell(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __openlearnBlobBase64: value.toString('base64') };
  }
  if (value instanceof Uint8Array) {
    return { __openlearnBlobBase64: Buffer.from(value).toString('base64') };
  }
  return value;
}

function decodeCell(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { __openlearnBlobBase64?: unknown }).__openlearnBlobBase64 === 'string'
  ) {
    return Buffer.from((value as { __openlearnBlobBase64: string }).__openlearnBlobBase64, 'base64');
  }
  return value;
}

function computeDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += computeDirSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function queryByKeys<T>(db: Database, tableName: string, keyColumn: string, selectCols: string, keys: string[]): T[] {
  if (!tableExists(db, tableName) || keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(', ');
  return db
    .prepare(`SELECT ${selectCols} FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(keyColumn)} IN (${placeholders})`)
    .all(...keys) as T[];
}

function captureDbSnapshot(db: Database, pluginId: string, manifestId: string): PluginDbSnapshot {
  const pluginRow = db
    .prepare(
      `SELECT id, name, manifest, source_code, file_path, status, execution_mode, loader_version, version, created_at, updated_at
       FROM plugins WHERE id = ?`,
    )
    .get(pluginId) as SerializedPluginRow | undefined;

  if (!pluginRow) {
    throw new Error(`[PluginSnapshot] Plugin "${pluginId}" row not found in plugins table`);
  }

  const keys = [...new Set([pluginId, manifestId].filter((k) => typeof k === 'string' && k.length > 0))];
  const prefixes = listAllowedPluginTablePrefixes(pluginId, manifestId, true);
  const tableInfos = listPluginTables(db, prefixes);
  const tables: SerializedTable[] = [];

  for (const info of tableInfos) {
    const meta = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(info.name) as
      { sql: string | null } | undefined;
    if (!meta?.sql) continue;
    const columns = (db.prepare(`PRAGMA table_info(${quoteIdent(info.name)})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    if (columns.length === 0) continue;
    const indexes = (
      db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL`)
        .all(info.name) as Array<{ sql: string }>
    ).map((idx) => idx.sql);
    const rawRows = db.prepare(`SELECT * FROM ${quoteIdent(info.name)}`).all() as Array<Record<string, unknown>>;
    const rows = rawRows.map((row) => columns.map((col) => encodeCell(row[col])));
    tables.push({
      name: info.name,
      createSql: meta.sql,
      indexes,
      columns,
      rows,
    });
  }

  let hasMigrationRow = false;
  let migrationVersion: number | null = null;
  if (tableExists(db, 'plugin_migrations')) {
    const mig = db.prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ?').get(pluginId) as
      { version: number } | undefined;
    if (mig) {
      hasMigrationRow = true;
      migrationVersion = Number(mig.version);
    }
  }

  const storageRows = queryByKeys<PluginDbSnapshot['storageRows'][number]>(
    db,
    'plugin_storage',
    'plugin_id',
    'plugin_id, key, value, updated_at',
    keys,
  );
  const configRows = queryByKeys<PluginDbSnapshot['configRows'][number]>(
    db,
    'plugin_config',
    'plugin_id',
    'plugin_id, scope_type, scope_id, key, value, updated_at',
    keys,
  );
  const capabilityGrants = queryByKeys<PluginDbSnapshot['capabilityGrants'][number]>(
    db,
    'plugin_capability_grants',
    'plugin_key',
    'plugin_key, capability, approved_at',
    keys,
  );
  const networkGrants = queryByKeys<PluginDbSnapshot['networkGrants'][number]>(
    db,
    'plugin_network_grants',
    'plugin_key',
    'plugin_key, host, approved_at',
    keys,
  );
  const publicRoutes = queryByKeys<PluginDbSnapshot['publicRoutes'][number]>(
    db,
    'plugin_public_routes',
    'plugin_key',
    'plugin_key, method, path, approved_at',
    keys,
  );

  return {
    pluginRow,
    tables,
    hasMigrationRow,
    migrationVersion,
    storageRows,
    configRows,
    capabilityGrants,
    networkGrants,
    publicRoutes,
  };
}

/**
 * 在更新开始前生成插件全量快照（文件 + 数据库）。
 * 快照状态初始为 `creating`，待更新成功后再调用 `finalizePluginUpdateSnapshot` 转为 `ready`。
 */
export function createPluginUpdateSnapshot(
  db: Database,
  pluginsDir: string,
  pluginId: string,
  context: { wasActive: boolean; executionMode: PluginExecutionMode },
): PluginSnapshotHandle {
  const row = db.prepare('SELECT name, manifest, version FROM plugins WHERE id = ?').get(pluginId) as
    { name: string; manifest: string; version: string | null } | undefined;
  if (!row) {
    throw new Error(`[PluginSnapshot] Cannot snapshot missing plugin "${pluginId}"`);
  }
  const manifest = JSON.parse(row.manifest) as Manifest;
  const manifestId = manifest.id || pluginId;

  const createdAt = Date.now();
  const snapshotId = `snap-${createdAt}-${randomUUID().slice(0, 8)}`;
  const snapshotDir = getPluginSnapshotDir(pluginsDir, pluginId, snapshotId);
  const filesDir = path.join(snapshotDir, 'files');
  const pluginDir = path.join(path.resolve(pluginsDir), assertSafeSegment(pluginId, 'pluginId'));

  try {
    fs.mkdirSync(filesDir, { recursive: true });
    if (fs.existsSync(pluginDir)) {
      fs.cpSync(pluginDir, filesDir, {
        recursive: true,
        filter: (src) => path.basename(src) !== '.update-backup',
      });
    }

    const dbSnapshot = captureDbSnapshot(db, pluginId, manifestId);
    const dbSnapshotPath = path.join(snapshotDir, 'db-snapshot.json');
    writeJsonAtomic(dbSnapshotPath, dbSnapshot);

    const rowCount = dbSnapshot.tables.reduce((sum, t) => sum + t.rows.length, 0);
    const sizeBytes = computeDirSize(snapshotDir);
    const meta: PluginSnapshotMeta = {
      snapshotId,
      pluginId,
      manifestId,
      pluginName: manifest.name || row.name || manifestId,
      fromVersion: manifest.version || row.version || '0.0.0',
      toVersion: null,
      status: 'creating',
      createdAt,
      wasActive: context.wasActive,
      executionMode: context.executionMode,
      tableCount: dbSnapshot.tables.length,
      rowCount,
      storageRows: dbSnapshot.storageRows.length,
      configRows: dbSnapshot.configRows.length,
      migrationVersion: dbSnapshot.migrationVersion,
      sizeBytes,
    };

    writeJsonAtomic(path.join(snapshotDir, 'meta.json'), meta);
    return { meta, snapshotDir };
  } catch (err) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw err;
  }
}

/** 更新成功后把快照标记为 `ready`，记录目标版本并按保留上限清理旧快照。 */
export function finalizePluginUpdateSnapshot(
  pluginsDir: string,
  pluginId: string,
  snapshotDir: string,
  toVersion: string,
  retention: number = resolveSnapshotRetention(),
): PluginSnapshotMeta {
  const metaPath = path.join(snapshotDir, 'meta.json');
  const current = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PluginSnapshotMeta;
  const updated: PluginSnapshotMeta = {
    ...current,
    toVersion,
    status: 'ready',
    sizeBytes: computeDirSize(snapshotDir),
  };
  writeJsonAtomic(metaPath, updated);
  prunePluginSnapshots(pluginsDir, pluginId, retention);
  return updated;
}

/** 清理临时或已失效的快照目录。 */
export function removePluginUpdateSnapshot(snapshotDir: string): void {
  try {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** 按创建时间倒序列出插件的可用快照（仅返回 `ready` 状态）。 */
export function listPluginSnapshots(pluginsDir: string, pluginId: string): PluginSnapshotMeta[] {
  const pluginSnapDir = getPluginSnapshotsForPluginDir(pluginsDir, pluginId);
  if (!fs.existsSync(pluginSnapDir)) return [];

  const out: PluginSnapshotMeta[] = [];
  for (const entry of fs.readdirSync(pluginSnapDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(pluginSnapDir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PluginSnapshotMeta;
      if (meta && meta.status === 'ready' && meta.pluginId === pluginId) {
        out.push(meta);
      }
    } catch {
      /* ignore corrupted snapshot metadata */
    }
  }

  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** 按保留份数淘汰最旧快照（默认仅保留 1 份）。 */
export function prunePluginSnapshots(
  pluginsDir: string,
  pluginId: string,
  retention: number = resolveSnapshotRetention(),
): void {
  const keep = Math.max(1, Math.floor(retention));
  const ready = listPluginSnapshots(pluginsDir, pluginId);
  for (const oldMeta of ready.slice(keep)) {
    try {
      const dir = getPluginSnapshotDir(pluginsDir, pluginId, oldMeta.snapshotId);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** 删除指定插件的单个快照，返回是否实际删除。 */
export function deletePluginSnapshot(pluginsDir: string, pluginId: string, snapshotId: string): boolean {
  const dir = getPluginSnapshotDir(pluginsDir, pluginId, snapshotId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** 卸载彻底清除（purge）时清理该插件的所有快照。 */
export function purgePluginSnapshots(pluginsDir: string, pluginId: string): void {
  try {
    const dir = getPluginSnapshotsForPluginDir(pluginsDir, pluginId);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function restoreDbFromSnapshot(db: Database, pluginId: string, manifestId: string, snap: PluginDbSnapshot): void {
  const keys = [...new Set([pluginId, manifestId].filter((k) => typeof k === 'string' && k.length > 0))];
  const prefixes = listAllowedPluginTablePrefixes(pluginId, manifestId, true);
  const currentTables = listPluginTables(db, prefixes);

  let previousFk = 1;
  try {
    const fkRow = db.pragma('foreign_keys', { simple: true }) as number | undefined;
    if (typeof fkRow === 'number') previousFk = fkRow;
    db.pragma('foreign_keys = OFF');
  } catch {
    /* ignore if pragma unsupported */
  }

  try {
    const apply = db.transaction(() => {
      // 1. 删除当前插件私有表（含新版本可能新增的表）
      for (const tbl of currentTables) {
        if (!SAFE_TABLE_NAME_RE.test(tbl.name) || tbl.name === ORPHAN_DATA_TABLE) continue;
        db.exec(`DROP TABLE IF EXISTS ${quoteIdent(tbl.name)}`);
      }

      // 2. 重建旧版私有表、数据与索引
      for (const tbl of snap.tables) {
        if (
          !SAFE_TABLE_NAME_RE.test(tbl.name) ||
          tbl.name === ORPHAN_DATA_TABLE ||
          !prefixes.some((p) => isSafePluginTablePrefix(p) && tbl.name.startsWith(p))
        ) {
          continue;
        }
        db.exec(`DROP TABLE IF EXISTS ${quoteIdent(tbl.name)}`);
        db.exec(tbl.createSql);

        if (tbl.columns.length > 0 && tbl.rows.length > 0) {
          const colSql = tbl.columns.map(quoteIdent).join(', ');
          const placeholders = tbl.columns.map(() => '?').join(', ');
          const insertStmt = db.prepare(`INSERT INTO ${quoteIdent(tbl.name)} (${colSql}) VALUES (${placeholders})`);
          for (const rowValues of tbl.rows) {
            insertStmt.run(...rowValues.map(decodeCell));
          }
        }

        for (const indexSql of tbl.indexes) {
          db.exec(indexSql);
        }
      }

      // 3. 恢复 plugin_migrations
      if (tableExists(db, 'plugin_migrations')) {
        db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(pluginId);
        if (snap.hasMigrationRow && snap.migrationVersion !== null) {
          db.prepare('INSERT INTO plugin_migrations (plugin_id, version) VALUES (?, ?)').run(
            pluginId,
            snap.migrationVersion,
          );
        }
      }

      // 4. 恢复 plugin_storage
      if (tableExists(db, 'plugin_storage') && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`DELETE FROM plugin_storage WHERE plugin_id IN (${placeholders})`).run(...keys);
        const insStorage = db.prepare(
          'INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        );
        for (const row of snap.storageRows) {
          insStorage.run(row.plugin_id, row.key, row.value, row.updated_at);
        }
      }

      // 5. 恢复 plugin_config
      if (tableExists(db, 'plugin_config') && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`DELETE FROM plugin_config WHERE plugin_id IN (${placeholders})`).run(...keys);
        const insCfg = db.prepare(
          'INSERT INTO plugin_config (plugin_id, scope_type, scope_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const row of snap.configRows) {
          insCfg.run(row.plugin_id, row.scope_type, row.scope_id, row.key, row.value, row.updated_at);
        }
      }

      // 6. 恢复三类安全授权表
      if (tableExists(db, 'plugin_capability_grants') && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`DELETE FROM plugin_capability_grants WHERE plugin_key IN (${placeholders})`).run(...keys);
        const insCap = db.prepare(
          'INSERT INTO plugin_capability_grants (plugin_key, capability, approved_at) VALUES (?, ?, ?)',
        );
        for (const row of snap.capabilityGrants) {
          insCap.run(row.plugin_key, row.capability, row.approved_at);
        }
      }
      if (tableExists(db, 'plugin_network_grants') && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`DELETE FROM plugin_network_grants WHERE plugin_key IN (${placeholders})`).run(...keys);
        const insNet = db.prepare('INSERT INTO plugin_network_grants (plugin_key, host, approved_at) VALUES (?, ?, ?)');
        for (const row of snap.networkGrants) {
          insNet.run(row.plugin_key, row.host, row.approved_at);
        }
      }
      if (tableExists(db, 'plugin_public_routes') && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(`DELETE FROM plugin_public_routes WHERE plugin_key IN (${placeholders})`).run(...keys);
        const insRoute = db.prepare(
          'INSERT INTO plugin_public_routes (plugin_key, method, path, approved_at) VALUES (?, ?, ?, ?)',
        );
        for (const row of snap.publicRoutes) {
          insRoute.run(row.plugin_key, row.method, row.path, row.approved_at);
        }
      }

      // 7. 恢复 plugins 主记录
      const p = snap.pluginRow;
      db.prepare(
        `UPDATE plugins
         SET name = ?, manifest = ?, source_code = ?, file_path = ?, status = ?, execution_mode = ?, loader_version = ?, version = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        p.name,
        p.manifest,
        p.source_code ?? '',
        p.file_path,
        p.status,
        p.execution_mode,
        p.loader_version,
        p.version,
        p.updated_at ?? Date.now(),
        pluginId,
      );
    });
    apply();
  } finally {
    try {
      db.pragma(`foreign_keys = ${previousFk ? 'ON' : 'OFF'}`);
    } catch {
      /* ignore */
    }
  }
}

export interface RestoreSnapshotResult {
  meta: PluginSnapshotMeta;
  oldManifest: Manifest;
}

/**
 * 从快照完整恢复指定插件的文件系统与数据库状态。
 * 调用前调用方应先停用插件运行态（inline 实例 / worker / 子进程）。
 */
export function restorePluginSnapshot(
  db: Database,
  pluginsDir: string,
  pluginId: string,
  snapshotId?: string,
): RestoreSnapshotResult {
  let targetMeta: PluginSnapshotMeta | undefined;
  if (snapshotId) {
    const dir = getPluginSnapshotDir(pluginsDir, pluginId, snapshotId);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error(`Snapshot "${snapshotId}" not found for plugin "${pluginId}"`);
    }
    targetMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PluginSnapshotMeta;
  } else {
    targetMeta = listPluginSnapshots(pluginsDir, pluginId)[0];
    if (!targetMeta) {
      throw new Error(`No rollback snapshot available for plugin "${pluginId}"`);
    }
  }

  const snapshotDir = getPluginSnapshotDir(pluginsDir, pluginId, targetMeta.snapshotId);
  const dbSnapshotPath = path.join(snapshotDir, 'db-snapshot.json');
  const filesDir = path.join(snapshotDir, 'files');

  if (!fs.existsSync(dbSnapshotPath) || !fs.existsSync(filesDir)) {
    throw new Error(`Snapshot "${targetMeta.snapshotId}" is incomplete`);
  }

  const dbSnapshot = JSON.parse(fs.readFileSync(dbSnapshotPath, 'utf-8')) as PluginDbSnapshot;
  const oldManifest = JSON.parse(dbSnapshot.pluginRow.manifest) as Manifest;
  const manifestId = oldManifest.id || targetMeta.manifestId || pluginId;
  const pluginDir = path.join(path.resolve(pluginsDir), assertSafeSegment(pluginId, 'pluginId'));

  const parent = path.dirname(pluginDir);
  const stagingDir = path.join(parent, `.rollback-stage-${randomUUID()}`);
  const backupOldDir = path.join(parent, `.rollback-old-${randomUUID()}`);

  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(filesDir, stagingDir, { recursive: true });
  const hadExisting = fs.existsSync(pluginDir);
  if (hadExisting) {
    fs.renameSync(pluginDir, backupOldDir);
  }

  try {
    fs.renameSync(stagingDir, pluginDir);
    restoreDbFromSnapshot(db, pluginId, manifestId, dbSnapshot);
    invalidatePluginConfigCache(db, manifestId);
    if (manifestId !== pluginId) {
      invalidatePluginConfigCache(db, pluginId);
    }
    if (hadExisting && fs.existsSync(backupOldDir)) {
      fs.rmSync(backupOldDir, { recursive: true, force: true });
    }
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    if (hadExisting && fs.existsSync(backupOldDir)) {
      fs.renameSync(backupOldDir, pluginDir);
    }
    throw err;
  }

  return { meta: targetMeta, oldManifest };
}
