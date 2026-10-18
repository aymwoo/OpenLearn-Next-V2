/**
 * 从迁移 000–033 的旧库升到 034（Issue #141）。
 *
 * 034 只新增空的 `plugin_orphan_data` 登记表 —— 「卸载默认保留数据」的登记
 * 落点。旧库升级必须无感：不需要回填（历史卸载的数据早已被老版本删掉或
 * 根本不存在），升级后启动正常、二次迁移为空操作。
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../migrator.js';

const migrationsDir = path.resolve(process.cwd(), 'migrations');

function migrationNumber(name: string): number {
  const match = /^(\d+)_/.exec(name);
  if (!match) throw new Error(`unexpected migration name ${name}`);
  return Number.parseInt(match[1], 10);
}

function appliedNames(db: Database.Database): string[] {
  return (db.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[]).map((row) => row.name);
}

describe('从迁移 000–033 升级到 034（plugin_orphan_data）', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  function openMemory(): Database.Database {
    const db = new Database(':memory:');
    dbs.push(db);
    return db;
  }

  it('旧库跑 034 后含 plugin_orphan_data（含索引与主键），再跑一次是空操作', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((migration) => migrationNumber(migration.name) <= 33);
    const newer = all.filter((migration) => migrationNumber(migration.name) >= 34);

    expect(legacy).toHaveLength(34);
    // 断言真正的风险：**迁移编号唯一**（同号迁移会让顺序不确定，曾撞过 034）。
    // 不再固定清单：新增迁移不应迫使每个 PR 改这份测试，也不该因清单过期而误报。
    const newerNumbers = newer.map((migration) => migrationNumber(migration.name));
    expect(new Set(newerNumbers).size).toBe(newerNumbers.length);
    // 已知基线仍在（防回退）。
    const newerNames = newer.map((migration) => migration.name);
    for (const expected of [
      '034_plugin_orphan_data',
      '035_icebreaker_checkins',
      '036_student_read_notifications_created_at',
      '037_plugin_config_scopes',
    ]) {
      expect(newerNames).toContain(expected);
    }

    const db = openMemory();
    runMigrations(db, legacy);
    expect(appliedNames(db).some((name) => migrationNumber(name) >= 34)).toBe(false);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_orphan_data'").get(),
    ).toBeFalsy();

    expect(runMigrations(db, all)).toEqual([]);
    expect(appliedNames(db)).toContain('034_plugin_orphan_data');

    // 表结构：11 列，主键为 (manifest_id, plugin_id)
    const columns = db.prepare('PRAGMA table_info(plugin_orphan_data)').all() as {
      name: string;
      pk: number;
      notnull: number;
    }[];
    expect(columns.map((column) => column.name)).toEqual([
      'manifest_id',
      'plugin_id',
      'plugin_name',
      'plugin_version',
      'table_prefixes',
      'table_names',
      'row_count',
      'storage_keys',
      'migration_version',
      'last_export_path',
      'uninstalled_at',
    ]);
    expect(
      columns
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name),
    ).toEqual(['manifest_id', 'plugin_id']);

    // 登记表初始为空，且按 manifest 查询走索引
    expect((db.prepare('SELECT COUNT(*) AS n FROM plugin_orphan_data').get() as { n: number }).n).toBe(0);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_plugin_orphan_data_manifest'").get(),
    ).toBeTruthy();

    // 幂等：第二次迁移不改动任何已应用记录
    const before = db.prepare('SELECT name, checksum, applied_at FROM _migrations ORDER BY name').all();
    expect(runMigrations(db, all)).toEqual([]);
    expect(db.prepare('SELECT name, checksum, applied_at FROM _migrations ORDER BY name').all()).toEqual(before);
  });

  it('旧库里的插件数据不受 034 影响（表与存储键原样保留）', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((migration) => migrationNumber(migration.name) <= 33);
    const db = openMemory();
    runMigrations(db, legacy);

    // 模拟一个装了插件的旧库：plugins 行 + 私有表 + 存储键
    db.prepare(
      'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      '019f-uuid',
      'Legacy Plugin',
      JSON.stringify({ id: 'ext-legacy', name: 'Legacy Plugin', version: '1.0.0', main: 'index.js' }),
      '',
      '/tmp/ext-legacy/index.js',
      'installed',
      1,
      'esm',
      '1.0.0',
    );
    db.exec(`CREATE TABLE plugin_019f_uuid_scores (id INTEGER PRIMARY KEY, score INTEGER)`);
    db.prepare('INSERT INTO plugin_019f_uuid_scores (score) VALUES (?)').run(42);
    db.prepare('INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(
      'ext-legacy',
      'config:theme',
      'dark',
      1,
    );

    runMigrations(db, all);

    expect((db.prepare('SELECT COUNT(*) AS n FROM plugins').get() as { n: number }).n).toBe(1);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM plugin_019f_uuid_scores WHERE score = 42').get() as { n: number }).n,
    ).toBe(1);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM plugin_storage').get() as { n: number }).n,
    ).toBe(1);
  });
});
