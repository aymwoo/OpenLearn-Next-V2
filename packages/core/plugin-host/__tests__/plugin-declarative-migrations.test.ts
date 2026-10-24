import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runPluginDeclarativeMigrations,
  loadPluginMigrations,
  rollbackPluginDeclarativeMigration,
  getPluginAppliedMigrations,
  parseMigrationFileName,
} from '../declarative-migrator.js';
import { PluginMigrationExecutionError, PluginMigrationDowngradeError } from '../errors.js';
import { PluginHost } from '../index.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import { PluginState } from '../types.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';

describe('Plugin Declarative Migrations (Issue #142)', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-plugin-migration-test-'));
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('parseMigrationFileName', () => {
    it('正确解析前导数字版本号与文件基名', () => {
      expect(parseMigrationFileName('001_initial.sql')).toEqual({
        version: 1,
        baseName: '001_initial',
      });
      expect(parseMigrationFileName('02_add_field.sql')).toEqual({
        version: 2,
        baseName: '02_add_field',
      });
      expect(parseMigrationFileName('15-new-table.sql')).toEqual({
        version: 15,
        baseName: '15-new-table',
      });
      expect(parseMigrationFileName('setup.sql')).toEqual({
        version: 0,
        baseName: 'setup',
      });
    });
  });

  describe('loadPluginMigrations', () => {
    it('按数字版本号自然排序加载迁移文件', () => {
      fs.writeFileSync(path.join(tmpDir, '002_second.sql'), '-- UP\nSELECT 2;');
      fs.writeFileSync(path.join(tmpDir, '001_first.sql'), '-- UP\nSELECT 1;\n-- DOWN\nSELECT -1;');
      fs.writeFileSync(path.join(tmpDir, '010_tenth.sql'), '-- UP\nSELECT 10;');

      const migrations = loadPluginMigrations(tmpDir);

      expect(migrations).toHaveLength(3);
      expect(migrations.map((m) => m.name)).toEqual(['001_first', '002_second', '010_tenth']);
      expect(migrations[0].version).toBe(1);
      expect(migrations[0].up).toBe('SELECT 1;');
      expect(migrations[0].down).toBe('SELECT -1;');
      expect(migrations[1].version).toBe(2);
      expect(migrations[2].version).toBe(10);
    });
  });

  describe('runPluginDeclarativeMigrations 核心引擎', () => {
    it('首次执行能按序完整执行所有迁移，并展开 {{prefix}} 占位符', () => {
      fs.writeFileSync(
        path.join(tmpDir, '001_initial.sql'),
        `-- UP
        CREATE TABLE {{prefix}}tasks (id TEXT PRIMARY KEY, title TEXT);
        -- DOWN
        DROP TABLE IF EXISTS {{prefix}}tasks;`,
      );
      fs.writeFileSync(
        path.join(tmpDir, '002_add_done.sql'),
        `-- UP
        ALTER TABLE {{prefix}}tasks ADD COLUMN done INTEGER DEFAULT 0;
        -- DOWN
        SELECT 1;`,
      );

      const result = runPluginDeclarativeMigrations(db, 'my-plugin-id', tmpDir, {
        tablePrefix: 'plugin_my_plugin_id_',
      });

      expect(result.appliedCount).toBe(2);
      expect(result.appliedNames).toEqual(['001_initial', '002_add_done']);
      expect(result.maxVersion).toBe(2);

      // 验证表被创建且包含新列
      db.prepare('INSERT INTO plugin_my_plugin_id_tasks (id, title, done) VALUES (?, ?, ?)').run('t-1', '写代码', 1);
      const row = db.prepare('SELECT * FROM plugin_my_plugin_id_tasks WHERE id = ?').get('t-1') as any;
      expect(row.title).toBe('写代码');
      expect(row.done).toBe(1);

      // 验证元表记录
      const records = getPluginAppliedMigrations(db, 'my-plugin-id');
      expect(records).toHaveLength(2);
      expect(records[0].name).toBe('001_initial');
      expect(records[0].version).toBe(1);
      expect(records[1].name).toBe('002_add_done');
      expect(records[1].version).toBe(2);
    });

    it('再次执行具有幂等性，不重复应用已执行项', () => {
      fs.writeFileSync(
        path.join(tmpDir, '001_init.sql'),
        `-- UP
        CREATE TABLE t_idemp (id INT);`,
      );

      const res1 = runPluginDeclarativeMigrations(db, 'p1', tmpDir);
      expect(res1.appliedCount).toBe(1);

      const res2 = runPluginDeclarativeMigrations(db, 'p1', tmpDir);
      expect(res2.appliedCount).toBe(0);
      expect(res2.appliedNames).toEqual([]);
    });

    it('单步迁移在事务中执行，若某步失败立即回滚本步并抛出 PluginMigrationExecutionError', () => {
      fs.writeFileSync(
        path.join(tmpDir, '001_success.sql'),
        `-- UP
        CREATE TABLE t_valid (id INT);`,
      );
      fs.writeFileSync(
        path.join(tmpDir, '002_fail.sql'),
        `-- UP
        CREATE TABLE t_broken (id INT);
        THIS IS INVALID SQL;`,
      );
      fs.writeFileSync(
        path.join(tmpDir, '003_never_run.sql'),
        `-- UP
        CREATE TABLE t_never (id INT);`,
      );

      expect(() => {
        runPluginDeclarativeMigrations(db, 'p-err', tmpDir);
      }).toThrowError(PluginMigrationExecutionError);

      // 001 成功生效
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_valid'").get()).toBeDefined();

      // 002 失败并回滚：t_broken 表不应存在
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_broken'").get()).toBeUndefined();

      // 003 未被执行：t_never 表不应存在
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_never'").get()).toBeUndefined();

      // 元表中只有 001，没有 002 和 003
      const records = getPluginAppliedMigrations(db, 'p-err');
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('001_success');
    });

    it('拒绝版本降级（Downgrade Protection）：当数据库版本高于声明版本时抛出 PluginMigrationDowngradeError', () => {
      // 模拟先安装了包含 001 和 002 的高版本
      fs.writeFileSync(path.join(tmpDir, '001_init.sql'), '-- UP\nCREATE TABLE t_down (id INT);');
      fs.writeFileSync(path.join(tmpDir, '002_v2.sql'), '-- UP\nALTER TABLE t_down ADD COLUMN v2 INT;');

      runPluginDeclarativeMigrations(db, 'p-downgrade', tmpDir);
      expect(getPluginAppliedMigrations(db, 'p-downgrade')).toHaveLength(2);

      // 模拟现在降级安装旧版包，目录中只包含 001_init.sql
      fs.rmSync(path.join(tmpDir, '002_v2.sql'));

      expect(() => {
        runPluginDeclarativeMigrations(db, 'p-downgrade', tmpDir);
      }).toThrowError(PluginMigrationDowngradeError);
    });

    it('rollbackPluginDeclarativeMigration 能够正确执行 DOWN 回滚并清理元表记录', () => {
      fs.writeFileSync(
        path.join(tmpDir, '001_rollback_test.sql'),
        `-- UP
        CREATE TABLE t_rb (id INT);
        -- DOWN
        DROP TABLE IF EXISTS t_rb;`,
      );

      runPluginDeclarativeMigrations(db, 'p-rb', tmpDir);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_rb'").get()).toBeDefined();
      expect(getPluginAppliedMigrations(db, 'p-rb')).toHaveLength(1);

      const migrationItem = loadPluginMigrations(tmpDir)[0];
      rollbackPluginDeclarativeMigration(db, 'p-rb', migrationItem);

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_rb'").get()).toBeUndefined();
      expect(getPluginAppliedMigrations(db, 'p-rb')).toHaveLength(0);
    });
  });

  describe('PluginHost 激活生命周期集成', () => {
    let pluginHost: PluginHost;
    let pluginsRootDir: string;

    beforeEach(async () => {
      pluginsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-plugins-root-'));

      db.exec(`
        CREATE TABLE IF NOT EXISTS plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          manifest TEXT NOT NULL,
          source_code TEXT NOT NULL,
          file_path TEXT,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          source TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          correlationId TEXT
        );
        CREATE TABLE IF NOT EXISTS plugin_storage (
          plugin_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (plugin_id, key)
        );
      `);

      const registry = new ServiceRegistry();
      await registry.register(ICommandBusServiceToken, {
        execute: vi.fn(),
        registerHandler: vi.fn(),
        unregisterHandler: vi.fn(),
        createCommand: vi.fn(),
      } as any);
      await registry.register(IEventBusServiceToken, {
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      } as any);
      await registry.register(IActionRegistryServiceToken, {
        register: vi.fn(),
        unregister: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
      } as any);
      await registry.register(ICapabilityServiceToken, {
        register: vi.fn(),
        unregister: vi.fn(),
        hasCapability: vi.fn(),
      } as any);
      await registry.register(IProcessServiceToken, {
        register: vi.fn(),
        unregister: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
      } as any);
      await registry.register(IStorageServiceToken, {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any);
      await registry.register(IAIServiceToken, {
        chat: vi.fn(),
        complete: vi.fn(),
      } as any);

      const mockLoader: EsmLoader = {
        load: vi.fn(async () => ({
          manifest: { id: 'ext-demo', name: 'Demo', version: '1.0.0', main: 'index.js' },
          activate: async () => {},
        })),
      } as unknown as EsmLoader;

      pluginHost = new PluginHost(registry, mockLoader, db, pluginsRootDir);
    });

    afterEach(() => {
      if (fs.existsSync(pluginsRootDir)) {
        fs.rmSync(pluginsRootDir, { recursive: true, force: true });
      }
    });

    it('已安装插件在激活时自动触发 migrations 目录下的声明式迁移', async () => {
      const pid = 'plugin-uuid-1';
      const pluginDir = path.join(pluginsRootDir, pid);
      const migDir = path.join(pluginDir, 'migrations');
      fs.mkdirSync(migDir, { recursive: true });

      fs.writeFileSync(
        path.join(migDir, '001_init.sql'),
        `-- UP
        CREATE TABLE {{prefix}}demo_items (id TEXT PRIMARY KEY, val TEXT);`,
      );

      const manifest = { id: 'ext-demo', name: 'Demo Plugin', version: '1.0.0', main: 'index.js' };
      db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        pid,
        'Demo Plugin',
        JSON.stringify(manifest),
        'export async function activate() {}',
        path.join(pluginDir, 'index.js'),
        'installed',
        Date.now(),
      );

      await pluginHost.activatePlugin(pid);

      expect(pluginHost.getPluginState(pid)).toBe(PluginState.ACTIVE);

      // 验证通过 {{prefix}} 展开的表已存在
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_%_demo_items'")
        .get();
      expect(tableCheck).toBeDefined();

      const records = getPluginAppliedMigrations(db, pid);
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('001_init');
    });

    it('当声明式迁移报错时，activatePlugin 失败且插件进入 ERROR 状态', async () => {
      const pid = 'plugin-uuid-err';
      const pluginDir = path.join(pluginsRootDir, pid);
      const migDir = path.join(pluginDir, 'migrations');
      fs.mkdirSync(migDir, { recursive: true });

      fs.writeFileSync(path.join(migDir, '001_bad.sql'), '-- UP\nSYNTAX ERROR SQL;');

      const manifest = { id: 'ext-bad', name: 'Bad Plugin', version: '1.0.0', main: 'index.js' };
      db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        pid,
        'Bad Plugin',
        JSON.stringify(manifest),
        'export async function activate() {}',
        path.join(pluginDir, 'index.js'),
        'installed',
        Date.now(),
      );

      await expect(pluginHost.activatePlugin(pid)).rejects.toThrow();

      expect(pluginHost.getPluginState(pid)).toBe(PluginState.ERROR);
    });
  });
});
