import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { ProcessPlugin } from '../process.js';
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
import { ProcessManager } from '../../core/process-manager/index.js';

describe('ProcessPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;
  let processManager: ProcessManager;

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
      CREATE TABLE IF NOT EXISTS processes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        task_type TEXT NOT NULL,
        payload TEXT,
        state TEXT,
        logs TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    const mockKernel = { eventBus, db } as any;
    processManager = new ProcessManager(mockKernel);

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IProcessServiceToken, processManager as any);
    serviceRegistry.register(IDatabaseToken, db as any);

    // Register empty mocks for remaining required core services
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

  it('should successfully register, activate and run process commands', async () => {
    const pluginId = '@openlearn/plugin-process';
    pluginHost.registerPreloadedPlugin(pluginId, ProcessPlugin);

    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'Process', JSON.stringify(ProcessPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    const actions = await actionRegistry.getAllActions();
    expect(actions.map(a => a.commandType)).toContain('process.spawn');
    expect(actions.map(a => a.commandType)).toContain('process.kill');

    const actorId = `plugin:${ProcessPlugin.manifest.id}`;
    capabilityGuard.grant(actorId, 'process:write');
    capabilityGuard.grant(actorId, 'process:read');

    // Spawn a process
    const spawnRes = await commandBus.execute({
      id: 'cmd-spawn',
      type: 'process.spawn',
      actorId,
      payload: {
        name: 'test-process',
        duration: 1
      },
      timestamp: Date.now()
    }) as any;

    expect(spawnRes.processId).toBeDefined();

    // List processes
    const listRes = await commandBus.execute({
      id: 'cmd-list',
      type: 'process.list',
      actorId,
      payload: {},
      timestamp: Date.now()
    }) as any;

    expect(listRes.processes.length).toBe(1);
    expect(listRes.processes[0].name).toBe('test-process');
  });
});
