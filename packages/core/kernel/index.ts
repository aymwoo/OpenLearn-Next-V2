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
import { PluginHost } from '../plugin-host/index.js';

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
  public readonly pluginHost: PluginHost;

  constructor() {
    // Layer 0 — 无依赖
    this.eventBus = new EventBus();
    this.capabilityGuard = new CapabilityGuard();

    // ServiceRegistry — Layer 0（无依赖）
    this.serviceRegistry = new ServiceRegistry();

    // Layer 1 — 依赖 Layer 0
    this.commandBus = new CommandBus(this.eventBus);
    this.actionRegistry = new ActionRegistry();

    // Layer 2 — 依赖 Kernel/db
    this.processManager = new ProcessManager(this);

    // EsmLoader — Layer 0（无依赖），用于 PluginRuntime 的 ESM 加载分支
    this.esmLoader = new NodeEsmLoader();

    // PluginHost — 依赖 ServiceRegistry + EsmLoader + db
    this.pluginHost = new PluginHost(this.serviceRegistry, this.esmLoader, this.db);

    // PluginRuntime — 接收 PluginHost 作为 facade 委托
    this.pluginRuntime = new PluginRuntime(this, this.esmLoader, this.pluginHost);

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
