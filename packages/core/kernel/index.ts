import { EventBus } from '../event-bus/index.js';
import { CommandBus } from '../command-bus/index.js';
import { ActionRegistry } from '../registry/index.js';
import { CapabilityGuard } from '../capability-system/index.js';
import { PluginRuntime } from '../plugin-runtime/index.js';
import { ProcessManager } from '../process-manager/index.js';
import { NodeEsmLoader } from '../esm-loader/index.js';
import { db } from '../db/index.js';
import { v7 as uuidv7 } from 'uuid';
import { ServiceRegistry } from '../di/service-registry.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';
import { PluginHost } from '../plugin-host/index.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import { HotReloadController } from '../plugin-host/hot-reload.js';
import path from 'path';

export class Kernel {
  public readonly eventBus: EventBus;
  public readonly commandBus: CommandBus;
  public readonly actionRegistry: ActionRegistry;
  public readonly capabilityGuard: CapabilityGuard;
  public readonly pluginRuntime: PluginRuntime;
  public readonly processManager: ProcessManager;
  public readonly esmLoader: NodeEsmLoader;
  public readonly db = db;
  public readonly serviceRegistry: ServiceRegistry;
  public readonly storageService: StorageService;
  public readonly aiService: AIService;
  public readonly pluginHost: PluginHost;
  public readonly workerManager: WorkerManager;

  constructor() {
    // Layer 0 — 无依赖
    this.eventBus = new EventBus();
    this.capabilityGuard = new CapabilityGuard();

    // ServiceRegistry — Layer 0（无依赖）
    this.serviceRegistry = new ServiceRegistry();

    // StorageService + AIService — Layer 0（无依赖）
    this.storageService = new StorageService(this.db);
    this.aiService = new AIService(this.db);

    // Layer 1 — 依赖 Layer 0
    this.commandBus = new CommandBus(this.eventBus);
    this.actionRegistry = new ActionRegistry();

    // Layer 2 — 依赖 Kernel/db
    this.processManager = new ProcessManager(this);

    // EsmLoader — Layer 0（无依赖），用于 PluginRuntime 的 ESM 加载分支
    this.esmLoader = new NodeEsmLoader();

    // PluginHost — 依赖 ServiceRegistry + EsmLoader + db
    this.pluginHost = new PluginHost(this.serviceRegistry, this.esmLoader, this.db);

    // Layer 3 — WorkerManager (depends on ServiceRegistry + CapabilityGuard)
    this.workerManager = new WorkerManager(this.serviceRegistry, this.capabilityGuard, this.db);
    // Wire WorkerManager into PluginHost via setter (avoids circular dependency)
    this.pluginHost.setWorkerManager(this.workerManager);

    // PluginRuntime — 接收 PluginHost 作为 facade 委托
    this.pluginRuntime = new PluginRuntime(this, this.esmLoader, this.pluginHost);

    // Register all IService instances into ServiceRegistry (D-14)
    // Must happen after all subsystems are created, before the interceptor
    this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
    this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
    this.serviceRegistry.register(IStorageServiceToken, this.storageService);
    this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus as any);
    this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as any);
    this.serviceRegistry.register(IProcessServiceToken, this.processManager as any);
    this.serviceRegistry.register(IAIServiceToken, this.aiService);

    // Capability check interceptor
    this.commandBus.setInterceptor(async (command) => {
      const action = this.actionRegistry.getActionByCommandType(command.type);
      if (action) {
        if (action.capabilityRequired) {
          const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
          if (!allowed) {
            throw new Error(`[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`);
          }
        }

        if (action.isHighRisk && command.metadata?.approved !== true) {
          const stmt = this.db.prepare('INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?, ?, ?, ?, ?)');
          stmt.run(command.id, command.type, JSON.stringify(command.payload), command.actorId, Date.now());

          this.eventBus.publish({
            id: uuidv7(),
            type: 'approval.requested',
            source: 'kernel.security',
            payload: { commandId: command.id, commandType: command.type },
            timestamp: Date.now(),
            correlationId: command.id
          });

          throw new Error(`[Security] Command ${command.type} requires human approval. It has been queued to pending actions.`);
        }
      }
    });

    // Phase 7: 开发模式热重载
    if (process.env.NODE_ENV === 'development') {
      const watchDir = path.resolve(process.cwd(), 'plugins');
      try {
        const hotReload = new HotReloadController(this.pluginHost, watchDir);
        this.pluginHost.setHotReloadController(hotReload);
        hotReload.start().catch(err => {
          console.warn('[Kernel] Hot reload initialization failed:', err.message);
        });
      } catch (err) {
        console.warn('[Kernel] Hot reload initialization failed:', (err as Error).message);
      }
    }
  }

  // Subscribe to all events and log them to DB
  public initAuditLog() {
    this.eventBus.subscribe('*', (event) => {
      const stmt = this.db.prepare(
        'INSERT INTO events (id, type, source, payload, timestamp, correlationId) VALUES (?, ?, ?, ?, ?, ?)'
      );
      stmt.run(
        event.id,
        event.type,
        event.source,
        JSON.stringify(event.payload),
        event.timestamp,
        event.correlationId || null
      );
    });
  }
}

// Singleton export 
export const kernelContainer = new Kernel();
kernelContainer.initAuditLog();
