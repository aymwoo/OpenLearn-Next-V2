/**
 * declarative-migrator.ts — 插件声明式版本化数据库迁移器（Issue #142）。
 *
 * 为插件提供版本化 SQL 迁移管理，支持：
 * 1. migrations/ 目录约定（NNN_name.sql，按版本自然序升序）；
 * 2. 支持 -- UP 与 -- DOWN 分段解析；
 * 3. 记录已执行迁移于 plugin_declared_migrations 元表，记录 checksum；
 * 4. 降级保护：若数据库中的最高迁移版本高于包内声明版本，拒绝激活；
 * 5. 单步事务：每条迁移在 db.transaction() 内原子执行，失败自动回滚；
 * 6. 支持占位符 {{prefix}} / {{table_prefix}} 自动展开为插件私有表前缀。
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { parseMigrationSql, executeSqlStatements, simpleChecksum, type Migration } from '../db/migrator.js';
import { PluginMigrationExecutionError, PluginMigrationDowngradeError } from './errors.js';
import { pluginTablePrefix } from './plugin-tables.js';

export interface PluginMigrationItem extends Migration {
  version: number;
  fileName: string;
}

export interface AppliedPluginMigration {
  plugin_id: string;
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}

export interface RunPluginMigrationsOptions {
  tablePrefix?: string;
  strictChecksum?: boolean;
}

export interface RunPluginMigrationsResult {
  appliedCount: number;
  appliedNames: string[];
  maxVersion: number;
}

/**
 * 确保声明式迁移元表 plugin_declared_migrations 存在。
 */
export function ensurePluginDeclaredMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_declared_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, name)
    );
  `);
}

/**
 * 从文件名中解析出版本号与迁移基准名称。
 *
 * 支持形如：
 * - 001_initial.sql -> version: 1, name: "001_initial"
 * - 02_add_field.sql -> version: 2, name: "02_add_field"
 * - 100-create-table.sql -> version: 100, name: "100-create-table"
 * - initial.sql -> version: 0, name: "initial"
 */
export function parseMigrationFileName(fileName: string): { version: number; baseName: string } {
  const baseName = path.basename(fileName, '.sql');
  const match = baseName.match(/^(\d+)[_-]?(.*)$/);
  if (match) {
    const version = parseInt(match[1], 10);
    return { version: Number.isSafeInteger(version) ? version : 0, baseName };
  }
  return { version: 0, baseName };
}

/**
 * 从插件目录中的 migrations/ 目录加载所有 .sql 迁移文件并解析排序。
 */
export function loadPluginMigrations(migrationsDir: string): PluginMigrationItem[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const stat = fs.statSync(migrationsDir);
  if (!stat.isDirectory()) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const vA = parseMigrationFileName(a).version;
      const vB = parseMigrationFileName(b).version;
      if (vA !== vB) return vA - vB;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

  return files.map((file) => {
    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { version, baseName } = parseMigrationFileName(file);
    const parsed = parseMigrationSql(baseName, content);
    return {
      name: baseName,
      fileName: file,
      version,
      up: parsed.up,
      down: parsed.down,
    };
  });
}

/**
 * 展开 SQL 脚本中的占位符（如 {{prefix}}、{{table_prefix}}）。
 */
export function expandSqlPlaceholders(sql: string, tablePrefix?: string): string {
  if (!tablePrefix) return sql;
  return sql.replace(/\{\{\s*prefix\s*\}\}/g, tablePrefix).replace(/\{\{\s*table_prefix\s*\}\}/g, tablePrefix);
}

/**
 * 执行指定插件的声明式版本化迁移。
 *
 * @param db SQLite 数据库实例
 * @param pluginId 插件唯一标识（如 UUID 或 scopeId）
 * @param migrationsDir 迁移文件所在的目录路径
 * @param options 执行选项（如表前缀替换等）
 */
export function runPluginDeclarativeMigrations(
  db: Database.Database,
  pluginId: string,
  migrationsDir: string,
  options?: RunPluginMigrationsOptions,
): RunPluginMigrationsResult {
  ensurePluginDeclaredMigrationsTable(db);

  const migrations = loadPluginMigrations(migrationsDir);
  if (migrations.length === 0) {
    return { appliedCount: 0, appliedNames: [], maxVersion: 0 };
  }

  // 1. 查询数据库中已记录的本插件迁移记录
  const appliedRows = db
    .prepare(
      'SELECT plugin_id, version, name, checksum, applied_at FROM plugin_declared_migrations WHERE plugin_id = ? ORDER BY version ASC',
    )
    .all(pluginId) as AppliedPluginMigration[];

  const appliedMap = new Map(appliedRows.map((r) => [r.name, r]));

  // 2. 降级保护检查（Downgrade Protection）
  const maxAppliedVersion = appliedRows.length > 0 ? Math.max(...appliedRows.map((r) => r.version)) : 0;
  const maxDeclaredVersion = Math.max(...migrations.map((m) => m.version));

  if (appliedRows.length > 0 && maxAppliedVersion > maxDeclaredVersion) {
    throw new PluginMigrationDowngradeError(pluginId, maxAppliedVersion, maxDeclaredVersion);
  }

  // 3. 校验和漂移检测（防已执行脚本被篡改）
  for (const [name, stored] of appliedMap) {
    const item = migrations.find((m) => m.name === name);
    if (!item) continue;
    const actualChecksum = simpleChecksum(item.up);
    if (actualChecksum !== stored.checksum) {
      const msg = `[PluginMigration] 插件 "${pluginId}" 已执行迁移 "${name}" 的 UP 脚本已被修改（记录 ${stored.checksum} vs 当前 ${actualChecksum}）。`;
      if (options?.strictChecksum) {
        throw new Error(msg);
      }
      console.warn(msg);
    }
  }

  // 4. 筛选待执行的增量迁移
  const pending = migrations.filter((m) => !appliedMap.has(m.name));
  const appliedNames: string[] = [];
  const tablePrefix = options?.tablePrefix ?? pluginTablePrefix(pluginId);

  // 5. 逐个执行待迁移项（每项包裹在独立事务中，失败自动回滚）
  for (const migration of pending) {
    const sqlToRun = expandSqlPlaceholders(migration.up, tablePrefix);
    const checksum = simpleChecksum(migration.up);

    const applyTransaction = db.transaction(() => {
      executeSqlStatements(db, sqlToRun);
      db.prepare(
        `
        INSERT INTO plugin_declared_migrations (plugin_id, version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(pluginId, migration.version, migration.name, checksum, Date.now());
    });

    try {
      applyTransaction();
      appliedNames.push(migration.name);
    } catch (err: any) {
      console.error(`[PluginMigration] 插件 "${pluginId}" 迁移 "${migration.name}" 执行失败并已回滚:`, err);
      throw new PluginMigrationExecutionError(pluginId, migration.name, err);
    }
  }

  const finalMaxVersion = Math.max(maxAppliedVersion, maxDeclaredVersion);

  return {
    appliedCount: appliedNames.length,
    appliedNames,
    maxVersion: finalMaxVersion,
  };
}

/**
 * 回滚指定的某项单步声明式迁移（若提供了 DOWN 脚本）。
 */
export function rollbackPluginDeclarativeMigration(
  db: Database.Database,
  pluginId: string,
  migration: PluginMigrationItem,
  options?: { tablePrefix?: string },
): void {
  if (!migration.down || migration.down.trim() === '') {
    throw new Error(`Migration "${migration.name}" does not provide a DOWN rollback script.`);
  }

  const sqlToRun = expandSqlPlaceholders(migration.down, options?.tablePrefix);

  const rollbackTransaction = db.transaction(() => {
    executeSqlStatements(db, sqlToRun);
    db.prepare('DELETE FROM plugin_declared_migrations WHERE plugin_id = ? AND name = ?').run(pluginId, migration.name);
  });

  rollbackTransaction();
}

/**
 * 获取某个插件当前在库中已应用的声明式迁移记录。
 */
export function getPluginAppliedMigrations(db: Database.Database, pluginId: string): AppliedPluginMigration[] {
  ensurePluginDeclaredMigrationsTable(db);
  return db
    .prepare(
      'SELECT plugin_id, version, name, checksum, applied_at FROM plugin_declared_migrations WHERE plugin_id = ? ORDER BY version ASC',
    )
    .all(pluginId) as AppliedPluginMigration[];
}
