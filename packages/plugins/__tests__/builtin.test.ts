import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { BuiltinPlugin } from '../builtin.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
  IPluginHostToken,
} from '../../core/di/interfaces.js';
import { CommandBus } from '../../core/command-bus/index.js';
import { EventBus } from '../../core/event-bus/index.js';
import { ActionRegistry } from '../../core/registry/index.js';
import { CapabilityGuard } from '../../core/capability-system/index.js';

describe('BuiltinPlugin', () => {
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
        name TEXT NOT NULL,
        manifest TEXT NOT NULL,
        source_code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        loader_version TEXT,
        execution_mode TEXT
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        timeline TEXT,
        progress_mode TEXT DEFAULT 'manual',
        progress_conditions TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whiteboard_elements (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS courseware (
        id TEXT PRIMARY KEY,
        uuid TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        entry TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submission_raw (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submission_result (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        score REAL,
        comment TEXT,
        completion REAL,
        extra_json TEXT
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
    serviceRegistry.register(IPluginHostToken, pluginHost);
  });

  afterEach(() => {
    db.close();
  });

  it('should successfully register, activate and run Builtin commands', async () => {
    const pluginId = '@openlearn/plugin-builtin';
    pluginHost.registerPreloadedPlugin(pluginId, BuiltinPlugin);

    // Setup initial DB entry
    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'Builtin', JSON.stringify(BuiltinPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Verify actions registered
    const actions = await actionRegistry.getAllActions();
    const actionTypes = actions.map(a => a.commandType);
    expect(actionTypes).toContain('lesson.create');
    expect(actionTypes).toContain('whiteboard.draw');

    // Grant capabilities to allow execution
    const actorId = `plugin:${BuiltinPlugin.manifest.id}`;
    capabilityGuard.grant(actorId, 'lesson:write');
    capabilityGuard.grant(actorId, 'lesson:read');
    capabilityGuard.grant(actorId, 'whiteboard:write');
    capabilityGuard.grant(actorId, 'whiteboard:read');

    // 1. Create a lesson
    const createLessonRes = await commandBus.execute({
      id: 'cmd-lesson-create',
      type: 'lesson.create',
      actorId,
      payload: {
        title: 'Introduction to Physics',
        content: 'This is the first lesson of Physics.'
      },
      timestamp: Date.now()
    }) as any;

    expect(createLessonRes.lessonId).toBeDefined();
    const lessonId = createLessonRes.lessonId;

    // Verify lesson exists in DB
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
    expect(lesson).toBeDefined();
    expect(lesson.title).toBe('Introduction to Physics');

    // 2. Draw on whiteboard
    const drawRes = await commandBus.execute({
      id: 'cmd-whiteboard-draw',
      type: 'whiteboard.draw',
      actorId,
      payload: {
        lessonId,
        type: 'line',
        data: JSON.stringify({ points: [0, 0, 100, 100] })
      },
      timestamp: Date.now()
    }) as any;

    expect(drawRes.elementId).toBeDefined();
    const elementId = drawRes.elementId;

    // Verify element exists in DB
    const element = db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?').get(elementId) as any;
    expect(element).toBeDefined();
    expect(element.lesson_id).toBe(lessonId);
  });
});
