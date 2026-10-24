/**
 * Issue #141 — 插件卸载数据语义测试。
 *
 * 验收标准：
 * 1. 默认卸载（keep）后插件私有表与 `plugin_migrations` 记录仍在，并被登记为孤立数据；
 * 2. 重装同 manifest.id 复用原安装 UUID，表 / 迁移版本 / 存储键全部读回；
 * 3. purge 前生成 SQL 归档，随后才删表清键，并写 `plugin.data_purged` 审计；
 * 4. purge 导出失败时**中止卸载**：数据、DB 行、文件都保持完好；
 * 5. 无数据的插件卸载不产生孤立数据登记（避免管理页噪声）。
 *
 * 使用内存 SQLite + mock EsmLoader，不依赖真实服务。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import type { PluginModule } from '../../esm-loader/esm-loader.js';
import { PluginHost } from '../index.js';
import { pluginTablePrefix } from '../plugin-tables.js';
import { listOrphanData, findAdoptableOrphanData, ORPHAN_DATA_TABLE } from '../orphan-data.js';
import { setAuditSinkForTests, type AuditRecord } from '../../observability/audit-log.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';
import type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
  IPointsDimensionRegistry,
  IPointsLedgerService,
} from '../../di/interfaces.js';
import { IPointsDimensionRegistryToken, IPointsLedgerServiceToken } from '../../di/interfaces.js';
import { createPluginsDir, cleanupPluginsDir } from './helpers/plugins-dir.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** 内存 DB：plugins / plugin_storage / plugin_migrations 三张表都在，贴近真实库。 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT,
      manifest TEXT,
      source_code TEXT,
      file_path TEXT,
      status TEXT,
      created_at INTEGER,
      loader_version TEXT,
      zip_package BLOB,
      version TEXT,
      execution_mode TEXT DEFAULT 'inline'
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT,
      key TEXT,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      plugin_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `);
  return db;
}

/** 与 plugin-host.test.ts 同款的 9 个 mock services。 */
function createMockServices(): Record<string, unknown> {
  return {
    commandBus: {
      execute: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      createCommand: vi.fn().mockResolvedValue({}),
      setInterceptor: vi.fn().mockResolvedValue(undefined),
    } as ICommandBusService,
    eventBus: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    } as IEventBusService,
    actionRegistry: {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      getAllActions: vi.fn().mockResolvedValue([]),
      getAgentTools: vi.fn().mockResolvedValue([]),
      getActionByToolName: vi.fn().mockResolvedValue(undefined),
      getActionByCommandType: vi.fn().mockResolvedValue(undefined),
    } as IActionRegistryService,
    capability: {
      grant: vi.fn().mockResolvedValue(undefined),
      revokeAll: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(true),
    } as ICapabilityService,
    processManager: {
      spawn: vi.fn().mockResolvedValue('process-id'),
      kill: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      registerInterval: vi.fn().mockResolvedValue('interval-id'),
      restore: vi.fn().mockResolvedValue(undefined),
    } as IProcessService,
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as IStorageService,
    ai: {
      generateText: vi.fn().mockResolvedValue('AI response'),
    } as IAIService,
    pointsDimension: {
      registerDimension: vi.fn(),
      unregisterDimension: vi.fn().mockReturnValue(true),
      getDimension: vi.fn().mockReturnValue(undefined),
      listDimensions: vi.fn().mockReturnValue([]),
    } as IPointsDimensionRegistry,
    pointsLedger: {
      addPoints: vi.fn().mockResolvedValue({
        studentId: '',
        classId: '',
        dimensionId: '',
        deltaPoints: 0,
        reason: '',
        timestamp: 0,
      }),
      getLogs: vi.fn().mockResolvedValue([]),
      getStudentTotalByDimension: vi.fn().mockResolvedValue(0),
      getStudentDimensionSummary: vi.fn().mockResolvedValue({}),
    } as IPointsLedgerService,
  };
}

async function registerMockServices(sr: ServiceRegistry, services: Record<string, unknown>): Promise<void> {
  await sr.register(ICommandBusServiceToken, services.commandBus as ICommandBusService);
  await sr.register(IEventBusServiceToken, services.eventBus as IEventBusService);
  await sr.register(IActionRegistryServiceToken, services.actionRegistry as IActionRegistryService);
  await sr.register(ICapabilityServiceToken, services.capability as ICapabilityService);
  await sr.register(IProcessServiceToken, services.processManager as IProcessService);
  await sr.register(IStorageServiceToken, services.storage as IStorageService);
  await sr.register(IAIServiceToken, services.ai as IAIService);
  await sr.register(IPointsDimensionRegistryToken, services.pointsDimension as IPointsDimensionRegistry);
  await sr.register(IPointsLedgerServiceToken, services.pointsLedger as IPointsLedgerService);
}

class TestEsmLoader extends EsmLoader {
  constructor(private loadMap: Map<string, PluginModule>) {
    super();
  }

  async load(code: string): Promise<PluginModule> {
    const result = this.loadMap.get(code);
    if (result) return result;
    return {
      default: {
        manifest: { id: 'default', name: 'Default', version: '1.0.0', main: 'index.ts' },
        activate: async () => {},
      },
    };
  }
}

function makePluginModule(manifestId: string, manifestName: string): PluginModule {
  const m = { id: manifestId, name: manifestName, version: '1.0.0', main: 'index.ts' };
  return {
    default: { manifest: m, activate: async () => {} },
    manifest: m,
    activate: async () => {},
  };
}

function simpleSource(manifestId: string, manifestName: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: manifestName,
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      ctx._activated = true;
    }
  `;
}

/** 在库里造出插件私有表 / 存储键 / 迁移版本——模拟「有学生数据」的插件。 */
function seedPluginData(db: Database.Database, pluginId: string, manifestId: string): void {
  const table = `${pluginTablePrefix(pluginId)}items`;
  db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${table} (name) VALUES (?), (?)`).run('apple', 'banana');
  db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(
    pluginId,
    'config:theme',
    'dark',
    Date.now(),
  );
  db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(
    manifestId,
    'shared:notes',
    'hello',
    Date.now(),
  );
  db.prepare('INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (?, ?)').run(pluginId, 3);
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
  return !!row;
}

function count(db: Database.Database, sql: string, ...args: unknown[]): number {
  const row = db.prepare(sql).get(...args) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('uninstallPlugin — 卸载数据语义（Issue #141）', () => {
  let db: Database.Database;
  let host: PluginHost;
  let pluginsDir: string;
  let loadMap: Map<string, PluginModule>;
  let auditRecords: AuditRecord[];
  const tempDirs: string[] = [];

  beforeEach(async () => {
    pluginsDir = createPluginsDir('uninstall-data-policy');
    db = createTestDb();
    const sr = new ServiceRegistry();
    await registerMockServices(sr, createMockServices());
    loadMap = new Map();
    host = new PluginHost(sr, new TestEsmLoader(loadMap), db, pluginsDir);
    auditRecords = [];
    setAuditSinkForTests((record) => auditRecords.push(record));
  });

  afterEach(() => {
    setAuditSinkForTests(null);
    cleanupPluginsDir(pluginsDir);
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    db.close();
  });

  /** 安装一个带数据的测试插件，返回运行期 pluginId 与 manifest.id。 */
  async function installWithData(manifestId: string, name: string): Promise<{ pluginId: string; manifestId: string }> {
    const source = simpleSource(manifestId, name);
    loadMap.set(source, makePluginModule(manifestId, name));
    await host.installPlugin(source);
    const row = db.prepare('SELECT id, manifest FROM plugins ORDER BY created_at DESC LIMIT 1').get() as {
      id: string;
      manifest: string;
    };
    seedPluginData(db, row.id, manifestId);
    return { pluginId: row.id, manifestId };
  }

  function makeTempDir(tag: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `openlearn-${tag}-`));
    tempDirs.push(dir);
    return dir;
  }

  // ── keep（默认策略）────────────────────────────────────────────────────

  it('keep（默认）：表 / 迁移版本 / 存储键全部保留，并登记孤立数据', async () => {
    const { pluginId, manifestId } = await installWithData('ext-keep-data', 'Keep Data');
    const table = `${pluginTablePrefix(pluginId)}items`;

    const result = await host.uninstallPlugin(pluginId);

    expect(result).toMatchObject({
      pluginId,
      manifestId,
      dataPolicy: 'keep',
      orphanRegistered: true,
      droppedTables: 0,
    });
    expect(result.keptTables).toContain(table);
    expect(result.keptRows).toBe(2);

    // 数据全部原样保留
    expect(tableExists(db, table)).toBe(true);
    expect(count(db, `SELECT COUNT(*) AS c FROM ${table}`)).toBe(2);
    expect(count(db, `SELECT COUNT(*) AS c FROM plugin_migrations WHERE plugin_id = ?`, pluginId)).toBe(1);
    expect(
      count(
        db,
        `SELECT (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) + (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) AS c`,
        pluginId,
        manifestId,
      ),
    ).toBe(2);

    // 插件本体（DB 行）已删除
    expect(count(db, 'SELECT COUNT(*) AS c FROM plugins WHERE id = ?', pluginId)).toBe(0);

    // 孤立数据登记
    const orphans = listOrphanData(db);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      manifestId,
      pluginId,
      pluginName: 'Keep Data',
      pluginVersion: '1.0.0',
      rowCount: 2,
      storageKeys: 2,
      migrationVersion: 3,
    });
    expect(orphans[0].tableNames).toContain(table);

    // 审计：plugin.uninstalled 携带策略与保留数据量
    const uninstalled = auditRecords.filter((r) => r.event === 'plugin.uninstalled');
    expect(uninstalled).toHaveLength(1);
    expect(uninstalled[0]).toMatchObject({ pluginId, manifestId, dataPolicy: 'keep', keptRows: 2 });
  });

  it('keep 后重装同 manifest.id：复用原安装 UUID，旧表 / 迁移版本 / 存储键读回', async () => {
    const { pluginId, manifestId } = await installWithData('ext-reinstall', 'Reinstall Me');
    const table = `${pluginTablePrefix(pluginId)}items`;

    await host.uninstallPlugin(pluginId);
    expect(findAdoptableOrphanData(db, manifestId)).not.toBeNull();

    // 重装同一插件的源码
    const source = simpleSource('ext-reinstall', 'Reinstall Me');
    await host.installPlugin(source);

    // 复用原安装 UUID
    const row = db.prepare('SELECT id FROM plugins WHERE id = ?').get(pluginId) as { id: string } | undefined;
    expect(row?.id).toBe(pluginId);

    // 旧数据原样可见
    expect(count(db, `SELECT COUNT(*) AS c FROM ${table}`)).toBe(2);
    expect(count(db, `SELECT COUNT(*) AS c FROM plugin_migrations WHERE plugin_id = ?`, pluginId)).toBe(1);
    expect(
      count(
        db,
        `SELECT (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) + (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) AS c`,
        pluginId,
        manifestId,
      ),
    ).toBe(2);

    // 登记已注销（数据已回到插件名下）
    expect(listOrphanData(db)).toHaveLength(0);
    const adopted = auditRecords.filter((r) => r.event === 'plugin.orphan_data_adopted');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toMatchObject({ manifestId, pluginId, tables: 1, rows: 2 });
  });

  it('无数据的插件卸载：不产生孤立数据登记（避免管理页噪声）', async () => {
    const source = simpleSource('ext-no-data', 'No Data');
    loadMap.set(source, makePluginModule('ext-no-data', 'No Data'));
    await host.installPlugin(source);
    const { id } = db.prepare('SELECT id FROM plugins').get() as { id: string };

    const result = await host.uninstallPlugin(id);

    expect(result).toMatchObject({ dataPolicy: 'keep', orphanRegistered: false, keptTables: [], keptRows: 0 });
    expect(count(db, `SELECT COUNT(*) AS c FROM ${ORPHAN_DATA_TABLE}`)).toBe(0);
  });

  // ── purge（显式策略）──────────────────────────────────────────────────

  it('purge：先导出 SQL 归档，再删表 / 迁移记录 / 存储键，并写审计', async () => {
    const { pluginId, manifestId } = await installWithData('ext-purge', 'Purge Me');
    const table = `${pluginTablePrefix(pluginId)}items`;
    const exportDir = makeTempDir('plugin-data-exports');

    const result = await host.uninstallPlugin(pluginId, {
      dataPolicy: 'purge',
      exportDir,
      actorId: 'admin-test',
    });

    expect(result.dataPolicy).toBe('purge');
    expect(result.droppedTables).toBe(1);
    expect(result.exportFile).toBeDefined();
    expect(result.orphanRegistered).toBe(false);

    // 归档文件包含建表、数据行、迁移版本与存储键
    const file = result.exportFile!;
    expect(fs.existsSync(file)).toBe(true);
    const sql = fs.readFileSync(file, 'utf-8');
    expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).toContain(`INSERT INTO "${table}"`);
    expect(sql).toContain('apple');
    expect(sql).toContain('plugin_migrations');
    expect(sql).toContain('shared:notes');

    // 数据与插件行全部清除
    expect(tableExists(db, table)).toBe(false);
    expect(count(db, `SELECT COUNT(*) AS c FROM plugins WHERE id = ?`, pluginId)).toBe(0);
    expect(count(db, `SELECT COUNT(*) AS c FROM plugin_migrations WHERE plugin_id = ?`, pluginId)).toBe(0);
    expect(
      count(
        db,
        `SELECT (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) + (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) AS c`,
        pluginId,
        manifestId,
      ),
    ).toBe(0);
    expect(count(db, `SELECT COUNT(*) AS c FROM ${ORPHAN_DATA_TABLE}`)).toBe(0);

    // 审计：plugin.uninstalled（含策略/归档）+ plugin.data_purged
    const uninstalled = auditRecords.filter((r) => r.event === 'plugin.uninstalled');
    expect(uninstalled).toHaveLength(1);
    expect(uninstalled[0]).toMatchObject({
      pluginId,
      manifestId,
      dataPolicy: 'purge',
      actorId: 'admin-test',
      exportFile: file,
    });
    const purged = auditRecords.filter((r) => r.event === 'plugin.data_purged');
    expect(purged).toHaveLength(1);
    expect(purged[0]).toMatchObject({ pluginId, manifestId, actorId: 'admin-test', exportFile: file });
  });

  it('purge 导出失败：中止卸载，数据 / DB 行 / 文件都完好', async () => {
    const { pluginId, manifestId } = await installWithData('ext-purge-fail', 'Purge Fail');
    const table = `${pluginTablePrefix(pluginId)}items`;

    // 导出目录路径上放一个同名**文件**，mkdir 必然失败
    const blocked = path.join(makeTempDir('purge-blocked'), 'exports-as-file');
    fs.writeFileSync(blocked, 'not a directory');

    await expect(host.uninstallPlugin(pluginId, { dataPolicy: 'purge', exportDir: blocked })).rejects.toThrow();

    // 卸载没有发生：DB 行、表、迁移版本、存储键全部完好
    expect(count(db, 'SELECT COUNT(*) AS c FROM plugins WHERE id = ?', pluginId)).toBe(1);
    expect(tableExists(db, table)).toBe(true);
    expect(count(db, `SELECT COUNT(*) AS c FROM ${table}`)).toBe(2);
    expect(count(db, `SELECT COUNT(*) AS c FROM plugin_migrations WHERE plugin_id = ?`, pluginId)).toBe(1);
    expect(
      count(
        db,
        `SELECT (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) + (SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?) AS c`,
        pluginId,
        manifestId,
      ),
    ).toBe(2);
    expect(count(db, `SELECT COUNT(*) AS c FROM ${ORPHAN_DATA_TABLE}`)).toBe(0);
    expect(host.getPluginState(pluginId)).toBe('installed');
  });
});
