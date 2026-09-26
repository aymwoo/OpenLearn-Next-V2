// @vitest-environment node
/**
 * Runs pinned, real third-party plugin ZIPs through the platform PluginHost.
 * CI builds these fixtures and sets OPENLEARN_PLUGIN_COMPAT_FIXTURES; local
 * unit-test runs without that directory skip this external compatibility suite.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceRegistry } from '../../../packages/core/di/service-registry.js';
import { NodeEsmLoader } from '../../../packages/core/esm-loader/node-loader.js';
import { PluginHost } from '../../../packages/core/plugin-host/index.js';
import { PluginState } from '../../../packages/core/plugin-host/types.js';
import { bootstrapSharedModules } from '../../../packages/core/plugin-host/context-builder.js';
import {
  IActionRegistryServiceToken,
  IAIServiceToken,
  ICapabilityServiceToken,
  ICommandBusServiceToken,
  IDatabaseToken,
  IEventBusServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  IProcessServiceToken,
  ISemesterGradeServiceToken,
  IStorageServiceToken,
} from '../../../packages/core/di/interfaces.js';

const FIXTURE_DIRECTORY = process.env.OPENLEARN_PLUGIN_COMPAT_FIXTURES;

const COMPATIBILITY_PLUGINS = [
  { name: 'attendance-record', manifestId: '@ext/attendance-record' },
  { name: 'class_manager', manifestId: '@ext/class-manager' },
  { name: 'interactive-courseware', manifestId: 'openlearn-plugin-interactive-courseware' },
] as const;

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
      execution_mode TEXT DEFAULT 'inline'
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT,
      key TEXT,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (plugin_id, key)
    );
  `);
  return db;
}

function createMockServices() {
  const registeredHandlers = new Map<string, unknown>();
  const services = {
    commandBus: {
      execute: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn(async (type: string, handler: unknown) => {
        registeredHandlers.set(type, handler);
      }),
      unregisterHandler: vi.fn(async (type: string) => {
        registeredHandlers.delete(type);
      }),
      createCommand: vi.fn(async (type: string, payload: unknown, actorId: string) => ({
        type,
        payload,
        actorId,
      })),
      setInterceptor: vi.fn().mockResolvedValue(undefined),
    },
    eventBus: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    },
    actionRegistry: {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      getAllActions: vi.fn().mockResolvedValue([]),
      getAgentTools: vi.fn().mockResolvedValue([]),
      getActionByToolName: vi.fn().mockResolvedValue(undefined),
      getActionByCommandType: vi.fn().mockResolvedValue(undefined),
    },
    capability: {
      grant: vi.fn().mockResolvedValue(undefined),
      revokeAll: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(true),
    },
    processManager: {
      spawn: vi.fn().mockResolvedValue('compat-process'),
      kill: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      registerInterval: vi.fn().mockResolvedValue('compat-interval'),
      restore: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ai: { generateText: vi.fn().mockResolvedValue('compatibility-test') },
    pointsDimension: {
      registerDimension: vi.fn(),
      getDimension: vi.fn().mockReturnValue(undefined),
      listDimensions: vi.fn().mockReturnValue([]),
    },
    pointsLedger: {
      addPoints: vi.fn().mockResolvedValue({}),
      getLogs: vi.fn().mockResolvedValue([]),
      getStudentTotalByDimension: vi.fn().mockResolvedValue(0),
      getStudentDimensionSummary: vi.fn().mockResolvedValue({}),
    },
    semesterGrade: { saveSemesterGrade: vi.fn().mockResolvedValue(undefined) },
  };

  return { services, registeredHandlers };
}

async function buildDependencyZip(pluginId: string): Promise<Buffer> {
  const manifest = {
    id: pluginId,
    name: `Compatibility dependency ${pluginId}`,
    version: '1.0.0',
    main: 'index.js',
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file(
    'index.js',
    `export default { manifest: ${JSON.stringify(manifest)}, activate: async () => {}, deactivate: async () => {} };`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe.skipIf(!FIXTURE_DIRECTORY)('第三方插件平台兼容性', () => {
  let db: Database.Database;
  let host: PluginHost;
  let pluginsDirectory: string;
  let originalNodeEnv: string | undefined;
  let registeredHandlers: Map<string, unknown>;
  const installedPluginIds: string[] = [];

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    // 复现生产环境 file:// 加载和宿主 SDK 解析路径。
    process.env.NODE_ENV = 'production';

    db = createTestDb();
    const serviceRegistry = new ServiceRegistry();
    const { services, registeredHandlers: handlers } = createMockServices();
    registeredHandlers = handlers;

    await serviceRegistry.register(ICommandBusServiceToken, services.commandBus as never);
    await serviceRegistry.register(IEventBusServiceToken, services.eventBus as never);
    await serviceRegistry.register(IActionRegistryServiceToken, services.actionRegistry as never);
    await serviceRegistry.register(ICapabilityServiceToken, services.capability as never);
    await serviceRegistry.register(IProcessServiceToken, services.processManager as never);
    await serviceRegistry.register(IStorageServiceToken, services.storage as never);
    await serviceRegistry.register(IAIServiceToken, services.ai as never);
    await serviceRegistry.register(IPointsDimensionRegistryToken, services.pointsDimension as never);
    await serviceRegistry.register(IPointsLedgerServiceToken, services.pointsLedger as never);
    await serviceRegistry.register(ISemesterGradeServiceToken, services.semesterGrade as never);
    await serviceRegistry.register(IDatabaseToken, db);

    // Keep extracted plugin files under the Vitest project root for file:// imports.
    pluginsDirectory = fs.mkdtempSync(path.resolve(__dirname, '.tmp-plugins-'));
    host = new PluginHost(serviceRegistry, new NodeEsmLoader(), db, pluginsDirectory);
    await bootstrapSharedModules();

    // class_manager declares these official plugin dependencies in its manifest.
    for (const dependencyId of ['@openlearn/plugin-management', '@openlearn/plugin-builtin']) {
      const dependencyManifest = await host.installPluginFromZip(await buildDependencyZip(dependencyId), 'inline');
      const dependencyRuntimeId = host.resolvePluginUuid(dependencyManifest.id);
      installedPluginIds.push(dependencyRuntimeId);
      await host.activatePlugin(dependencyRuntimeId, { mode: 'inline' });
    }
  });

  afterEach(async () => {
    for (const pluginId of installedPluginIds.splice(0).reverse()) {
      await host?.deactivatePlugin(pluginId).catch(() => undefined);
      await host?.uninstallPlugin(pluginId).catch(() => undefined);
    }
    db?.close();
    if (pluginsDirectory) fs.rmSync(pluginsDirectory, { recursive: true, force: true });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it.each(COMPATIBILITY_PLUGINS)(
    '$name can be installed, activated and deactivated',
    async ({ name, manifestId }) => {
      const zipPath = path.resolve(FIXTURE_DIRECTORY!, `${name}.zip`);
      expect(fs.existsSync(zipPath), `Missing compatibility fixture: ${zipPath}`).toBe(true);

      const zipBuffer = fs.readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      const manifestFile = zip.file('manifest.json');
      expect(manifestFile, `${name} ZIP must include manifest.json`).not.toBeNull();
      expect(zip.file('index.js'), `${name} ZIP must include index.js`).not.toBeNull();
      expect(zip.file('frontend.js'), `${name} ZIP must include frontend.js`).not.toBeNull();

      const manifest = JSON.parse(await manifestFile!.async('string')) as { id: string; version: string };
      expect(manifest.id).toBe(manifestId);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);

      const installedManifest = await host.installPluginFromZip(zipBuffer, 'inline');
      expect(installedManifest.id).toBe(manifestId);
      const pluginId = host.resolvePluginUuid(manifestId);
      installedPluginIds.push(pluginId);
      expect(host.getPluginState(pluginId)).toBe(PluginState.INSTALLED);
      expect(fs.existsSync(path.join(pluginsDirectory, pluginId, 'frontend.js'))).toBe(true);

      await host.activatePlugin(pluginId, { mode: 'inline' });
      expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);
      expect(registeredHandlers.size, `${name} should register at least one command handler`).toBeGreaterThan(0);

      await host.deactivatePlugin(pluginId);
      expect(host.getPluginState(pluginId)).toBe(PluginState.INACTIVE);
    },
    120_000,
  );
});
