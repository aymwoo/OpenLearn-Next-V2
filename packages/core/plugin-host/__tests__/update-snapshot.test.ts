import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader, type PluginModule } from '../../esm-loader/esm-loader.js';
import { PluginHost } from '../index.js';
import { pluginTablePrefix } from '../plugin-tables.js';
import { ConfigService } from '../config-service.js';
import { DEFAULT_PLUGIN_SNAPSHOT_RETENTION, listPluginSnapshots } from '../update-snapshot.js';
import { setAuditSinkForTests, type AuditRecord } from '../../observability/audit-log.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  type ICommandBusService,
  type IEventBusService,
  type IActionRegistryService,
  type ICapabilityService,
  type IProcessService,
  type IStorageService,
  type IAIService,
  type IPointsDimensionRegistry,
  type IPointsLedgerService,
} from '../../di/interfaces.js';
import { createPluginsDir, cleanupPluginsDir } from './helpers/plugins-dir.js';

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
      updated_at INTEGER,
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
    CREATE TABLE IF NOT EXISTS plugin_config (
      plugin_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'platform',
      scope_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, scope_type, scope_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_capability_grants (
      plugin_key TEXT NOT NULL,
      capability TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, capability)
    );
    CREATE TABLE IF NOT EXISTS plugin_network_grants (
      plugin_key TEXT NOT NULL,
      host TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, host)
    );
    CREATE TABLE IF NOT EXISTS plugin_public_routes (
      plugin_key TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, method, path)
    );
  `);
  return db;
}

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
    ai: { generateText: vi.fn().mockResolvedValue('AI response') } as IAIService,
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

class VersionAwareEsmLoader extends EsmLoader {
  public failVersions = new Set<string>();

  async load(code: string): Promise<PluginModule> {
    const versionMatch = code.match(/CODE_V_([0-9]+\.[0-9]+\.[0-9]+)/);
    const version = versionMatch?.[1] || '1.0.0';
    return {
      default: {
        manifest: { id: 'ext-snap-demo', name: 'Snapshot Demo', version, main: 'index.js' },
        activate: async () => {
          if (this.failVersions.has(version)) {
            throw new Error(`Simulated activation crash on v${version}`);
          }
        },
        deactivate: async () => {},
      },
      activate: async () => {
        if (this.failVersions.has(version)) {
          throw new Error(`Simulated activation crash on v${version}`);
        }
      },
      deactivate: async () => {},
    };
  }
}

async function buildPluginZipFile(
  tmpDir: string,
  version: string,
  options: { extraAsset?: string; dependencies?: Record<string, string> } = {},
): Promise<string> {
  const zip = new JSZip();
  const manifest = {
    id: 'ext-snap-demo',
    name: 'Snapshot Demo',
    version,
    main: 'index.js',
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'index.js',
    `export const manifest = ${JSON.stringify(manifest)};\nexport const marker = "CODE_V_${version}";\nexport async function activate() {}\n`,
  );
  if (options.extraAsset) {
    zip.file('storage/info.txt', options.extraAsset);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.join(tmpDir, `ext-snap-demo-${version}.zip`);
  fs.writeFileSync(zipPath, buf);
  return zipPath;
}

describe('Plugin Update Snapshots & Safe Rollback', () => {
  let db: Database.Database;
  let host: PluginHost;
  let pluginsDir: string;
  let workDir: string;
  let esmLoader: VersionAwareEsmLoader;
  let auditRecords: AuditRecord[];

  beforeEach(async () => {
    db = createTestDb();
    pluginsDir = createPluginsDir('update-snapshot-');
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-work-'));
    esmLoader = new VersionAwareEsmLoader();
    const sr = new ServiceRegistry();
    await registerMockServices(sr, createMockServices());
    host = new PluginHost(sr, esmLoader, db, pluginsDir);
    auditRecords = [];
    setAuditSinkForTests((rec) => auditRecords.push(rec));
  });

  afterEach(() => {
    setAuditSinkForTests(null);
    cleanupPluginsDir(pluginsDir);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('captures pre-update snapshots across successive updates and retains only 1 by default', async () => {
    expect(DEFAULT_PLUGIN_SNAPSHOT_RETENTION).toBe(1);

    const zipV1 = await buildPluginZipFile(workDir, '1.0.0', { extraAsset: 'asset-v1' });
    const installed = await host.installPluginFromZip(zipV1);
    const pluginId = installed.pluginId as string;
    const prefix = pluginTablePrefix(pluginId);

    // Seed private table, storage, config (with schema cache), migration, grant
    db.exec(`CREATE TABLE ${prefix}records (id INTEGER PRIMARY KEY, note TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${prefix}records (note) VALUES (?)`).run('from-v1');
    db.prepare('INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(
      pluginId,
      'theme',
      'light',
      Date.now(),
    );
    db.prepare('INSERT INTO plugin_migrations (plugin_id, version) VALUES (?, ?)').run(pluginId, 1);

    const cfgService = new ConfigService(db, {
      id: 'ext-snap-demo',
      name: 'Snapshot Demo',
      version: '1.0.0',
      main: 'index.js',
      configuration: {
        properties: { title: { type: 'string', default: 'default-title' } },
      },
    });
    await cfgService.set('title', 'Title in V1');

    // Update 1.0.0 -> 1.1.0
    const zipV11 = await buildPluginZipFile(workDir, '1.1.0', { extraAsset: 'asset-v1.1' });
    const res11 = await host.updatePluginFromZip(zipV11, { targetPluginId: pluginId, communityOfficial: true });
    expect(res11.snapshotId).toBeTruthy();

    let snaps = host.listPluginSnapshots(pluginId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      tableCount: 1,
      rowCount: 1,
      storageRows: 1,
      configRows: 1,
      migrationVersion: 1,
      status: 'ready',
    });
    // Ensure snapshot is NOT stored inside served pluginDir
    const snapParent = path.join(path.dirname(pluginsDir), 'plugin-update-snapshots');
    expect(fs.existsSync(snapParent)).toBe(true);
    expect(fs.existsSync(path.join(pluginsDir, pluginId, '.update-backup'))).toBe(false);

    // Update 1.1.0 -> 1.2.0: oldest snapshot (1.0.0 -> 1.1.0) must be pruned, keeping ONLY 1
    db.prepare(`INSERT INTO ${prefix}records (note) VALUES (?)`).run('from-v1.1');
    const zipV12 = await buildPluginZipFile(workDir, '1.2.0', { extraAsset: 'asset-v1.2' });
    await host.updatePluginFromZip(zipV12, { targetPluginId: pluginId, communityOfficial: true });

    snaps = host.listPluginSnapshots(pluginId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].fromVersion).toBe('1.1.0');
    expect(snaps[0].toVersion).toBe('1.2.0');
    expect(snaps[0].rowCount).toBe(2);
  });

  it('manually rolls back buggy update and restores plugin files, DB tables, config cache, and active state', async () => {
    const zipV1 = await buildPluginZipFile(workDir, '1.0.0', { extraAsset: 'asset-v1' });
    const installed = await host.installPluginFromZip(zipV1);
    const pluginId = installed.pluginId as string;
    await host.activatePlugin(pluginId);

    const prefix = pluginTablePrefix(pluginId);
    db.exec(`CREATE TABLE ${prefix}records (id INTEGER PRIMARY KEY, note TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${prefix}records (note) VALUES (?)`).run('v1-original');
    db.prepare('INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(
      pluginId,
      'mode',
      'stable',
      Date.now(),
    );
    db.prepare('INSERT INTO plugin_migrations (plugin_id, version) VALUES (?, ?)').run(pluginId, 1);

    const cfgService = new ConfigService(db, {
      id: 'ext-snap-demo',
      name: 'Snapshot Demo',
      version: '1.0.0',
      main: 'index.js',
      configuration: {
        properties: { endpoint: { type: 'string', default: 'v1' } },
      },
    });
    await cfgService.set('endpoint', 'https://v1.example.com');
    expect(cfgService.get<string>('endpoint')).toBe('https://v1.example.com');

    // Upgrade to buggy v2.0.0
    const zipV2 = await buildPluginZipFile(workDir, '2.0.0', { extraAsset: 'asset-v2-buggy' });
    const upRes = await host.updatePluginFromZip(zipV2, { targetPluginId: pluginId, communityOfficial: true });
    expect(upRes.newVersion).toBe('2.0.0');

    // Simulate buggy v2 mutations: corrupted table, extra v2 table, bumped migration, overwritten config & storage
    db.prepare(`DELETE FROM ${prefix}records`).run();
    db.prepare(`INSERT INTO ${prefix}records (note) VALUES (?)`).run('v2-corrupt');
    db.exec(`CREATE TABLE ${prefix}v2_only (id INTEGER PRIMARY KEY)`);
    db.prepare('UPDATE plugin_migrations SET version = 2 WHERE plugin_id = ?').run(pluginId);
    db.prepare('UPDATE plugin_storage SET value = ? WHERE plugin_id = ? AND key = ?').run('broken', pluginId, 'mode');
    await cfgService.set('endpoint', 'https://v2-broken.example.com');
    expect(cfgService.get<string>('endpoint')).toBe('https://v2-broken.example.com');

    // Execute manual rollback
    const rollbackRes = await host.rollbackPluginToSnapshot(pluginId, upRes.snapshotId, 'admin-tester');
    expect(rollbackRes.restoredVersion).toBe('1.0.0');
    expect(rollbackRes.fromVersion).toBe('2.0.0');
    expect(rollbackRes.wasActive).toBe(true);

    // Verify plugin files rolled back
    const indexContent = fs.readFileSync(path.join(pluginsDir, pluginId, 'index.js'), 'utf-8');
    expect(indexContent).toContain('CODE_V_1.0.0');
    expect(fs.readFileSync(path.join(pluginsDir, pluginId, 'storage', 'info.txt'), 'utf-8')).toBe('asset-v1');

    // Verify DB metadata & private tables rolled back (including dropping v2-only table)
    const row = db.prepare('SELECT version, status FROM plugins WHERE id = ?').get(pluginId) as {
      version: string;
      status: string;
    };
    expect(row.version).toBe('1.0.0');
    expect(row.status).toBe('active');
    const records = db.prepare(`SELECT note FROM ${prefix}records`).all() as Array<{ note: string }>;
    expect(records.map((r) => r.note)).toEqual(['v1-original']);
    const v2TableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(`${prefix}v2_only`);
    expect(v2TableExists).toBeUndefined();

    // Verify migration, storage & ConfigService cache invalidation
    const mig = db.prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ?').get(pluginId) as {
      version: number;
    };
    expect(mig.version).toBe(1);
    const stor = db
      .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .get(pluginId, 'mode') as { value: string };
    expect(stor.value).toBe('stable');
    expect(cfgService.get<string>('endpoint')).toBe('https://v1.example.com');

    // Audit log written
    expect(auditRecords.some((a) => a.event === 'plugin.rolled_back' && a.restoredVersion === '1.0.0')).toBe(true);
  });

  it('auto-rolls back files and DB if active plugin update fails during reload', async () => {
    const zipV1 = await buildPluginZipFile(workDir, '1.0.0');
    const installed = await host.installPluginFromZip(zipV1);
    const pluginId = installed.pluginId as string;
    await host.activatePlugin(pluginId);

    const prefix = pluginTablePrefix(pluginId);
    db.exec(`CREATE TABLE ${prefix}logs (id INTEGER PRIMARY KEY, msg TEXT)`);
    db.prepare(`INSERT INTO ${prefix}logs (msg) VALUES (?)`).run('before-failed-update');

    // Cause reloadPlugin/activate to fail for 2.0.0
    const reloadSpy = vi.spyOn(host as unknown as { reloadPlugin: () => Promise<void> }, 'reloadPlugin');
    reloadSpy.mockRejectedValueOnce(new Error('Simulated v2 reload crash'));

    const zipV2 = await buildPluginZipFile(workDir, '2.0.0');
    await expect(
      host.updatePluginFromZip(zipV2, { targetPluginId: pluginId, communityOfficial: true }),
    ).rejects.toThrow('Simulated v2 reload crash');

    // Files and DB must reflect v1.0.0, and failed 'creating' snapshot must be cleaned up
    const row = db.prepare('SELECT version FROM plugins WHERE id = ?').get(pluginId) as { version: string };
    expect(row.version).toBe('1.0.0');
    expect(fs.readFileSync(path.join(pluginsDir, pluginId, 'index.js'), 'utf-8')).toContain('CODE_V_1.0.0');
    expect(listPluginSnapshots(pluginsDir, pluginId)).toHaveLength(0);
    expect(auditRecords.some((a) => a.event === 'plugin.update_auto_rolled_back' && a.fromVersion === '1.0.0')).toBe(
      true,
    );
  });

  it('purges stored update snapshots when plugin is uninstalled with dataPolicy=purge', async () => {
    const zipV1 = await buildPluginZipFile(workDir, '1.0.0');
    const installed = await host.installPluginFromZip(zipV1);
    const pluginId = installed.pluginId as string;

    const zipV11 = await buildPluginZipFile(workDir, '1.1.0');
    await host.updatePluginFromZip(zipV11, { targetPluginId: pluginId, communityOfficial: true });
    expect(host.listPluginSnapshots(pluginId)).toHaveLength(1);

    await host.uninstallPlugin(pluginId, { dataPolicy: 'purge' });
    expect(listPluginSnapshots(pluginsDir, pluginId)).toHaveLength(0);
  });
});
