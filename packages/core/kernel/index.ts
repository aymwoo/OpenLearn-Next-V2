import { EventBus } from '../event-bus/index.js';
import { CommandBus } from '../command-bus/index.js';
import { ActionRegistry } from '../registry/index.js';
import { CapabilityGuard } from '../capability-system/index.js';
import { PluginRuntime } from '../plugin-runtime/index.js';
import { ProcessManager } from '../process-manager/index.js';
import { db } from '../db/index.js';
import { v7 as uuidv7 } from 'uuid';

export class Kernel {
  public readonly eventBus: EventBus;
  public readonly commandBus: CommandBus;
  public readonly actionRegistry: ActionRegistry;
  public readonly capabilityGuard: CapabilityGuard;
  public readonly pluginRuntime: PluginRuntime;
  public readonly processManager: ProcessManager;
  public readonly db = db;

  constructor() {
    this.eventBus = new EventBus();
    this.commandBus = new CommandBus(this.eventBus);
    this.actionRegistry = new ActionRegistry();
    this.capabilityGuard = new CapabilityGuard();
    this.pluginRuntime = new PluginRuntime(this);
    this.processManager = new ProcessManager(this);

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
