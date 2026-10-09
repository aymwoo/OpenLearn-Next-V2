import { EventBus } from '../event-bus/index.js';
import { CommandBus } from '../command-bus/index.js';
import { ActionRegistry } from '../registry/index.js';
import { CapabilityGuard } from '../capability/index.js';
import { ProcessManager } from '../process-manager/index.js';
import { NodeEsmLoader } from '../esm-loader/index.js';
import { db, readPool, getReadDb, queryRead, queryReadOne, checkpoint } from '../db/index.js';
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
  IStageGuardServiceToken,
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
  IAuthSessionBridgeToken,
  ICoursewareRuntimeScriptRegistryToken,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';
import { SemesterGradeService } from '../di/semester-grade-service.js';
import { PointsDimensionRegistry } from '../di/points-dimension-registry.js';
import { PointsLedgerService } from '../di/points-ledger-service.js';
import { AuthSessionBridgeService } from '../di/auth-session-bridge-service.js';
import { CoursewareRuntimeScriptRegistry } from '../di/courseware-runtime-script-registry.js';
import { PluginHost } from '../plugin-host/index.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import { HotReloadController } from '../plugin-host/hot-reload.js';
import { LessonRuntime, defaultStageGuardPipeline } from '../lesson-engine/index.js';
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
  public readonly readPool = readPool;
  public readonly getReadDb = getReadDb;
  public readonly queryRead = queryRead;
  public readonly queryReadOne = queryReadOne;
  public readonly checkpoint = checkpoint;
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

  /**
   * @param opts.pluginsDir - 插件产物目录。生产默认 `<cwd>/plugins`；
   *   测试**必须**显式传入临时目录，否则插件产物会落进工作树。
   *
   * ## 为什么要开这个口子（H-1）
   *
   * 原本这里硬编码 `path.resolve(process.cwd(), 'plugins')` 且不可覆盖。
   * 后果不只是「测试会弄脏工作树」，更根本的是 **Kernel 在这个维度上不可测** ——
   * 没有任何办法在测试里把插件产物引到别处，于是污染一直无人察觉：
   * 实测仓库 `plugins/` 下积累了 **1705 个孤儿目录 / 24MB**，且每次 `pnpm test` 继续增长。
   * 该目录被 `.gitignore` 忽略，所以 `git status` 完全看不见。
   *
   * 加可选参数后，生产行为**逐字节不变**（默认值相同），而测试可把产物引到
   * `os.tmpdir()`。`vitest.setup.ts` 的全局守卫会把「仍写工作树」变成硬失败，
   * 防止将来有人再引入同类调用。
   */
  constructor(opts?: { pluginsDir?: string }) {
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
    const pluginsDir = opts?.pluginsDir ?? path.resolve(process.cwd(), 'plugins');
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
      PlatformCompositionRoot.create().registerModule(new PluginCompositionModule()).compose({ infrastructureRefs });
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
    this.serviceRegistry.register(IClassroomRuntimeServiceToken, {
      getRuntimeKernel: async () => this.classroomRuntime,
    } as any);
    this.serviceRegistry.register(IPresenceEngineServiceToken, {
      getPresenceEngine: async () => this.presenceEngine,
    } as any);
    this.serviceRegistry.register(ITeachingCollaborationServiceToken, {
      getCollaborationEngine: async () => this.collaborationEngine,
    } as any);
    this.serviceRegistry.register(ILearningAnalyticsServiceToken, {
      getAnalyticsEngine: async () => this.analyticsEngine,
    } as any);
    this.serviceRegistry.register(IAICapabilityServiceToken, {
      getCapabilityKernel: async () => this.aiCapability,
    } as any);
    this.serviceRegistry.register(ICapabilityRuntimeServiceToken, {
      getRuntimeKernel: async () => this.capabilityFrameworkRuntime,
    } as any);
    this.serviceRegistry.register(ICapabilityGovernanceServiceToken, {
      getGovernanceKernel: async () => this.capabilityGovernance,
    } as any);
    this.serviceRegistry.register(IPlatformServiceRegistryToken, {
      getServiceRegistryKernel: async () => this.platformServiceRegistryKernel,
    } as any);
    this.serviceRegistry.register(IAuthSessionBridgeToken, new AuthSessionBridgeService(this.db as any));
    // 课件运行时脚本扩展点：让插件拥有「跑在互动课件 iframe 内部」的代码
    // （iframe 为 credentialless + 无 allow-same-origin，父窗口无法注入，只能由服务端渲染时拼接）
    this.serviceRegistry.register(ICoursewareRuntimeScriptRegistryToken, new CoursewareRuntimeScriptRegistry());

    // 教学环节流转门禁（插件可注册守卫，如「随堂测验达标」「前置实验已提交」）。
    // 必须注册**单例** `defaultStageGuardPipeline`：LessonRuntime 在未显式注入时
    // 也回退到该单例（lesson-runtime.ts），若此处 new 一个新实例，
    // 插件经 ctx.resolve() 注册的守卫与运行时实际校验的管道将不是同一个对象（split-brain）。
    this.serviceRegistry.register(IStageGuardServiceToken, defaultStageGuardPipeline as any);

    // Capability check interceptor
    this.commandBus.setInterceptor(async (command) => {
      const action = this.actionRegistry.getActionByCommandType(command.type);
      if (action) {
        // Validate payload using inputSchema if available
        if (action.inputSchema) {
          const errors = validateJsonSchema(command.payload, action.inputSchema);
          if (errors.length > 0) {
            throw new Error(
              `[PayloadValidationError] Invalid command payload for ${command.type}: ${errors.join('; ')}`,
            );
          }
        }
        const isAdmin =
          command.actorId === 'role:administrator' ||
          command.actorId === 'admin' ||
          command.actorId === 'usr_admin' ||
          command.actorId === 'admin-demo' ||
          command.actorId?.endsWith(':administrator') ||
          command.actorId?.endsWith(':admin');

        if (action.capabilityRequired && !isAdmin) {
          const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
          if (!allowed) {
            throw new Error(
              `[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`,
            );
          }
        }

        if (action.isHighRisk && command.metadata?.approved !== true) {
          if (isAdmin) {
            console.log(
              `[Security] Command ${command.type} initiated by Administrator (${command.actorId}). Bypassing human approval.`,
            );
          } else {
            const stmt = this.db.prepare(
              'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?, ?, ?, ?, ?)',
            );
            stmt.run(command.id, command.type, JSON.stringify(command.payload), command.actorId, Date.now());

            this.eventBus.publish({
              id: uuidv7(),
              type: 'approval.requested',
              source: 'kernel.security',
              payload: { commandId: command.id, commandType: command.type },
              timestamp: Date.now(),
              correlationId: command.id,
            });

            throw new Error(
              `[Security] Command ${command.type} requires human approval. It has been queued to pending actions.`,
            );
          }
        }
      } else {
        // ── Default-deny：未注册 action descriptor 的命令一律拒绝派发 ──────────
        //
        // 修复审计 H-1：此前 interceptor 写成 `if (action) { ... }` 且**无 else 分支**，
        // 等价于 default-allow —— 任何只调用 `commandBus.registerHandler()` 而未在
        // actionRegistry 登记的命令，对任意已登录角色（含 student）都**无任何授权检查**。
        //
        // 为什么必须 default-deny：action descriptor 是命令的**唯一声明式授权点**
        // （capabilityRequired + isHighRisk + inputSchema 三者都在其中）。
        // descriptor 缺失 ⇒ 没有任何可执行的授权意图 ⇒ 不能推定为放行。
        //
        // 修复方式：命令实现方补 actionRegistry.register()。
        // 不要在此加豁免名单 —— 豁免只是把缺口从「静默」变成「显式且无人复审」。
        //
        // 排查提示：`scripts/plugin-command-audit.mjs` 可列出所有「有 handler 无 action」
        // 的命令（历史上是 5 个 classroom.countdown.*，已在 server/routes/classroom.ts 补齐）。
        throw new Error(
          `[Security] Command "${command.type}" has no registered action descriptor and is denied by default. ` +
            `Only commands registered via actionRegistry.register() may be dispatched. ` +
            `If you own this command, register an ActionDescriptor (capabilityRequired + inputSchema).`,
        );
      }
    });

    // v5.1: 注册插件共享模块（ctx.require 白名单）
    import('../plugin-host/context-builder.js')
      .then((m) => m.bootstrapSharedModules())
      .catch((err) => {
        console.warn('[Kernel] Failed to bootstrap shared modules:', err.message);
      });

    // Auto-bootstrap system critical plugins (VFS, Process) - Wave 1 (Phase 8)
    this.ready = this.bootstrapSystemPlugins().catch((err) => {
      console.error('[Kernel] Critical system plugin bootstrap failed:', err);
      process.exit(1); // Hard crash
    });

    // Phase 7: 开发模式热重载
    if (process.env.NODE_ENV === 'development') {
      // 审计 R-2：watchDir 必须取自宿主实际使用的目录（`getPluginsDir()`），
      // 而不是再从 cwd 推导一遍 —— Kernel 支持注入 pluginsDir（测试与
      // 自托管安装场景），自己再算一次就与宿主分叉：监听的目录不是
      // 真正安装插件的目录，热重载形同虚设，甚至可能 watch 到无关目录。
      const watchDir = this.pluginHost.getPluginsDir();
      try {
        const hotReload = new HotReloadController(this.pluginHost, watchDir);
        this.pluginHost.setHotReloadController(hotReload);
        hotReload.start().catch((err) => {
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
      {
        id: '@openlearn/plugin-ai-submit-injector',
        mod: AiSubmitInjectorPlugin,
        name: 'AI Submit Injector Plugin',
        critical: false,
      },
      {
        id: '@openlearn/plugin-assignment-eval',
        mod: AssignmentEvalPlugin,
        name: 'Assignment Evaluation and Peer Review Plugin',
        critical: false,
      },
    ];

    for (const plugin of systemPlugins) {
      try {
        let row = this.db.prepare('SELECT id FROM plugins WHERE id = ?').get(plugin.id) as { id: string } | undefined;

        if (!row) {
          this.db
            .prepare(
              'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              plugin.id,
              plugin.name,
              JSON.stringify(plugin.mod.manifest),
              '', // source_code: system plugins are preloaded in-memory
              null, // file_path: system plugins have no file
              'installed',
              Date.now(),
              'esm',
              'inline',
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
    const plugins = this.db
      .prepare("SELECT id, source_code, manifest FROM plugins WHERE source_code != '' AND source_code IS NOT NULL")
      .all() as Array<{ id: string; source_code: string; manifest: string }>;

    if (plugins.length === 0) return;

    console.log(`[Migration] Found ${plugins.length} plugin(s) to migrate to filesystem`);

    // 用 this.pluginHost.pluginsDir 而非再次 `path.resolve(process.cwd(),'plugins')`。
    //
    // 这里是 H-1 的一个残留：Kernel 构造器与 kernelContainer 的 env 覆盖都只作用于
    // `this.pluginHost` 持有的那一份路径，本函数却自己又算了一遍 cwd/plugins ——
    // 于是测试即便把 pluginHost 重定向到临时目录，迁移仍写进工作树。
    // 症状很隐蔽：宿主日志里只有一行 `[Migration] Failed to migrate ...`，
    // 而 `plugins/` 下悄悄多出目录（被 .gitignore 忽略，git status 看不见）。
    //
    // 读取宿主实际使用的那个值，而不是重新推导 —— 两个来源不可能再分叉。
    const pluginsDir = this.pluginHost.getPluginsDir();
    for (const p of plugins) {
      const pluginDir = path.join(pluginsDir, p.id);
      const indexPath = path.join(pluginDir, 'index.js');
      const manifestPath = path.join(pluginDir, 'manifest.json');

      // 跳过已迁移的（文件已存在）
      if (fs.existsSync(indexPath)) {
        this.db.prepare('UPDATE plugins SET source_code = ?, file_path = ? WHERE id = ?').run('', indexPath, p.id);
        continue;
      }

      try {
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(indexPath, p.source_code, 'utf-8');
        if (!fs.existsSync(manifestPath)) {
          fs.writeFileSync(manifestPath, p.manifest, 'utf-8');
        }
        this.db.prepare('UPDATE plugins SET source_code = ?, file_path = ? WHERE id = ?').run('', indexPath, p.id);
        console.log(`[Migration] Plugin "${p.id}" migrated to ${indexPath}`);
      } catch (err) {
        console.error(`[Migration] Failed to migrate plugin "${p.id}":`, err);
      }
    }

    console.log('[Migration] Plugin migration complete');
  }

  // Subscribe to all events and log them to DB
  public initAuditLog() {
    // 惰性 prepare + 缓存：课堂事件统一走总线后写入频次显著上升，逐次 prepare
    // 会成为热点。列是否存在只在首次写入时探测一次（PRAGMA 很便宜）。
    let stmt: { run: (...params: unknown[]) => unknown } | null = null;
    let hasLessonIdColumn: boolean | null = null;

    this.eventBus.subscribe('*', (event) => {
      const values: unknown[] = [
        event.id,
        event.type,
        event.source,
        JSON.stringify(event.payload),
        event.timestamp,
        event.correlationId || null,
      ];

      if (hasLessonIdColumn === null) {
        const columns = this.db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
        hasLessonIdColumn = columns.some((c) => c.name === 'lesson_id');
        stmt = this.db.prepare(hasLessonIdColumn ? INSERT_EVENT_WITH_LESSON : INSERT_EVENT_LEGACY);
      }

      if (hasLessonIdColumn) {
        stmt!.run(...values, extractEventLessonId(event.payload));
      } else {
        stmt!.run(...values);
      }
    });
  }
}

const INSERT_EVENT_WITH_LESSON =
  'INSERT INTO events (id, type, source, payload, timestamp, correlationId, lesson_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
const INSERT_EVENT_LEGACY =
  'INSERT INTO events (id, type, source, payload, timestamp, correlationId) VALUES (?, ?, ?, ?, ?, ?)';

/**
 * 从事件 payload 中提取课节 ID，写入 `events.lesson_id` 以支持「按课堂重放」。
 * 只认两种常见拼写；取不到就留 NULL（事件仍会完整入库）。
 */
function extractEventLessonId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['lessonId', 'lesson_id']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * 读取 `OPENLEARN_PLUGINS_DIR` 覆盖值。
 *
 * ## 为什么需要（H-1）
 *
 * `kernelContainer` 是懒加载单例，内部 `new Kernel()` 无参 ⇒ 用默认的
 * `<cwd>/plugins`。而 `server/__tests__/` 与 `packages/core/__tests__/` 里有
 * **数十个**测试文件 import 它，其中一部分会安装插件。这些测试无法逐个改造
 * （单例是 import 进来的，没有注入点），于是插件产物一律落进工作树。
 *
 * 选环境变量而非改所有测试文件，理由：单例没有构造注入点，而 env 是唯一能在
 * 「import 之前」生效的通道。`vitest.setup.ts` 在所有测试模块之前运行，正是
 * 设置它的位置。
 *
 * 生产不设这个变量 ⇒ 行为与从前**逐字节相同**。
 *
 * ## 为什么在 Vitest 下改为抛错而非返回 undefined
 *
 * 原本查不到就返回 undefined、回落 `cwd/plugins`。全量实测仍留下一个残留目录：
 * 某个 worker 在 setup 赋值**之前**就构造了 Kernel（`process.env` 赋值与模块求值的
 * 先后在不同 pool 下并不稳定），迁移于是把插件产物写进了工作树。
 *
 * 那类静默写入正是 H-1 要消灭的东西本身 —— 且**守卫拦不住它**，
 * 因为写入发生在守卫够不到的上下文里（子进程 / worker 线程各有自己的 `node:fs` 实例，
 * patch 不传播过去）。
 *
 * 与其继续逐个 pool 追「哪个上下文抢跑」，不如把这条前提变成**显式契约**：
 * 测试环境下拿不到 pluginsDir 就是配置错误，当场抛错并指明修法。
 *
 * 代价：某个测试若确实漏了注入，会从「静默污染工作树」变成「测试红」——
 * 这是想要的失败方向，且比 `git status` 看不见的磁盘垃圾容易定位得多。
 */
function resolvePluginsDirOverride(): string | undefined {
  const raw = process.env.OPENLEARN_PLUGINS_DIR;
  if (typeof raw === 'string' && raw.length > 0) return raw;

  if (process.env.VITEST) {
    throw new Error(
      '[H-1] 测试环境下未能确定插件目录，拒绝回退到 process.cwd()/plugins。\n' +
        '  原因：回退会把插件产物写进仓库工作树；该目录被 .gitignore 忽略，污染完全隐形。\n' +
        '  修法（择一）：\n' +
        '    1. 该测试自己 new Kernel({ pluginsDir })，用 __tests__/helpers/plugins-dir 的\n' +
        "       createPluginsDir('用途') 取得，并在 afterEach 里 cleanupPluginsDir；\n" +
        '    2. 若用的是 kernelContainer 单例，确认它是在 vitest.setup.ts 赋值\n' +
        '       OPENLEARN_PLUGINS_DIR 之后才被首次访问。',
    );
  }
  return undefined;
}

// Singleton export - Lazy evaluated via Proxy to prevent instant creation during test imports
let _kernelContainer: Kernel | undefined;
function ensureKernelContainer(): Kernel {
  if (!_kernelContainer) {
    // 测试经 vitest.setup.ts 注入临时目录；生产无此变量，行为不变
    _kernelContainer = new Kernel({ pluginsDir: resolvePluginsDirOverride() });
    _kernelContainer.initAuditLog();
  }
  return _kernelContainer;
}
export const kernelContainer = new Proxy({} as Kernel, {
  get(target, prop, receiver) {
    return Reflect.get(ensureKernelContainer(), prop, receiver);
  },
  set(target, prop, value, receiver) {
    return Reflect.set(ensureKernelContainer(), prop, value, receiver);
  },
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
