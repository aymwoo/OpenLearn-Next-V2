import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import type { PluginModule } from '../../esm-loader/esm-loader.js';
import { PluginHost } from '../index.js';
import { PluginState } from '../types.js';
import { ServiceHost } from '../../worker-runtime/service-host.js';
import { CapabilityGuard } from '../../capability/index.js';
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
  IDatabaseToken,
} from '../../di/interfaces.js';

// ── Test Helpers ────────────────────────────────────────────────────────────

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

async function createMockZip(
  manifestId: string,
  name: string,
  deploy?: { staticRoute?: string; staticDir?: string; script?: string },
): Promise<Buffer> {
  const zip = new JSZip();
  const manifest: any = {
    id: manifestId,
    name: name,
    version: '1.0.0',
    main: 'index.js',
    requires: [],
  };
  if (deploy) {
    manifest.deploy = deploy;
    if (deploy.staticDir) {
      zip.file(path.posix.join(deploy.staticDir, 'index.html'), '<h1>Static App</h1>');
    }
  }
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file(
    'index.js',
    `
    export const manifest = ${JSON.stringify(manifest)};
    export async function activate(ctx) {
      ctx._activated = true;
    }
  `,
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Plugin Hardening & Optimizations (Phase 29)', () => {
  let db: Database.Database;
  let registry: ServiceRegistry;
  let loader: EsmLoader;
  let host: PluginHost;
  const tempDir = path.resolve(process.cwd(), 'plugins-test-hardening');

  beforeEach(async () => {
    db = createTestDb();
    registry = new ServiceRegistry();

    // Register mock services
    await registry.register(ICommandBusServiceToken, {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      execute: vi.fn(),
    } as any);
    await registry.register(IEventBusServiceToken, {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn(),
    } as any);
    await registry.register(IActionRegistryServiceToken, {
      register: vi.fn(),
      unregister: vi.fn(),
    } as any);
    await registry.register(ICapabilityServiceToken, {
      grant: vi.fn(),
      revokeAll: vi.fn(),
    } as any);
    await registry.register(IProcessServiceToken, {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
    } as any);
    await registry.register(IStorageServiceToken, {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    } as any);
    await registry.register(IAIServiceToken, {} as any);
    await registry.register(IPointsDimensionRegistryToken, {
      registerDimension: vi.fn(),
      getDimension: vi.fn().mockReturnValue(undefined),
      listDimensions: vi.fn().mockReturnValue([]),
    } as any);
    await registry.register(IPointsLedgerServiceToken, {
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
    } as any);
    await registry.register(IDatabaseToken, db);

    // Mock ESM Loader
    loader = {
      load: vi.fn(async (code: string): Promise<PluginModule> => {
        return {
          default: {
            manifest: { id: 'ext-test', name: 'Test Plugin', version: '1.0.0', main: 'index.js' },
            activate: async (ctx: any) => {
              ctx._activated = true;
            },
          },
        };
      }),
    };

    host = new PluginHost(registry, loader, db, tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 1. ZIP Installation returns UUID
  it('should return manifest containing generated pluginId (UUID) upon ZIP installation', async () => {
    const zipBuffer = await createMockZip('ext-test-zip', 'Zip Test Plugin');

    const manifest = await host.installPluginFromZip(zipBuffer);

    expect(manifest.id).toBe('ext-test-zip');
    expect((manifest as any).pluginId).toBeDefined();
    expect(typeof (manifest as any).pluginId).toBe('string');
    // Verify it is a valid UUID format
    expect((manifest as any).pluginId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // 2. Alias operation lifecycle
  it('should support toggle, activate, deactivate, and uninstall lifecycle using Manifest ID alias', async () => {
    const zipBuffer = await createMockZip('ext-alias-test', 'Alias Test Plugin');
    const installedManifest = await host.installPluginFromZip(zipBuffer);
    const uuid = (installedManifest as any).pluginId;

    // Verify initially INSTALLED
    expect(host.getPluginState('ext-alias-test')).toBe(PluginState.INSTALLED);

    // 1. Activate using Manifest ID 'ext-alias-test'
    await host.activatePlugin('ext-alias-test');
    expect(host.getPluginState(uuid)).toBe(PluginState.ACTIVE);
    expect(host.getPluginState('ext-alias-test')).toBe(PluginState.ACTIVE);

    // 2. Deactivate using Manifest ID
    await host.deactivatePlugin('ext-alias-test');
    expect(host.getPluginState(uuid)).toBe(PluginState.INACTIVE);

    // 3. Toggle using Manifest ID (should activate it back)
    const newStatus = await host.togglePlugin('ext-alias-test');
    expect(newStatus).toBe('active');
    expect(host.getPluginState(uuid)).toBe(PluginState.ACTIVE);

    // 4. Uninstall using Manifest ID
    await host.uninstallPlugin('ext-alias-test');
    expect(host.getPluginState(uuid)).toBe(PluginState.UNINSTALLED);
    expect(host.getPluginState('ext-alias-test')).toBeUndefined();
  });

  // 3. Worker Storage RPC Isolation
  it('should intercept IStorageService in ServiceHost to enforce namespace isolation for Worker plugins', async () => {
    const mockDb = createTestDb();
    const guard = new CapabilityGuard();

    // Create ServiceHost bound to plugin:ext-test-isolated
    const serviceHost = new ServiceHost(registry, guard, 'plugin:ext-test-isolated', ['whiteboard:write']);

    const transport = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
    };

    // Simulate Worker calling storage.set('theme', 'dark')
    await serviceHost.handleMessage(
      {
        type: 'invoke',
        token: '@openlearn/core:IStorageService',
        method: 'set',
        args: ['theme', 'dark'],
        invokeId: 'inv-1',
      },
      transport as any,
    );

    // Verify message response back to worker was success
    expect(transport.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'result',
        invokeId: 'inv-1',
        value: undefined,
      }),
    );

    // Verify SQLite storage entries
    // A. Plugin namespace row must exist with the correct isolated plugin_id
    const row = db
      .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .get('ext-test-isolated', 'theme') as any;
    expect(row).toBeDefined();
    expect(JSON.parse(row.value)).toBe('dark');

    // B. Global kernel namespace '__kernel__' must NOT have this key
    const kernelRow = db
      .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .get('__kernel__', 'theme');
    expect(kernelRow).toBeUndefined();

    // Simulate Worker calling storage.get('theme')
    await serviceHost.handleMessage(
      {
        type: 'invoke',
        token: '@openlearn/core:IStorageService',
        method: 'get',
        args: ['theme'],
        invokeId: 'inv-2',
      },
      transport as any,
    );

    expect(transport.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'result',
        invokeId: 'inv-2',
        value: 'dark',
      }),
    );
  });

  // 4. SEC-ROUTE-01: Static Route Format Validation
  it('should reject staticRoute with invalid format (missing leading slash or path traversal)', async () => {
    const mockApp = { use: vi.fn() };
    host.setExpressApp(mockApp);

    // Missing leading slash
    const zip1 = await createMockZip('ext-invalid-route-1', 'Invalid Route 1', {
      staticRoute: 'custom/app',
      staticDir: 'public',
    });
    await expect(host.installPluginFromZip(zip1)).rejects.toThrow(
      'must start with "/" and cannot contain ".."',
    );

    // Path traversal
    const zip2 = await createMockZip('ext-invalid-route-2', 'Invalid Route 2', {
      staticRoute: '/custom/../etc',
      staticDir: 'public',
    });
    await expect(host.installPluginFromZip(zip2)).rejects.toThrow(
      'must start with "/" and cannot contain ".."',
    );
  });

  // 5. SEC-ROUTE-02: System Reserved Route Protection
  it('should reject staticRoute targeting reserved system routes', async () => {
    const mockApp = { use: vi.fn() };
    host.setExpressApp(mockApp);

    const reservedRoutes = ['/', '/api', '/api/v1', '/socket.io', '/admin/dashboard', '/health'];
    for (const reserved of reservedRoutes) {
      const zip = await createMockZip(`ext-reserved-${reserved.replace(/[^a-z0-9]/gi, '_')}`, 'Reserved Plugin', {
        staticRoute: reserved,
        staticDir: 'public',
      });
      await expect(host.installPluginFromZip(zip)).rejects.toThrow(
        /Security Violation: Plugin ".*" cannot register reserved system route/,
      );
    }
  });

  // 6. SEC-ROUTE-03: Static Route Conflict Detection & Release upon Uninstall
  it('should prevent route conflicts between plugins and release route upon uninstall', async () => {
    const mockApp = { use: vi.fn(), _router: { stack: [] } };
    host.setExpressApp(mockApp);

    const zipA = await createMockZip('ext-plugin-a', 'Plugin A', {
      staticRoute: '/ext/my-dashboard',
      staticDir: 'storage/dist',
    });
    const zipB = await createMockZip('ext-plugin-b', 'Plugin B', {
      staticRoute: '/ext/my-dashboard',
      staticDir: 'storage/dist',
    });

    // 1. Install Plugin A successfully
    const manifestA = await host.installPluginFromZip(zipA);
    expect(manifestA.id).toBe('ext-plugin-a');
    expect(mockApp.use).toHaveBeenCalledWith('/ext/my-dashboard', expect.any(Function), expect.any(Function));

    // 2. Install Plugin B with conflicting route should fail
    await expect(host.installPluginFromZip(zipB)).rejects.toThrow(
      'Static route conflict: "/ext/my-dashboard" is already registered by plugin "ext-plugin-a"',
    );

    // 3. Uninstall Plugin A to release the route
    await host.uninstallPlugin('ext-plugin-a');

    // 4. Install Plugin B now succeeds
    const manifestB = await host.installPluginFromZip(zipB);
    expect(manifestB.id).toBe('ext-plugin-b');
  });
});
