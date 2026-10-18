/**
 * 迁移 037：插件配置分层（平台 → 学校 → 班级）—— Issue #151。
 *
 * 重点是「旧库升级无感」：现有 `plugin_storage` 里的 `config:*` 值必须原样
 * 搬到平台层，且二次迁移是空操作。
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

describe('迁移 037 · 插件配置分层', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    while (dbs.length > 0) dbs.pop()?.close();
  });

  it('旧库升级：config:* 值搬到平台层，二次迁移幂等', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((migration) => migrationNumber(migration.name) <= 36);
    const db = new Database(':memory:');
    dbs.push(db);

    expect(legacy.map((m) => m.name)).not.toContain('037_plugin_config_scopes');
    runMigrations(db, legacy);

    // 模拟旧版本 ConfigService 写入的配置（单层，等价平台层）
    db.prepare(
      `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run('@ext/demo', 'config:maxQuestions', '42', 1700000000000);

    runMigrations(db, all);

    const migrated = db
      .prepare('SELECT plugin_id, scope_type, scope_id, key, value FROM plugin_config ORDER BY key')
      .all() as Array<{ plugin_id: string; scope_type: string; scope_id: string; key: string; value: string }>;
    expect(migrated).toEqual([
      { plugin_id: '@ext/demo', scope_type: 'platform', scope_id: '', key: 'maxQuestions', value: '42' },
    ]);

    // 二次迁移不重复写入、不产生新行
    expect(runMigrations(db, all)).toEqual([]);
    const count = db.prepare('SELECT COUNT(*) AS c FROM plugin_config').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('表结构支持同一 key 在不同作用域并存', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    const insert = db.prepare(
      `INSERT INTO plugin_config (plugin_id, scope_type, scope_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('@ext/demo', 'platform', '', 'weight', '10', 1);
    insert.run('@ext/demo', 'class', 'cls-1', 'weight', '20', 2);

    const rows = db
      .prepare("SELECT scope_type, value FROM plugin_config WHERE key = 'weight' ORDER BY scope_type")
      .all() as Array<{ scope_type: string; value: string }>;
    expect(rows).toEqual([
      { scope_type: 'class', value: '20' },
      { scope_type: 'platform', value: '10' },
    ]);
  });
});
