import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { VfsPlugin } from '../vfs.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
} from '../../core/di/interfaces.js';
import { CommandBus } from '../../core/command-bus/index.js';
import { EventBus } from '../../core/event-bus/index.js';
import { ActionRegistry } from '../../core/registry/index.js';
import { CapabilityGuard } from '../../core/capability-system/index.js';

describe('VfsPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT,
        manifest TEXT,
        source_code TEXT,
        status TEXT,
        created_at INTEGER,
        loader_version TEXT,
        execution_mode TEXT
      );
      CREATE TABLE IF NOT EXISTS vfs_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);

    // Register empty mocks for remaining required core services
    serviceRegistry.register(IProcessServiceToken, {
      registerHandler: async () => {},
      unregisterHandler: async () => {},
      restore: async () => {},
    } as any);
    serviceRegistry.register(IStorageServiceToken, {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as any);
    serviceRegistry.register(IAIServiceToken, {
      generateText: async () => '',
    } as any);

    pluginHost = new PluginHost(serviceRegistry, new EsmLoader(), db);
  });

  afterEach(() => {
    db.close();
  });

  it('should successfully register, activate and run VFS commands', async () => {
    const pluginId = '@openlearn/plugin-vfs';
    pluginHost.registerPreloadedPlugin(pluginId, VfsPlugin);

    // Setup initial DB entry
    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'VFS', JSON.stringify(VfsPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Verify actions registered
    const actions = await actionRegistry.getAllActions();
    expect(actions.map(a => a.commandType)).toContain('vfs.write_file');
    expect(actions.map(a => a.commandType)).toContain('vfs.read_file');

    // Grant capabilities to allow execution
    const actorId = `plugin:${VfsPlugin.manifest.id}`;
    capabilityGuard.grant(actorId, 'vfs:write');
    capabilityGuard.grant(actorId, 'vfs:read');

    // Execute vfs.write_file
    const writeResult = await commandBus.execute({
      id: 'cmd-1',
      type: 'vfs.write_file',
      actorId,
      payload: {
        path: '/test.txt',
        content: 'hello world'
      },
      timestamp: Date.now()
    }) as any;

    expect(writeResult.fileId).toBeDefined();

    // Execute vfs.read_file
    const readResult = await commandBus.execute({
      id: 'cmd-2',
      type: 'vfs.read_file',
      actorId,
      payload: {
        path: '/test.txt'
      },
      timestamp: Date.now()
    }) as any;

    expect(readResult.content).toBe('hello world');
  });
});
