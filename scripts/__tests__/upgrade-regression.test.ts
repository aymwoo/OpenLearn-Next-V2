// @vitest-environment node
/**
 * 升级回归工具链的单元测试（Issue #147）。
 *
 * 这里不启动真实服务（那由 build-fixture / verify-upgrade 在 CI 里做），
 * 只覆盖三类最容易悄悄失效的逻辑：
 * 1. 迁移漂移 / fixture 完整性比较
 * 2. 快照 → 恢复的可逆性
 * 3. **反向验证**：故意注入非幂等迁移时，门禁必须失败（否则这个作业就是绿漆）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations, type Migration } from '../../packages/core/db/migrator.js';
import {
  compareMigrations,
  fixtureIntegrityIssues,
  isPluginActive,
  pluginManifestId,
  readAppliedMigrations,
  readPluginStorageMarker,
  restoreFixture,
  snapshotFixture,
  writePluginStorageMarker,
  type FixtureMetadata,
} from '../upgrade-regression/lib.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
  delete process.env.MIGRATION_CHECKSUM_STRICT;
});

const V1_MIGRATIONS: Migration[] = [
  {
    name: '001_create_legacy_records',
    up: 'CREATE TABLE legacy_records (id TEXT PRIMARY KEY, payload TEXT);',
    down: 'DROP TABLE legacy_records;',
  },
];

describe('迁移比较', () => {
  it('识别 checksum 漂移、待应用迁移与旧库独有的迁移记录', () => {
    const db = new Database(':memory:');
    runMigrations(db, V1_MIGRATIONS);

    const current = [
      // 已执行迁移的 UP 被改写 —— 这是升级回归最需要拦住的场景
      { name: '001_create_legacy_records', up: `${V1_MIGRATIONS[0].up}\n-- 发布后被改过` },
      { name: '002_add_column', up: 'ALTER TABLE legacy_records ADD COLUMN note TEXT;' },
    ];
    const comparison = compareMigrations(readAppliedMigrations(db), current);

    expect(comparison.drift.map((row) => row.name)).toEqual(['001_create_legacy_records']);
    expect(comparison.pending).toEqual(['002_add_column']);
    expect(comparison.unknown).toEqual([]);
    db.close();
  });

  it('旧库里有当前仓库不认识的迁移时单独报告，不混入 drift', () => {
    const db = new Database(':memory:');
    runMigrations(db, [
      ...V1_MIGRATIONS,
      { name: '099_release_only', up: 'CREATE TABLE release_only (id TEXT);', down: '' },
    ]);
    const comparison = compareMigrations(readAppliedMigrations(db), V1_MIGRATIONS);
    expect(comparison.unknown).toEqual(['099_release_only']);
    expect(comparison.drift).toEqual([]);
    db.close();
  });

  it('checksum 漂移在严格模式下直接抛错（升级作业不会带着漂移继续跑）', () => {
    const db = new Database(':memory:');
    runMigrations(db, V1_MIGRATIONS);
    process.env.MIGRATION_CHECKSUM_STRICT = 'true';

    const modified: Migration[] = [{ ...V1_MIGRATIONS[0], up: `${V1_MIGRATIONS[0].up}\n-- 事后修改` }];
    expect(() => runMigrations(db, modified)).toThrow(/已执行迁移的 UP 脚本在应用后被修改过/);
    db.close();
  });
});

describe('反向验证：非幂等迁移必须让门禁失败', () => {
  it('重复建表（没有 IF NOT EXISTS）在旧库上应用时抛错，且不留下半条迁移记录', () => {
    const db = new Database(':memory:');
    runMigrations(db, V1_MIGRATIONS);

    // 模拟「新迁移写错」：旧库里已经有 legacy_records，却又写了一条无保护的 CREATE TABLE
    const broken: Migration[] = [
      ...V1_MIGRATIONS,
      { name: '002_recreate_legacy_records', up: 'CREATE TABLE legacy_records (id TEXT PRIMARY KEY);', down: '' },
    ];
    expect(() => runMigrations(db, broken)).toThrow(/already exists/);
    expect(readAppliedMigrations(db).map((row) => row.name)).toEqual(['001_create_legacy_records']);
    db.close();
  });

  it('迁移中途失败时事务回滚，不留下部分表', () => {
    const db = new Database(':memory:');
    const failing: Migration[] = [
      {
        name: '001_half_broken',
        up: 'CREATE TABLE half_table (id TEXT);\nTHIS IS NOT SQL;',
        down: '',
      },
    ];
    expect(() => runMigrations(db, failing)).toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_table'").all() as {
      name: string;
    }[];
    expect(tables).toEqual([]);
    db.close();
  });
});

describe('fixture 完整性', () => {
  it('metadata 与库内迁移一致时无问题，被篡改时报出差异', () => {
    const db = new Database(':memory:');
    runMigrations(db, V1_MIGRATIONS);
    const applied = readAppliedMigrations(db);
    const metadata = { migrations: applied };

    expect(fixtureIntegrityIssues(metadata, applied)).toEqual([]);

    const tampered: FixtureMetadata['migrations'] = [{ name: applied[0].name, checksum: 'deadbeef' }];
    const issues = fixtureIntegrityIssues({ migrations: tampered }, applied);
    expect(issues.join('\n')).toMatch(/checksum 不一致/);

    expect(fixtureIntegrityIssues({ migrations: [] }, applied).join('\n')).toMatch(/迁移条数不一致/);
    db.close();
  });
});

describe('fixture 快照与恢复', () => {
  it('快照包含数据库、插件目录与 metadata，恢复后内容一致', async () => {
    const dataDir = makeTempDir('ol-upgrade-snapshot-');
    const dbPath = path.join(dataDir, 'educational_os.db');
    const db = new Database(dbPath);
    runMigrations(db, V1_MIGRATIONS);
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT,
        key TEXT,
        value TEXT,
        updated_at INTEGER,
        PRIMARY KEY (plugin_id, key)
      );
    `);
    writePluginStorageMarker(db, 'plugin-uuid-1', 'upgrade_regression_marker', 'seeded');
    db.close();

    fs.mkdirSync(path.join(dataDir, 'plugins', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'plugins', 'demo', 'index.js'), 'export default {};\n');
    fs.mkdirSync(path.join(dataDir, 'storage', 'courseware'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'storage', 'courseware', 'a.txt'), 'hello');

    const metadataDb = new Database(dbPath, { readonly: true });
    const appliedMigrations = readAppliedMigrations(metadataDb);
    metadataDb.close();

    const metadata: FixtureMetadata = {
      label: 'unit-test',
      platformVersion: '0.0.0-test',
      createdAt: new Date().toISOString(),
      migrations: appliedMigrations,
      tables: ['_migrations', 'legacy_records'],
      plugins: [{ manifestId: '@ext/demo', dbId: 'plugin-uuid-1', version: '1.0.0' }],
      sample: { classId: 'c1', className: '一班', studentIds: ['s1'], studentNumbers: ['S001'] },
      markerKey: 'upgrade_regression_marker',
      markerValue: 'seeded',
    };

    const fixtureFile = path.join(makeTempDir('ol-upgrade-fixture-out-'), 'fixture.zip');
    await snapshotFixture({ dataDir, outFile: fixtureFile, metadata });
    expect(fs.statSync(fixtureFile).size).toBeGreaterThan(0);

    const restoredDir = makeTempDir('ol-upgrade-restored-');
    const restored = await restoreFixture(fixtureFile, restoredDir);

    expect(restored).toEqual(metadata);
    expect(fs.readFileSync(path.join(restoredDir, 'plugins', 'demo', 'index.js'), 'utf8')).toContain('export default');
    expect(fs.readFileSync(path.join(restoredDir, 'storage', 'courseware', 'a.txt'), 'utf8')).toBe('hello');

    const restoredDb = new Database(path.join(restoredDir, 'educational_os.db'), { readonly: true });
    expect(readPluginStorageMarker(restoredDb, 'plugin-uuid-1', 'upgrade_regression_marker')).toBe('seeded');
    expect(readAppliedMigrations(restoredDb).map((row) => row.name)).toEqual(['001_create_legacy_records']);
    restoredDb.close();
  });
});

describe('插件状态判定', () => {
  it('state 或 status 任一为 active 才算激活', () => {
    expect(isPluginActive({ id: '1', name: 'a', version: '1', state: 'active' })).toBe(true);
    expect(isPluginActive({ id: '1', name: 'a', version: '1', status: 'active' })).toBe(true);
    expect(isPluginActive({ id: '1', name: 'a', version: '1', state: 'inactive' })).toBe(false);
    expect(isPluginActive(undefined)).toBe(false);
  });

  it('从 manifest 字符串里解析 manifest.id，解析失败返回 null', () => {
    expect(
      pluginManifestId({ id: 'uuid', name: 'a', version: '1', manifest: JSON.stringify({ id: '@ext/demo' }) }),
    ).toBe('@ext/demo');
    expect(pluginManifestId({ id: 'uuid', name: 'a', version: '1', manifest: '{not json' })).toBeNull();
    expect(pluginManifestId({ id: 'uuid', name: 'a', version: '1' })).toBeNull();
  });
});
