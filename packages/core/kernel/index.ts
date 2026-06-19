import { EventBus } from '../event-bus/index.js';
import { CommandBus } from '../command-bus/index.js';
import { ActionRegistry } from '../registry/index.js';
import { CapabilityGuard } from '../capability-system/index.js';
import { ProcessManager } from '../process-manager/index.js';
import { NodeEsmLoader } from '../esm-loader/index.js';
import { db } from '../db/index.js';
import { v7 as uuidv7 } from 'uuid';
import { ServiceRegistry } from '../di/service-registry.js';
import { VfsPlugin } from '../../plugins/vfs.js';
import { ProcessPlugin } from '../../plugins/process.js';
import { ManagementPlugin } from '../../plugins/management.js';
import { BuiltinPlugin } from '../../plugins/builtin.js';
import { AiPlannerPlugin } from '../../plugins/ai-planner.js';
import { AiSubmitInjectorPlugin } from '../../plugins/ai-submit-injector.js';
import fs from 'fs';

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
  public readonly processManager: ProcessManager;
  public readonly esmLoader: NodeEsmLoader;
  public readonly db = db;
  public readonly serviceRegistry: ServiceRegistry;
  public readonly storageService: StorageService;
  public readonly aiService: AIService;
  public readonly pluginHost: PluginHost;
  public readonly workerManager: WorkerManager;
  public readonly ready: Promise<void>;

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

    // No more pluginRuntime (Phase 8 cleanup)

    // Register all IService instances into ServiceRegistry (D-14)
    // Must happen after all subsystems are created, before the interceptor
    this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
    this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
    this.serviceRegistry.register(IStorageServiceToken, this.storageService);
    this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus as any);
    this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as any);
    this.serviceRegistry.register(IProcessServiceToken, this.processManager as any);
    this.serviceRegistry.register(IAIServiceToken, this.aiService);
    this.serviceRegistry.register(IDatabaseToken, this.db as any);
    this.serviceRegistry.register(IPluginHostToken, this.pluginHost);

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

    // Auto-bootstrap system critical plugins (VFS, Process) - Wave 1 (Phase 8)
    this.ready = this.bootstrapSystemPlugins().catch(err => {
      console.error('[Kernel] Critical system plugin bootstrap failed:', err);
      process.exit(1); // Hard crash
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

  private async bootstrapSystemPlugins() {
    const systemPlugins = [
      { id: '@openlearn/plugin-vfs', mod: VfsPlugin, name: 'Virtual File System Plugin', critical: true },
      { id: '@openlearn/plugin-process', mod: ProcessPlugin, name: 'Background Process Plugin', critical: true },
      { id: '@openlearn/plugin-management', mod: ManagementPlugin, name: 'LMS Management Plugin', critical: true },
      { id: '@openlearn/plugin-builtin', mod: BuiltinPlugin, name: 'Classroom Builtin Plugin', critical: true },
      { id: '@openlearn/plugin-ai-planner', mod: AiPlannerPlugin, name: 'AI Planner Plugin', critical: false },
      { id: '@openlearn/plugin-ai-submit-injector', mod: AiSubmitInjectorPlugin, name: 'AI Submit Injector Plugin', critical: false }
    ];

    for (const plugin of systemPlugins) {
      try {
        let row = this.db.prepare('SELECT id FROM plugins WHERE id = ?')
          .get(plugin.id) as { id: string } | undefined;
        
        if (!row) {
          this.db.prepare(
            'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            plugin.id,
            plugin.name,
            JSON.stringify(plugin.mod.manifest),
            `// System built-in inline plugin: ${plugin.name}`,
            'installed',
            Date.now(),
            'esm',
            'inline'
          );
        }

        // Register in PluginHost's preloadedPlugins map
        this.pluginHost.registerPreloadedPlugin(plugin.id, plugin.mod);

        // Activate plugin
        await this.pluginHost.activatePlugin(plugin.id);
      } catch (err) {
        if (plugin.critical) {
          console.error(`[Kernel] Failed to bootstrap critical system plugin ${plugin.name}:`, err);
          throw err;
        } else {
          console.warn(`[Kernel] Soft-fail: Failed to bootstrap AI system plugin ${plugin.name}:`, err);
        }
      }
    }

    // Seeding external ZIP plugins - Wave 4 (Phase 8)
    const extPluginsDir = path.resolve(process.cwd(), 'dist', 'plugins');
    if (fs.existsSync(extPluginsDir)) {
      const files = fs.readdirSync(extPluginsDir).filter(f => f.endsWith('.zip'));
      for (const file of files) {
        try {
          const zipBuffer = fs.readFileSync(path.join(extPluginsDir, file));
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(zipBuffer);
          const manifestFile = zip.file('manifest.json');
          if (!manifestFile) continue;
          const manifestContent = await manifestFile.async('text');
          const manifest = JSON.parse(manifestContent);
          
          // Check if already exists in DB
          const rows = this.db.prepare('SELECT id, manifest FROM plugins').all() as Array<{ id: string; manifest: string }>;
          let existingRow = rows.find(row => {
            try {
              const m = JSON.parse(row.manifest);
              return m.id === manifest.id;
            } catch {
              return false;
            }
          });

          // Clean up legacy ext plugins (CommonJS strings) in DB
          if (existingRow) {
            let isLegacy = false;
            try {
              const hasZip = this.db.prepare('SELECT zip_package FROM plugins WHERE id = ?').get(existingRow.id) as any;
              if (!hasZip || !hasZip.zip_package) {
                isLegacy = true;
              }
            } catch {
              isLegacy = true;
            }
            if (isLegacy) {
              this.db.prepare('DELETE FROM plugins WHERE id = ?').run(existingRow.id);
              existingRow = undefined;
            }
          }
          
          let dbPluginId = existingRow?.id;
          
          if (!existingRow) {
            // Install new
            const installedManifest = await this.pluginHost.installPluginFromZip(zipBuffer);
            const newRows = this.db.prepare('SELECT id, manifest FROM plugins').all() as Array<{ id: string; manifest: string }>;
            const newRow = newRows.find(row => {
              try {
                return JSON.parse(row.manifest).id === manifest.id;
              } catch {
                return false;
              }
            });
            dbPluginId = newRow?.id;
          } else {
            const m = JSON.parse(existingRow.manifest);
            if (m.version !== manifest.version) {
              // Version mismatch: uninstall and reinstall
              await this.pluginHost.uninstallPlugin(existingRow.id);
              const installedManifest = await this.pluginHost.installPluginFromZip(zipBuffer);
              const newRows = this.db.prepare('SELECT id, manifest FROM plugins').all() as Array<{ id: string; manifest: string }>;
              const newRow = newRows.find(row => {
                try {
                  return JSON.parse(row.manifest).id === manifest.id;
                } catch {
                  return false;
                }
              });
              dbPluginId = newRow?.id;
            }
          }
          
          if (dbPluginId) {
            // Update DB status to active and execution_mode to worker
            this.db.prepare('UPDATE plugins SET execution_mode = ?, status = ? WHERE id = ?')
              .run('worker', 'active', dbPluginId);
            
            // Activate plugin
            await this.pluginHost.activatePlugin(dbPluginId);
          }
        } catch (err) {
          console.warn(`[Kernel] Soft-fail: Failed to seed external plugin ${file}:`, err);
        }
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
