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
  ensurePluginSdkSymlink,
  fixtureIntegrityIssues,
  HttpSession,
  installPluginZip,
  isPluginActive,
  pluginManifestId,
  readAppliedMigrations,
  readPluginStorageMarker,
  rebasePluginPaths,
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

  it('恢复时把 plugins.file_path 从构库目录重定位到新数据目录', async () => {
    // 构库：数据目录 A，DB 里写的是 A/plugins/<id>/index.js（ZIP 安装就是这样落库的）。
    const sourceDir = makeTempDir('ol-upgrade-rebase-source-');
    const sourceDbPath = path.join(sourceDir, 'educational_os.db');
    const sourceDb = new Database(sourceDbPath);
    sourceDb.exec('CREATE TABLE plugins (id TEXT PRIMARY KEY, file_path TEXT);');
    const pluginDir = path.join(sourceDir, 'plugins', 'plugin-uuid-1');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'export default {};\n');
    sourceDb
      .prepare('INSERT INTO plugins (id, file_path) VALUES (?, ?)')
      .run('plugin-uuid-1', path.join(pluginDir, 'index.js'));
    sourceDb.close();

    const metadata: FixtureMetadata = {
      label: 'unit-test',
      platformVersion: '0.0.0-test',
      createdAt: new Date().toISOString(),
      migrations: [],
      tables: ['plugins'],
      plugins: [{ manifestId: '@ext/demo', dbId: 'plugin-uuid-1', version: '1.0.0' }],
      sample: { classId: 'c1', className: '一班', studentIds: [], studentNumbers: [] },
      markerKey: 'unused',
      markerValue: 'unused',
    };
    const fixtureFile = path.join(makeTempDir('ol-upgrade-rebase-fixture-'), 'fixture.zip');
    await snapshotFixture({ dataDir: sourceDir, outFile: fixtureFile, metadata });

    // 校验：换到数据目录 B，file_path 必须指向 B 下真实存在的同一个文件。
    const restoredDir = makeTempDir('ol-upgrade-rebase-restored-');
    await restoreFixture(fixtureFile, restoredDir);
    const restoredDb = new Database(path.join(restoredDir, 'educational_os.db'), { readonly: true });
    const row = restoredDb.prepare('SELECT file_path FROM plugins WHERE id = ?').get('plugin-uuid-1') as {
      file_path: string;
    };
    restoredDb.close();

    expect(row.file_path).toBe(path.join(restoredDir, 'plugins', 'plugin-uuid-1', 'index.js'));
    expect(fs.existsSync(row.file_path)).toBe(true);
    expect(row.file_path.startsWith(sourceDir)).toBe(false);
  });

  it('重定位只改 plugin 目录内的路径，不动其它绝对路径', () => {
    const dataDir = makeTempDir('ol-upgrade-rebase-guard-');
    const dbPath = path.join(dataDir, 'educational_os.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE plugins (id TEXT PRIMARY KEY, file_path TEXT);');
    const outside = path.join(dataDir, 'elsewhere', 'index.js');
    db.prepare('INSERT INTO plugins (id, file_path) VALUES (?, ?)').run('p1', outside);
    db.prepare('INSERT INTO plugins (id, file_path) VALUES (?, ?)').run('p2', '');
    db.close();

    expect(rebasePluginPaths(dbPath, dataDir)).toBe(0);
    const check = new Database(dbPath, { readonly: true });
    expect(
      (check.prepare('SELECT file_path FROM plugins WHERE id = ?').get('p1') as { file_path: string }).file_path,
    ).toBe(outside);
    check.close();
  });

  it('恢复后重建插件 SDK 解析链接（fixture 不携带构库机器的悬空链接）', async () => {
    // 构库：数据目录 A，插件目录旁有宿主建的 SDK 链接（v0.6.1 inline 激活时创建），
    // target 是构库机器的绝对路径 —— zip 打包跳过 symlink，fixture 里没有它。
    const sourceDir = makeTempDir('ol-upgrade-sdk-source-');
    const sourceDbPath = path.join(sourceDir, 'educational_os.db');
    const sourceDb = new Database(sourceDbPath);
    sourceDb.exec('CREATE TABLE plugins (id TEXT PRIMARY KEY, file_path TEXT);');
    const pluginDir = path.join(sourceDir, 'plugins', 'plugin-uuid-1');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'export default {};\n');
    sourceDb
      .prepare('INSERT INTO plugins (id, file_path) VALUES (?, ?)')
      .run('plugin-uuid-1', path.join(pluginDir, 'index.js'));
    sourceDb.close();
    const buildMachineLink = path.join(sourceDir, 'plugins', 'node_modules', '@openlearn', 'plugin-sdk');
    fs.mkdirSync(path.dirname(buildMachineLink), { recursive: true });
    fs.symlinkSync(path.join(sourceDir, 'gone-with-the-build-machine'), buildMachineLink, 'junction');

    const metadata: FixtureMetadata = {
      label: 'unit-test',
      platformVersion: '0.0.0-test',
      createdAt: new Date().toISOString(),
      migrations: [],
      tables: ['plugins'],
      plugins: [{ manifestId: '@ext/demo', dbId: 'plugin-uuid-1', version: '1.0.0' }],
      sample: { classId: 'c1', className: '一班', studentIds: [], studentNumbers: [] },
      markerKey: 'unused',
      markerValue: 'unused',
    };
    const fixtureFile = path.join(makeTempDir('ol-upgrade-sdk-fixture-'), 'fixture.zip');
    await snapshotFixture({ dataDir: sourceDir, outFile: fixtureFile, metadata });

    // 校验：恢复到数据目录 B 后，链接必须存在且解析到当前机器的宿主 SDK。
    const restoredDir = makeTempDir('ol-upgrade-sdk-restored-');
    await restoreFixture(fixtureFile, restoredDir);
    const linkPath = path.join(restoredDir, 'plugins', 'node_modules', '@openlearn', 'plugin-sdk');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(linkPath)).toBe(true);
    const sdkPackage = JSON.parse(fs.readFileSync(path.join(linkPath, 'package.json'), 'utf8')) as { name: string };
    expect(sdkPackage.name).toBe('@openlearn/plugin-sdk');
    expect(fs.realpathSync(linkPath).startsWith(sourceDir)).toBe(false);
  });

  it('恢复时把挡路的悬空 SDK 链接换掉，而不是 EEXIST 崩溃', async () => {
    const sourceDir = makeTempDir('ol-upgrade-sdk-dangling-source-');
    const sourceDb = new Database(path.join(sourceDir, 'educational_os.db'));
    sourceDb.exec('CREATE TABLE plugins (id TEXT PRIMARY KEY, file_path TEXT);');
    sourceDb.close();
    const metadata: FixtureMetadata = {
      label: 'unit-test',
      platformVersion: '0.0.0-test',
      createdAt: new Date().toISOString(),
      migrations: [],
      tables: ['plugins'],
      plugins: [],
      sample: { classId: 'c1', className: '一班', studentIds: [], studentNumbers: [] },
      markerKey: 'unused',
      markerValue: 'unused',
    };
    const fixtureFile = path.join(makeTempDir('ol-upgrade-sdk-dangling-fixture-'), 'fixture.zip');
    await snapshotFixture({ dataDir: sourceDir, outFile: fixtureFile, metadata });

    const restoredDir = makeTempDir('ol-upgrade-sdk-dangling-restored-');
    const dangling = path.join(restoredDir, 'plugins', 'node_modules', '@openlearn', 'plugin-sdk');
    fs.mkdirSync(path.dirname(dangling), { recursive: true });
    fs.symlinkSync(path.join(restoredDir, 'nowhere'), dangling, 'junction');

    await restoreFixture(fixtureFile, restoredDir);
    expect(fs.existsSync(dangling)).toBe(true);
  });

  it('ensurePluginSdkSymlink 幂等：已有可用链接时原样保留', () => {
    const dataDir = makeTempDir('ol-upgrade-sdk-idempotent-');
    const first = ensurePluginSdkSymlink(dataDir);
    expect(first).not.toBeNull();
    const firstTarget = fs.realpathSync(first as string);

    const second = ensurePluginSdkSymlink(dataDir);
    expect(second).toBe(first);
    expect(fs.realpathSync(second as string)).toBe(firstTarget);
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

describe('fixture 插件安装请求头', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('上传本地测试插件 ZIP 时显式声明 x-allow-unsigned，并保留能力/公开路由批准', async () => {
    // 签名门禁（server/routes/plugins.ts 的 B2 安全基线）要求未签名包必须由管理员
    // 显式声明 x-allow-unsigned 才放行。缺这个头时 build-fixture 会在带门禁的
    // 服务端（v0.7.0+）上拿到 400 COMMUNITY_ATTESTATION_REQUIRED，
    // 导致「Publish release fixture」与「Upgrade from last release」双双转红。
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ success: true, pluginId: 'p1', manifest: { id: '@ext/demo' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const zipPath = path.join(makeTempDir('ol-upgrade-plugin-zip-'), 'ext-demo.zip');
    fs.writeFileSync(zipPath, 'PK\u0003\u0004not-a-real-zip');

    const session = new HttpSession('http://upgrade.test');
    const result = await installPluginZip(session, zipPath);

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://upgrade.test/api/plugins/upload-zip-raw');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-allow-unsigned']).toBe('true');
    expect(headers['x-approve-capabilities']).toBe('true');
    expect(headers['x-approve-public-routes']).toBe('true');
    expect(headers['content-type']).toBe('application/zip');
    expect(headers['x-filename']).toBe('ext-demo.zip');
  });
});
