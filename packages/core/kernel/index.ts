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
import { AssignmentEvalPlugin } from '../../plugins/assignment-eval.js';
import fs from 'fs';
import crypto from 'node:crypto';

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
  ISemesterGradeServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  ILessonEngineServiceToken,
  IClassroomRuntimeServiceToken,
  IPresenceEngineServiceToken,
  ITeachingCollaborationServiceToken,
  ILearningAnalyticsServiceToken,
  IAICapabilityServiceToken,
  ICapabilityRuntimeServiceToken,
  ICapabilityGovernanceServiceToken,
  IPlatformServiceRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
  ICapabilityRegistryToken,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';
import { SemesterGradeService } from '../di/semester-grade-service.js';
import { PointsDimensionRegistry } from '../di/points-dimension-registry.js';
import { PointsLedgerService } from '../di/points-ledger-service.js';
import { PluginHost } from '../plugin-host/index.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import { HotReloadController } from '../plugin-host/hot-reload.js';
import { LessonRuntime } from '../lesson-engine/index.js';
import { ClassroomRuntimeKernel } from '../classroom-runtime/index.js';
import { PresenceEngineKernel } from '../presence-engine/index.js';
import { CollaborationEngineKernel } from '../collaboration-engine/index.js';
import { AnalyticsEngineKernel } from '../analytics-engine/index.js';
import { AIRuntimeKernel } from '../ai/index.js';
import { AICapabilityKernel } from '../ai-capability/index.js';
import { CapabilityRuntimeKernel } from '../capability/index.js';
import { CapabilityGovernanceKernel } from '../capability-governance/index.js';
import { ServiceRegistryKernel } from '../service-registry/index.js';
import { PluginRuntimeComposition } from '../plugin-host/plugin-runtime-composition.js';
import { PluginDistributionManager } from '../plugin-host/plugin-distribution-manager.js';
import { PluginCapabilityGateway } from '../plugin-host/plugin-capability-gateway.js';
import { UnifiedExtensionRegistry } from '../plugin-host/unified-extension-registry.js';
import { PluginLifecycleManager } from '../plugin-host/plugin-lifecycle-manager.js';
import { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';
import { PlatformCompositionRoot, PluginCompositionModule } from '../bootstrap/composition/index.js';
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

  // P7-A2 Stage 2: 插件生态统一 facade（真实单例，委托给 PluginHost）
  public readonly pluginRuntimeComposition: PluginRuntimeComposition;
  public readonly pluginLifecycleManager: PluginLifecycleManager;
  public readonly pluginDistributionManager: PluginDistributionManager;
  public readonly unifiedExtensionRegistry: UnifiedExtensionRegistry;
  public readonly capabilityRegistry: CapabilityRegistry;
  public readonly pluginCapabilityGateway: PluginCapabilityGateway;
  public readonly lessonRuntime: LessonRuntime;
  public readonly classroomRuntime: ClassroomRuntimeKernel;
  public readonly presenceEngine: PresenceEngineKernel;
  public readonly collaborationEngine: CollaborationEngineKernel;
  public readonly analyticsEngine: AnalyticsEngineKernel;
  public readonly aiRuntime: AIRuntimeKernel;
  public readonly aiCapability: AICapabilityKernel;
  public readonly capabilityFrameworkRuntime: CapabilityRuntimeKernel;
  public readonly capabilityGovernance: CapabilityGovernanceKernel;
  public readonly platformServiceRegistryKernel: ServiceRegistryKernel;
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

    // AIRuntimeKernel & AICapabilityKernel — Layer 1
    this.aiRuntime = new AIRuntimeKernel();
    this.aiCapability = new AICapabilityKernel(this.aiRuntime);

    // CapabilityRuntimeKernel — Layer 1 (Platform Capability Framework)
    this.capabilityFrameworkRuntime = new CapabilityRuntimeKernel(this.aiCapability);

    // CapabilityGovernanceKernel — Layer 1 (Platform Capability Governance)
    this.capabilityGovernance = new CapabilityGovernanceKernel();

    // ServiceRegistryKernel — Layer 1 (Platform Service Registry)
    this.platformServiceRegistryKernel = new ServiceRegistryKernel();

    // AnalyticsEngineKernel — Layer 1 (Learning Analytics Engine)
    this.analyticsEngine = new AnalyticsEngineKernel();

    // CollaborationEngineKernel — Layer 1 (Teaching Collaboration Engine)
    this.collaborationEngine = new CollaborationEngineKernel();

    // PresenceEngineKernel — Layer 1 (Presence Tracking Engine)
    this.presenceEngine = new PresenceEngineKernel();

    // ClassroomRuntimeKernel — Layer 1 (Master runtime orchestrator)
    this.classroomRuntime = new ClassroomRuntimeKernel();

    // LessonRuntime — Layer 1 (depends on EventBus & AIService)
    this.lessonRuntime = new LessonRuntime({ eventBus: this.eventBus });
    this.lessonRuntime.aiInterface.setAIService(this.aiService);

    // Layer 1 — 依赖 Layer 0
    this.commandBus = new CommandBus(this.eventBus);
    this.actionRegistry = new ActionRegistry();

    // Layer 2 — 依赖 Kernel/db
    this.processManager = new ProcessManager(this);

    // EsmLoader — Layer 0（无依赖），用于 PluginRuntime 的 ESM 加载分支
    this.esmLoader = new NodeEsmLoader();

    // PluginHost — 依赖 ServiceRegistry + EsmLoader + db
    const pluginsDir = path.resolve(process.cwd(), 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    this.pluginHost = new PluginHost(this.serviceRegistry, this.esmLoader, this.db, pluginsDir);

    // Layer 3 — WorkerManager (depends on ServiceRegistry + CapabilityGuard)
    this.workerManager = new WorkerManager(this.serviceRegistry, this.capabilityGuard, this.db);
    // Wire WorkerManager into PluginHost via setter (avoids circular dependency)
    this.pluginHost.setWorkerManager(this.workerManager);

    // P7-A2 Stage 2: 实例化插件生态统一 facade（真实单例，委托给 PluginHost）
    // P7-A2 Stage 4: 复用 AICapabilityKernel 的真实能力注册表，使 capability gateway
    // 反映平台真实能力（而非空注册表）。
    const capabilityRegistry = this.aiCapability.registry;
    this.pluginRuntimeComposition = new PluginRuntimeComposition(this.pluginHost, this.workerManager);
    this.pluginLifecycleManager = new PluginLifecycleManager(this.pluginHost);
    this.pluginDistributionManager = new PluginDistributionManager(this.pluginHost);
    this.unifiedExtensionRegistry = new UnifiedExtensionRegistry();
    this.capabilityRegistry = capabilityRegistry;
    this.pluginCapabilityGateway = new PluginCapabilityGateway(capabilityRegistry);

    // P7-A2 Stage 2: 通过基础设施引用将真实实例接入平台组合根。
    // 组合失败仅告警、绝不阻断 Kernel 启动（保持可回退、低风险）。
    const infrastructureRefs = new Map<string, unknown>([
      ['pluginHost', this.pluginHost],
      ['contributionRegistry', this.pluginHost.getContributionRegistry()],
      ['runtimeComposition', this.pluginRuntimeComposition],
      ['lifecycleManager', this.pluginLifecycleManager],
      ['capabilityGateway', this.pluginCapabilityGateway],
      ['extensionRegistry', this.unifiedExtensionRegistry],
      ['distributionManager', this.pluginDistributionManager],
    ]);
    try {
      PlatformCompositionRoot.create()
        .registerModule(new PluginCompositionModule())
        .compose({ infrastructureRefs });
    } catch (e) {
      console.warn('[P7-A2] Plugin composition failed (non-fatal):', (e as Error).message);
    }

    // No more pluginRuntime (Phase 8 cleanup)

    // Register all IService instances into ServiceRegistry (D-14)
    // Must happen after all subsystems are created, before the interceptor
    this.serviceRegistry.register(IEventBusServiceToken, this.eventBus);
    this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard);
    this.serviceRegistry.register(IStorageServiceToken, this.storageService);
    this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus);
    this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry);
    this.serviceRegistry.register(IProcessServiceToken, this.processManager);
    this.serviceRegistry.register(IAIServiceToken, this.aiService);
    this.serviceRegistry.register(IDatabaseToken, this.db);
    this.serviceRegistry.register(IPluginHostToken, this.pluginHost);
    // P7-A2 Stage 3: 注册统一插件 facade，使插件可通过 ctx.resolve(token) 获取
    this.serviceRegistry.register(IPluginLifecycleManagerToken, this.pluginLifecycleManager);
    this.serviceRegistry.register(IPluginDistributionManagerToken, this.pluginDistributionManager);
    this.serviceRegistry.register(IPluginRuntimeCompositionToken, this.pluginRuntimeComposition);
    this.serviceRegistry.register(IUnifiedExtensionRegistryToken, this.unifiedExtensionRegistry);
    this.serviceRegistry.register(IPluginCapabilityGatewayToken, this.pluginCapabilityGateway);
    this.serviceRegistry.register(ICapabilityRegistryToken, this.capabilityRegistry);
    this.serviceRegistry.register(ISemesterGradeServiceToken, new SemesterGradeService(this.db as any));
    this.serviceRegistry.register(IPointsDimensionRegistryToken, new PointsDimensionRegistry());
    this.serviceRegistry.register(IPointsLedgerServiceToken, new PointsLedgerService(this.db as any));
    this.serviceRegistry.register(ILessonEngineServiceToken, { getRuntime: async () => this.lessonRuntime } as any);
    this.serviceRegistry.register(IClassroomRuntimeServiceToken, { getRuntimeKernel: async () => this.classroomRuntime } as any);
    this.serviceRegistry.register(IPresenceEngineServiceToken, { getPresenceEngine: async () => this.presenceEngine } as any);
    this.serviceRegistry.register(ITeachingCollaborationServiceToken, { getCollaborationEngine: async () => this.collaborationEngine } as any);
    this.serviceRegistry.register(ILearningAnalyticsServiceToken, { getAnalyticsEngine: async () => this.analyticsEngine } as any);
    this.serviceRegistry.register(IAICapabilityServiceToken, { getCapabilityKernel: async () => this.aiCapability } as any);
    this.serviceRegistry.register(ICapabilityRuntimeServiceToken, { getRuntimeKernel: async () => this.capabilityFrameworkRuntime } as any);
    this.serviceRegistry.register(ICapabilityGovernanceServiceToken, { getGovernanceKernel: async () => this.capabilityGovernance } as any);
    this.serviceRegistry.register(IPlatformServiceRegistryToken, { getServiceRegistryKernel: async () => this.platformServiceRegistryKernel } as any);










    // Capability check interceptor
    this.commandBus.setInterceptor(async (command) => {
      const action = this.actionRegistry.getActionByCommandType(command.type);
      if (action) {
        // Validate payload using inputSchema if available
        if (action.inputSchema) {
          const errors = validateJsonSchema(command.payload, action.inputSchema);
          if (errors.length > 0) {
            throw new Error(`[PayloadValidationError] Invalid command payload for ${command.type}: ${errors.join('; ')}`);
          }
        }
        const isAdmin = command.actorId === 'role:administrator' || 
                        command.actorId === 'admin' ||
                        command.actorId === 'usr_admin' ||
                        command.actorId === 'admin-demo' ||
                        command.actorId?.endsWith(':administrator') || 
                        command.actorId?.endsWith(':admin') ||
                        command.actorId?.includes(':administrator') ||
                        command.actorId?.includes(':admin');

        if (action.capabilityRequired && !isAdmin) {
          const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
          if (!allowed) {
            throw new Error(`[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`);
          }
        }

        if (action.isHighRisk && command.metadata?.approved !== true) {
          if (isAdmin) {
            console.log(`[Security] Command ${command.type} initiated by Administrator (${command.actorId}). Bypassing human approval.`);
          } else {
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
      }
    });

    // v5.1: 注册插件共享模块（ctx.require 白名单）
    import('../plugin-host/context-builder.js').then(m => m.bootstrapSharedModules()).catch(err => {
      console.warn('[Kernel] Failed to bootstrap shared modules:', err.message);
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
    // 0. 迁移 DB 中的旧插件到文件系统（幂等）— Phase 7
    await this.migratePluginsToFilesystem();

    const systemPlugins = [
      { id: '@openlearn/plugin-vfs', mod: VfsPlugin, name: 'Virtual File System Plugin', critical: true },
      { id: '@openlearn/plugin-process', mod: ProcessPlugin, name: 'Background Process Plugin', critical: true },
      { id: '@openlearn/plugin-management', mod: ManagementPlugin, name: 'LMS Management Plugin', critical: true },
      { id: '@openlearn/plugin-builtin', mod: BuiltinPlugin, name: 'Classroom Builtin Plugin', critical: true },
      { id: '@openlearn/plugin-ai-planner', mod: AiPlannerPlugin, name: 'AI Planner Plugin', critical: false },
      { id: '@openlearn/plugin-ai-submit-injector', mod: AiSubmitInjectorPlugin, name: 'AI Submit Injector Plugin', critical: false },
      { id: '@openlearn/plugin-assignment-eval', mod: AssignmentEvalPlugin, name: 'Assignment Evaluation and Peer Review Plugin', critical: false }
    ];

    for (const plugin of systemPlugins) {
      try {
        let row = this.db.prepare('SELECT id FROM plugins WHERE id = ?')
          .get(plugin.id) as { id: string } | undefined;
        
        if (!row) {
          this.db.prepare(
            'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            plugin.id,
            plugin.name,
            JSON.stringify(plugin.mod.manifest),
            '',    // source_code: system plugins are preloaded in-memory
            null,  // file_path: system plugins have no file
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

    // Seeding external ZIP plugins - Wave 4 (Phase 8) - DISABLED
    // We only preserve system core plugins. Third-party plugins should be uploaded manually via App Store.

    // Restore all other active ESM plugins from database
    try {
      await this.pluginHost.restoreActivePlugins();
    } catch (err) {
      console.error('[Kernel] Failed to restore active plugins:', err);
    }
  }

  /**
   * Phase 7: 将 DB 中存有 source_code 的旧插件迁移到文件系统（幂等）
   */
  private async migratePluginsToFilesystem(): Promise<void> {
    const plugins = this.db.prepare(
      "SELECT id, source_code, manifest FROM plugins WHERE source_code != '' AND source_code IS NOT NULL",
    ).all() as Array<{ id: string; source_code: string; manifest: string }>;

    if (plugins.length === 0) return;

    console.log(`[Migration] Found ${plugins.length} plugin(s) to migrate to filesystem`);

    const pluginsDir = path.resolve(process.cwd(), 'plugins');
    for (const p of plugins) {
      const pluginDir = path.join(pluginsDir, p.id);
      const indexPath = path.join(pluginDir, 'index.js');
      const manifestPath = path.join(pluginDir, 'manifest.json');

      // 跳过已迁移的（文件已存在）
      if (fs.existsSync(indexPath)) {
        this.db.prepare('UPDATE plugins SET source_code = ?, file_path = ? WHERE id = ?')
          .run('', indexPath, p.id);
        continue;
      }

      try {
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(indexPath, p.source_code, 'utf-8');
        if (!fs.existsSync(manifestPath)) {
          fs.writeFileSync(manifestPath, p.manifest, 'utf-8');
        }
        this.db.prepare('UPDATE plugins SET source_code = ?, file_path = ? WHERE id = ?')
          .run('', indexPath, p.id);
        console.log(`[Migration] Plugin "${p.id}" migrated to ${indexPath}`);
      } catch (err) {
        console.error(`[Migration] Failed to migrate plugin "${p.id}":`, err);
      }
    }

    console.log('[Migration] Plugin migration complete');
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

// Singleton export - Lazy evaluated via Proxy to prevent instant creation during test imports
let _kernelContainer: Kernel | undefined;
export const kernelContainer = new Proxy({} as Kernel, {
  get(target, prop, receiver) {
    if (!_kernelContainer) {
      _kernelContainer = new Kernel();
      _kernelContainer.initAuditLog();
    }
    return Reflect.get(_kernelContainer, prop, receiver);
  },
  set(target, prop, value, receiver) {
    if (!_kernelContainer) {
      _kernelContainer = new Kernel();
      _kernelContainer.initAuditLog();
    }
    return Reflect.set(_kernelContainer, prop, value, receiver);
  }
});

// Recursive JSON Schema Validator Helper
function validateJsonSchema(data: any, schema: any): string[] {
  if (!schema) return [];
  const errors: string[] = [];

  const type = schema.type;
  if (type === 'OBJECT') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push(`Expected object, got ${typeof data}`);
      return errors;
    }
    
    // Check required properties
    if (schema.required && Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in data) || data[req] === undefined) {
          errors.push(`Missing required property "${req}"`);
        }
      }
    }
    
    // Check properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const key in schema.properties) {
        const hasProp = key in data && data[key] !== undefined;
        if (hasProp) {
          const subErrors = validateJsonSchema(data[key], schema.properties[key]);
          for (const err of subErrors) {
            errors.push(`property "${key}": ${err}`);
          }
        }
      }
    }
  } else if (type === 'ARRAY') {
    if (!Array.isArray(data)) {
      errors.push(`Expected array, got ${typeof data}`);
      return errors;
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const subErrors = validateJsonSchema(data[i], schema.items);
        for (const err of subErrors) {
          errors.push(`item at index ${i}: ${err}`);
        }
      }
    }
  } else if (type === 'STRING') {
    if (typeof data !== 'string') {
      errors.push(`Expected string, got ${typeof data}`);
    }
  } else if (type === 'NUMBER') {
    if (typeof data !== 'number' || isNaN(data)) {
      errors.push(`Expected number, got ${typeof data}`);
    }
  } else if (type === 'BOOLEAN') {
    if (typeof data !== 'boolean') {
      errors.push(`Expected boolean, got ${typeof data}`);
    }
  }
  
  return errors;
}
