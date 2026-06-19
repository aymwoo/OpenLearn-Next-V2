import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { AiSubmitInjectorPlugin } from '../ai-submit-injector.js';
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

describe('AiSubmitInjectorPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;
  let mockAIService: any;
  const tempDir = path.resolve(process.cwd(), 'storage', 'courseware', 'temp-test-uuid');

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
      CREATE TABLE IF NOT EXISTS courseware (
        id TEXT PRIMARY KEY,
        uuid TEXT,
        name TEXT,
        type TEXT,
        entry TEXT,
        created_at INTEGER
      );
    `);

    // Ensure storage path for testing
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<html><body>Score: 100</body></html>');

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    mockAIService = {
      generateText: vi.fn().mockResolvedValue('<html><body>Score: 100 <script>LMS.submit({score: 100})</script></body></html>'),
    };

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);
    serviceRegistry.register(IAIServiceToken, mockAIService);

    // Register mocks for process and storage services
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

    pluginHost = new PluginHost(serviceRegistry, new EsmLoader(), db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.resolve(process.cwd(), 'storage', 'courseware', 'temp-test-uuid'), { recursive: true, force: true });
    // Clean up any generated "[自动提交版]" files
    const generatedDirs = fs.readdirSync(path.resolve(process.cwd(), 'storage', 'courseware'));
    for (const dir of generatedDirs) {
      if (dir !== 'temp-test-uuid') {
        fs.rmSync(path.resolve(process.cwd(), 'storage', 'courseware', dir), { recursive: true, force: true });
      }
    }
  });

  it('should trigger AI injection when courseware is uploaded without submission logic', async () => {
    const pluginId = '@openlearn/plugin-ai-submit-injector';
    pluginHost.registerPreloadedPlugin(pluginId, AiSubmitInjectorPlugin);

    // Setup initial DB entry
    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'AI Submit Injector', JSON.stringify(AiSubmitInjectorPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Register a listener for the output event
    const eventReceivedPromise = new Promise<any>((resolve) => {
      eventBus.subscribe('courseware.uploaded', (event) => {
        if (event.payload.name.startsWith('[自动提交版]')) {
          resolve(event);
        }
      });
    });

    // Simulate original upload event
    await eventBus.publish({
      id: 'original-upload-event',
      type: 'courseware.uploaded',
      source: 'builtin.courseware',
      payload: {
        id: 'cw_original_123',
        uuid: 'temp-test-uuid',
        name: 'My Quiz Courseware',
        entry: 'index.html',
      },
      timestamp: Date.now(),
    });

    const event = await eventReceivedPromise;
    expect(event.payload.name).toBe('[自动提交版] My Quiz Courseware');
    expect(mockAIService.generateText).toHaveBeenCalled();

    // Verify it was added to DB
    const row = db.prepare('SELECT * FROM courseware WHERE uuid = ?').get(event.payload.uuid) as any;
    expect(row).toBeDefined();
    expect(row.name).toBe('[自动提交版] My Quiz Courseware');
  });
});
