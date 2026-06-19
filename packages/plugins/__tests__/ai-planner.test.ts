import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { AiPlannerPlugin } from '../ai-planner.js';
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

describe('AiPlannerPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;
  let mockProcessManager: any;

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
        name TEXT,
        status TEXT,
        task_type TEXT,
        payload TEXT,
        state TEXT,
        logs TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        class_id TEXT,
        title TEXT,
        description TEXT,
        content TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        assignment_id TEXT,
        student_id TEXT,
        score REAL,
        feedback TEXT,
        graded_at INTEGER,
        status TEXT,
        PRIMARY KEY (assignment_id, student_id)
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    mockProcessManager = {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      spawn: vi.fn().mockReturnValue('mock-process-id'),
    };

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);
    serviceRegistry.register(IProcessServiceToken, mockProcessManager);

    // Register mocks for remaining services
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

  it('should successfully register, activate and run AI Planner commands', async () => {
    const pluginId = '@openlearn/plugin-ai-planner';
    pluginHost.registerPreloadedPlugin(pluginId, AiPlannerPlugin);

    // Setup initial DB entry
    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'AI Planner', JSON.stringify(AiPlannerPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Verify actions registered
    const actions = await actionRegistry.getAllActions();
    expect(actions.find(a => a.commandType === 'ai.start_generation')).toBeDefined();
    expect(actions.find(a => a.commandType === 'ai.apply_recommendation')).toBeDefined();
    expect(actions.find(a => a.commandType === 'ai.apply_grade')).toBeDefined();

    // Verify process task handler registered
    expect(mockProcessManager.registerHandler).toHaveBeenCalledWith('ai_planner_task', expect.any(Function));

    // Test: ai.start_generation command execution
    const spawnRes = await commandBus.execute({
      id: 'cmd-start-generation',
      type: 'ai.start_generation',
      actorId: 'system',
      timestamp: Date.now(),
      payload: {
        taskType: 'lesson_material',
        topic: 'AI Ethics',
        duration: 3,
      },
    });

    expect(spawnRes).toEqual({
      processId: 'mock-process-id',
      message: 'Process started in the background.',
    });
    expect(mockProcessManager.spawn).toHaveBeenCalledWith(
      'AI Generator: AI Ethics',
      'ai_planner_task',
      { taskType: 'lesson_material', topic: 'AI Ethics', classId: undefined, duration: 3 }
    );
  });
});
