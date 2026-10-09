/**
 * IService interfaces and Token instances — centralized service contract definitions.
 *
 * This file defines the type-safe service interfaces (IService) and corresponding
 * Token instances for all 7 core subsystems. Plugin developers import from a single
 * entry point to get both the interface type and the DI Token.
 *
 * ## Design decisions
 *
 * - **All methods return Promise<T>** (D-10): Even currently-synchronous operations
 *   are wrapped in async signatures so the interface stays consistent across local
 *   and remote (Worker Thread) implementations in future phases (D-17).
 * - **No dispose/cleanup lifecycle** (D-05): IService interfaces are pure capability
 *   contracts; lifecycle management belongs to the DI container layer.
 * - **Return types tightened** (D-11): `any` narrowed to `unknown` or concrete types
 *   (e.g. `getAgentTools(): Promise<unknown[]>` instead of `Promise<any[]>`).
 *   Payload/params retain `unknown` where the caller defines the shape.
 * - **Token naming format `IServiceNameToken`** (D-13): Identifier `@openlearn/core:IServiceName`,
 *   validated at construction time by Token's TOKEN_NAME_RE regex.
 *
 * ## Usage
 *
 * ```ts
 * import { ICommandBusService, ICommandBusServiceToken } from './interfaces.js';
 * // In a plugin's activate(ctx):
 * const cmdBus = await ctx.resolve(ICommandBusServiceToken);
 * await cmdBus.execute(...);
 * ```
 */

import { Token } from './token.js';
import type { PlatformCommand, CommandHandler, CommandMetadata } from '../command-bus/index.js';
import type { PlatformEvent, EventSubscriber } from '../event-bus/index.js';
import type { ActionDescriptor } from '../registry/index.js';
import type { ProcessHandler } from '../process-manager/index.js';

export type { CommandHandler, CommandMetadata } from '../command-bus/index.js';
export type { EventSubscriber } from '../event-bus/index.js';

// ── 1. ICommandBusService ─────────────────────────────────────────────────

export interface ICommandBusService {
  /**
   * Execute a command through the full interceptor pipeline.
   * Corresponds to CommandBus.execute().
   */
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;

  /**
   * Register a handler for a command type.
   * Corresponds to CommandBus.registerHandler() — made async for cross-runtime compatibility.
   */
  registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;

  /**
   * Unregister a handler for a command type.
   * Corresponds to CommandBus.unregisterHandler() — made async for cross-runtime compatibility.
   */
  unregisterHandler(commandType: string): void | Promise<void>;

  /**
   * Create a command envelope with metadata.
   * Corresponds to CommandBus.createCommand() — made async for cross-runtime compatibility.
   */
  createCommand<T>(
    type: string,
    payload: T,
    actorId: string,
    metadata?: CommandMetadata,
  ): PlatformCommand<T> | Promise<PlatformCommand<T>>;

  /**
   * Set a command interceptor (capability check, high-risk approval, etc.).
   * Corresponds to CommandBus.setInterceptor() — made async for cross-runtime compatibility.
   */
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>;
}

// ── 2. IEventBusService ───────────────────────────────────────────────────

export interface IEventBusService {
  /**
   * Publish an event to all matching subscribers (including wildcard `*`).
   * Corresponds to EventBus.publish() — already async, kept async.
   */
  publish(event: PlatformEvent): Promise<void>;

  /**
   * Subscribe to events of a given type.
   * Corresponds to EventBus.subscribe() — made async for cross-runtime compatibility.
   */
  subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;

  /**
   * Unsubscribe from events of a given type.
   * Corresponds to EventBus.unsubscribe() — made async for cross-runtime compatibility.
   */
  unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
}

// ── 3. IActionRegistryService ─────────────────────────────────────────────

export interface IActionRegistryService {
  /**
   * Register an action descriptor (tool) discoverable by the AI Agent.
   * Corresponds to ActionRegistry.register() — made async for cross-runtime compatibility.
   */
  register(descriptor: ActionDescriptor): void | Promise<void>;

  /**
   * Unregister an action by its id.
   * Corresponds to ActionRegistry.unregister() — made async for cross-runtime compatibility.
   */
  unregister(id: string): void | Promise<void>;

  /**
   * Get all registered action descriptors.
   * Corresponds to ActionRegistry.getAllActions() — made async for cross-runtime compatibility.
   */
  getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;

  /**
   * Get tools formatted for @google/genai functionDeclarations.
   * Corresponds to ActionRegistry.getAgentTools() — made async for cross-runtime compatibility.
   * Return type tightened from `any[]` to `unknown[]` per D-11.
   */
  getAgentTools(): unknown[] | Promise<unknown[]>;

  /**
   * Find an action descriptor by its tool name (sanitized command type).
   * Corresponds to ActionRegistry.getActionByToolName() — made async for cross-runtime compatibility.
   */
  getActionByToolName(toolName: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;

  /**
   * Find an action descriptor by its exact command type string.
   * Corresponds to ActionRegistry.getActionByCommandType() — made async for cross-runtime compatibility.
   */
  getActionByCommandType(commandType: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
}

// ── 4. ICapabilityService ─────────────────────────────────────────────────

export interface ICapabilityService {
  /**
   * Grant a capability to an actor.
   * Corresponds to CapabilityGuard.grant() — made async for cross-runtime compatibility.
   */
  grant(actorId: string, cap: string): void | Promise<void>;

  /**
   * Revoke all capabilities from an actor.
   * Corresponds to CapabilityGuard.revokeAll() — made async for cross-runtime compatibility.
   */
  revokeAll(actorId: string): void | Promise<void>;

  /**
   * Check whether an actor has a required capability (supports wildcard matching).
   * Corresponds to CapabilityGuard.check() — made async for cross-runtime compatibility.
   */
  check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
}

// ── 5. IProcessService ────────────────────────────────────────────────────

export interface IProcessService {
  /**
   * 查询进程归属（B-5）。
   *
   * 存在的理由：`processId` 经**全局事件总线** `process.spawned` 广播，
   * 任何插件订阅即可拿到他人进程 id；而 `kill()` 在修复前只按 id UPDATE、
   * 无归属校验。判定归属需要这层查询。
   *
   * 可选：mock 实现或旧部署可缺省，缺省时归属校验退化为「不拦截」。
   */
  getProcessOwner?(processId: string): string | undefined;

  /**
   * 声明调用方对 ProcessManager 的所有权（B-5）。
   *
   * spawn / registerInterval 会把 owner 写入 `processes.plugin_id`（内存另有副本），
   * 供 kill() 的归属校验使用。因 spawn 的签名不能加参数，故用同步注入而非逐次传参。
   * 必须在插件激活、构建上下文**之前**调用。
   */
  setPluginOwner?(pluginId: string): void;

  /**
   * Spawn a new background process.
   * Corresponds to ProcessManager.spawn() — made async for cross-runtime compatibility.
   * Payload tightened from `any` to `unknown` per D-11.
   *
   * @param ownerHint 显式归属（B-5）。`wrapProcessManager` 的 per-plugin 包装层
   *   传入调用方插件 id —— `setPluginOwner` 的 `currentOwner` 是**全局单值**，
   *   只保证「激活期内 spawn」归属正确；插件运行期（HTTP handler / 定时器回调）
   *   spawn 的任务会错记到「最后激活的插件」名下。ownerHint 让 per-plugin 包装层
   *   显式携带归属，把归属精度从「激活期」扩展到整个插件生命周期。
   *   缺省回落 currentOwner（旧调用方行为不变）。
   */
  spawn(name: string, taskType: string, payload: unknown, ownerHint?: string): string | Promise<string>;

  /**
   * Kill a running process by its id.
   * Corresponds to ProcessManager.kill() — made async for cross-runtime compatibility.
   */
  kill(processId: string): void | Promise<void>;

  /**
   * Register a handler for a task type.
   * Corresponds to ProcessManager.registerHandler() — made async for cross-runtime compatibility.
   */
  registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;

  /**
   * Unregister a handler for a task type.
   * Corresponds to ProcessManager.unregisterHandler() — made async for cross-runtime compatibility.
   */
  unregisterHandler(taskType: string): void | Promise<void>;

  /**
   * Register a recurring interval process.
   * Corresponds to ProcessManager.registerInterval() — made async for cross-runtime compatibility.
   *
   * @param ownerHint 同 spawn —— per-plugin 包装层显式携带归属（B-5）。
   */
  registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
    ownerHint?: string,
  ): string | Promise<string>;

  /**
   * Restore running processes from DB after server restart.
   * Corresponds to ProcessManager.restore() — made async for cross-runtime compatibility.
   */
  restore(): void | Promise<void>;
}

// ── 6. IStorageService ────────────────────────────────────────────────────

/**
 * Kernel-level persistent key-value storage.
 *
 * Based on the wrappedStorage API from PluginRuntime (D-12).
 * Uses SQLite `plugin_storage` table with `'__kernel__'` namespace;
 * per-plugin isolation is enforced by the PluginRuntime wrapper layer.
 */
export interface IStorageService {
  /** Get a value by key. Returns `null` if the key does not exist. */
  get(key: string): Promise<unknown>;

  /** Set a value by key. Overwrites existing values. */
  set(key: string, value: unknown): Promise<void>;

  /** Delete a value by key. No-op if the key does not exist. */
  delete(key: string): Promise<void>;
}

// ── 7. IAIService ─────────────────────────────────────────────────────────

/**
 * Kernel-level AI text generation.
 *
 * Based on the wrappedAI.generateText API from PluginRuntime (D-12).
 * Delegates to the active third-party AI provider configured in the database.
 */
export interface IAIService {
  /**
   * Generate text via the configured OpenAI-compatible AI provider.
   *
   * @param prompt - The user message / prompt text.
   * @param options - Optional system instruction and temperature.
   * @returns The trimmed response text.
   */
  generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;

  /**
   * 注册插件 AI 上下文切片提供者（P2: ai.context.provider）。
   * fn 为服务端闭包（Inline 插件直接传函数），Agent 对话时按 lessonId 调用。
   * 仅 Inline 插件可用（Worker 序列化边界无法传递函数）。
   */
  registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
  unregisterAIContextProvider?(id: string): void;

  /**
   * P2: ai.agent.persona —— 注册 AI Agent 角色模板（教师聊天面板可选择）。
   * persona 为可序列化静态模板，Inline / Worker 插件均可注册；宿主内置角色亦可被同名覆盖。
   */
  registerAIPersona?(persona: AIPersonaDefinition): void;
  /** 列出全部角色模板（builtin + plugin）。 */
  listAIPersonas?(): AIPersonaDefinition[];
  /** 注销插件注册的角色（builtin 不可注销；仅注册者可注销自身模板）。 */
  unregisterAIPersona?(id: string): void;
}

/** P2: ai.agent.persona —— 角色模板定义（可序列化，跨 Worker 边界安全）。 */
export interface AIPersonaDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  instructionZh: string;
  instructionEn: string;
  icon?: string;
}

// ── Token instances (D-13) ────────────────────────────────────────────────

/**
 * Token for ICommandBusService.
 * Identifier: @openlearn/core:ICommandBusService
 */
export const ICommandBusServiceToken = new Token<ICommandBusService>('@openlearn/core:ICommandBusService');

/**
 * Token for IEventBusService.
 * Identifier: @openlearn/core:IEventBusService
 */
export const IEventBusServiceToken = new Token<IEventBusService>('@openlearn/core:IEventBusService');

/**
 * Token for IActionRegistryService.
 * Identifier: @openlearn/core:IActionRegistryService
 */
export const IActionRegistryServiceToken = new Token<IActionRegistryService>('@openlearn/core:IActionRegistryService');

/**
 * Token for ICapabilityService.
 * Identifier: @openlearn/core:ICapabilityService
 * Capability ID: cap_plugin_management
 */
export const ICapabilityServiceToken = new Token<ICapabilityService>('@openlearn/core:ICapabilityService');

/**
 * Token for IProcessService.
 * Identifier: @openlearn/core:IProcessService
 */
export const IProcessServiceToken = new Token<IProcessService>('@openlearn/core:IProcessService');

/**
 * Token for IStorageService.
 * Identifier: @openlearn/core:IStorageService
 */
export const IStorageServiceToken = new Token<IStorageService>('@openlearn/core:IStorageService');

/**
 * Token for IAIService.
 * Identifier: @openlearn/core:IAIService
 */
export const IAIServiceToken = new Token<IAIService>('@openlearn/core:IAIService');

// Self-contained SQLite surface so consumers (plugins) get a concrete type
// without needing `better-sqlite3` type declarations reachable in their package.
export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  // `any` (not `T`) because the real better-sqlite3 `Database.transaction`
  // returns a `Transaction<T>` wrapper; this keeps real `Database` assignable.
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): any;
  exec(sql: string): unknown;
  pragma(source: string, options?: unknown): unknown;
  close(): void;
}

/**
 * Token for Database.
 * Identifier: @openlearn/core:IDatabase
 */
export const IDatabaseToken = new Token<SqliteDatabase>('@openlearn/core:IDatabase');

import type { PluginHost } from '../plugin-host/index.js';
import type { PluginRuntimeComposition } from '../plugin-host/plugin-runtime-composition.js';
import type { PluginDistributionManager } from '../plugin-host/plugin-distribution-manager.js';
import type { PluginCapabilityGateway } from '../plugin-host/plugin-capability-gateway.js';
import type { UnifiedExtensionRegistry } from '../plugin-host/unified-extension-registry.js';
import type { PluginLifecycleManager } from '../plugin-host/plugin-lifecycle-manager.js';
import type { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';

/**
 * Token for PluginHost.
 * Identifier: @openlearn/core:IPluginHost
 */
export const IPluginHostToken = new Token<PluginHost>('@openlearn/core:IPluginHost');

/**
 * Token for Unified Plugin Lifecycle Manager (P7-A2 Stage 3).
 * Identifier: @openlearn/core:IPluginLifecycleManager
 */
export const IPluginLifecycleManagerToken = new Token<PluginLifecycleManager>(
  '@openlearn/core:IPluginLifecycleManager',
);

/**
 * Token for Unified Plugin Distribution Manager (P7-A2 Stage 3).
 * Identifier: @openlearn/core:IPluginDistributionManager
 */
export const IPluginDistributionManagerToken = new Token<PluginDistributionManager>(
  '@openlearn/core:IPluginDistributionManager',
);

/**
 * Token for Plugin Runtime Composition (P7-A2 Stage 3).
 * Identifier: @openlearn/core:IPluginRuntimeComposition
 */
export const IPluginRuntimeCompositionToken = new Token<PluginRuntimeComposition>(
  '@openlearn/core:IPluginRuntimeComposition',
);

/**
 * Token for Unified Extension Registry (P7-A2 Stage 3).
 * Identifier: @openlearn/core:IUnifiedExtensionRegistry
 */
export const IUnifiedExtensionRegistryToken = new Token<UnifiedExtensionRegistry>(
  '@openlearn/core:IUnifiedExtensionRegistry',
);

/**
 * Token for Plugin Capability Gateway (P7-A2 Stage 3).
 * Identifier: @openlearn/core:IPluginCapabilityGateway
 */
export const IPluginCapabilityGatewayToken = new Token<PluginCapabilityGateway>(
  '@openlearn/core:IPluginCapabilityGateway',
);

/**
 * Token for Capability Registry (P7-A2 Stage 3).
 * Identifier: @openlearn/core:ICapabilityRegistry
 */
export const ICapabilityRegistryToken = new Token<CapabilityRegistry>('@openlearn/core:ICapabilityRegistry');

/**
 * 用户会话桥接数据传输对象
 */
export interface AuthBridgeUser {
  userId: string;
  username: string;
  role: 'administrator' | 'teacher' | 'student';
  name?: string;
  email?: string;
  avatar?: string | null;
  classId?: string;
}

/**
 * 平台统一安全会话桥接服务接口
 */
export interface IAuthSessionBridgeService {
  createSession(user: AuthBridgeUser): Promise<{ token: string; maxAge: number }>;
}

/**
 * Token for Auth Session Bridge Service (LTI 1.3 / SSO).
 * Identifier: @openlearn/core:IAuthSessionBridgeService
 */
export const IAuthSessionBridgeToken = new Token<IAuthSessionBridgeService>(
  '@openlearn/core:IAuthSessionBridgeService',
  '1.0.0',
);

/**
 * Interface for SemesterGradeService.
 * Handles syncing final calculated regular scores into the host's semester grades system.
 */
export interface ISemesterGradeService {
  /**
   * Sync calculated regular score to host database structures.
   * Internal implementation handles mapping lessonId -> classId, ensuring the
   * representative assignment exists, and inserting/updating assignment_submissions.
   */
  saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
}

/**
 * Token for ISemesterGradeService.
 * Identifier: @openlearn/core:ISemesterGradeService
 */
export const ISemesterGradeServiceToken = new Token<ISemesterGradeService>('@openlearn/core:ISemesterGradeService');

/**
 * Specification for a Student Learning Points Dimension.
 */
export interface PointsDimensionSpec {
  id: string; // e.g. 'attendance', 'assignment', 'interactive_quiz', 'ai_practice'
  name: string; // e.g. '课堂互动打卡', 'AI练习积分'
  category: 'builtin' | 'plugin';
  defaultWeight: number; // e.g. 0.15 (15%)
  maxScore?: number; // e.g. 100
  description?: string;
  pluginId?: string;
}

/**
 * Interface for PointsDimensionRegistry.
 */
export interface IPointsDimensionRegistry {
  registerDimension(spec: PointsDimensionSpec): void;
  /**
   * 注销一个维度（审计 D-1）。
   *
   * 此前注册表只有增/查，插件停用后其维度永久留存 ——
   * `server/routes/grading.ts` 的 `listDimensions()` 会把已停用插件的维度
   * 一并计入学生档案雷达。**内置维度受保护，不可被插件注销**。
   */
  unregisterDimension(id: string): boolean;
  getDimension(id: string): PointsDimensionSpec | undefined;
  listDimensions(): PointsDimensionSpec[];
}

export const IPointsDimensionRegistryToken = new Token<IPointsDimensionRegistry>(
  '@openlearn/core:IPointsDimensionRegistry',
);

/**
 * Point Audit Log Item
 */
export interface PointLogItem {
  id: string;
  studentId: string;
  classId: string;
  dimensionId: string;
  pluginId?: string | null;
  deltaPoints: number;
  reason: string;
  createdAt: number;
}

/**
 * Interface for PointsLedgerService.
 */
export interface IPointsLedgerService {
  addPoints(
    studentId: string,
    classId: string,
    dimensionId: string,
    deltaPoints: number,
    reason: string,
    pluginId?: string,
  ): Promise<PointLogItem>;
  getLogs(studentId: string, classId?: string): Promise<PointLogItem[]>;
  getStudentTotalByDimension(studentId: string, classId: string, dimensionId: string): Promise<number>;
  getStudentDimensionSummary(studentId: string, classId: string): Promise<Record<string, number>>;
}

export const IPointsLedgerServiceToken = new Token<IPointsLedgerService>('@openlearn/core:IPointsLedgerService');

/**
 * Interface for LessonEngineService.
 */
export interface ILessonEngineService {
  getRuntime(): Promise<unknown>;
}

/**
 * Token for ILessonEngineService.
 * Identifier: @openlearn/core:ILessonEngineService
 */
export const ILessonEngineServiceToken = new Token<ILessonEngineService>('@openlearn/core:ILessonEngineService');

/**
 * Interface for ClassroomRuntimeService.
 */
export interface IClassroomRuntimeService {
  getRuntimeKernel(): Promise<unknown>;
}

/**
 * Token for IClassroomRuntimeService.
 * Identifier: @openlearn/core:IClassroomRuntimeService
 */
export const IClassroomRuntimeServiceToken = new Token<IClassroomRuntimeService>(
  '@openlearn/core:IClassroomRuntimeService',
);

/**
 * Interface for PresenceEngineService.
 */
export interface IPresenceEngineService {
  getPresenceEngine(): Promise<unknown>;
}

/**
 * Token for IPresenceEngineService.
 * Identifier: @openlearn/core:IPresenceEngineService
 */
export const IPresenceEngineServiceToken = new Token<IPresenceEngineService>('@openlearn/core:IPresenceEngineService');

/**
 * Interface for TeachingCollaborationService.
 */
export interface ITeachingCollaborationService {
  getCollaborationEngine(): Promise<unknown>;
}

/**
 * Token for ITeachingCollaborationService.
 * Identifier: @openlearn/core:ITeachingCollaborationService
 */
export const ITeachingCollaborationServiceToken = new Token<ITeachingCollaborationService>(
  '@openlearn/core:ITeachingCollaborationService',
);

/**
 * Interface for LearningAnalyticsService.
 */
export interface ILearningAnalyticsService {
  getAnalyticsEngine(): Promise<unknown>;
}

/**
 * Token for ILearningAnalyticsService.
 * Identifier: @openlearn/core:ILearningAnalyticsService
 */
export const ILearningAnalyticsServiceToken = new Token<ILearningAnalyticsService>(
  '@openlearn/core:ILearningAnalyticsService',
);

/**
 * Interface for AICapabilityService.
 */
export interface IAICapabilityService {
  getCapabilityKernel(): Promise<unknown>;
}

/**
 * Token for IAICapabilityService.
 * Identifier: @openlearn/core:IAICapabilityService
 */
export const IAICapabilityServiceToken = new Token<IAICapabilityService>('@openlearn/core:IAICapabilityService');

/**
 * Interface for CapabilityRuntimeService.
 */
export interface ICapabilityRuntimeService {
  getRuntimeKernel(): Promise<unknown>;
}

/**
 * Token for ICapabilityRuntimeService.
 * Identifier: @openlearn/core:ICapabilityRuntimeService
 */
export const ICapabilityRuntimeServiceToken = new Token<ICapabilityRuntimeService>(
  '@openlearn/core:ICapabilityRuntimeService',
);

/**
 * Interface for CapabilityGovernanceService.
 */
export interface ICapabilityGovernanceService {
  getGovernanceKernel(): Promise<unknown>;
}

/**
 * Token for ICapabilityGovernanceService.
 * Identifier: @openlearn/core:ICapabilityGovernanceService
 */
export const ICapabilityGovernanceServiceToken = new Token<ICapabilityGovernanceService>(
  '@openlearn/core:ICapabilityGovernanceService',
);

/**
 * Interface for PlatformServiceRegistryService.
 */
export interface IPlatformServiceRegistryService {
  getServiceRegistryKernel(): Promise<unknown>;
}

/**
 * Token for IPlatformServiceRegistryService.
 * Identifier: @openlearn/core:IPlatformServiceRegistryService
 */
export const IPlatformServiceRegistryToken = new Token<IPlatformServiceRegistryService>(
  '@openlearn/core:IPlatformServiceRegistryService',
);

/**
 * 课件运行时脚本描述 —— 由插件注册、在互动课件 iframe 内部执行的脚本。
 *
 * 互动课件运行在 `credentialless` + `sandbox="allow-scripts allow-forms allow-downloads"`
 * 的 iframe 中（无 `allow-same-origin`，即 opaque origin）：父窗口读不到课件内部状态，
 * 也无法在运行期向其中注入代码。服务端渲染课件时拼接 HTML
 * （`server/routes/shared.ts` 的 `injectLmsSdk()`）是平台唯一能向课件内投递代码的位置，
 * 本接口即该位置的扩展点。
 */
export interface CoursewareRuntimeScript {
  /** 脚本标识，同一 owner 内唯一；重复注册同一 id 视为覆盖 */
  id: string;
  /** 在课件 iframe 内执行的脚本源码（宿主会包进 `<script>` 标签） */
  source: string;
  /** 仅对指定课件生效（对应 `courseware.id`）；与 coursewareUuid 均缺省时为全局脚本 */
  coursewareId?: string;
  /** 仅对指定课件生效（对应 `courseware.uuid`） */
  coursewareUuid?: string;
  /** 注入位置，默认 'body-end'（Bridge SDK 之后，DOM 已可访问） */
  position?: 'head' | 'body-end';
  /** 执行顺序，升序；默认 100 */
  priority?: number;
}

/** 已注册的课件运行时脚本（补全了 owner / position / priority 的默认值） */
export interface IRegisteredCoursewareRuntimeScript extends CoursewareRuntimeScript {
  /** 注册方，通常为 pluginId */
  owner: string;
  position: 'head' | 'body-end';
  priority: number;
}

/**
 * 课件运行时脚本扩展点 —— 让插件拥有「跑在课件 iframe 内部」的代码。
 *
 * 宿主在 `injectLmsSdk()` 渲染课件时调用 `list()` 取出生效脚本并拼接注入；
 * 注册点本身是纯内存服务，无 I/O，故 `list()` 保持同步（渲染路径是同步函数）。
 */
export interface ICoursewareRuntimeScriptRegistry {
  /** 注册（或覆盖）脚本；owner 通常传 `ctx.pluginId` */
  register(owner: string, script: CoursewareRuntimeScript): void;
  /** 注销指定 owner 下的单个脚本 */
  unregister(owner: string, id: string): void;
  /** 清理某个 owner 的全部脚本（插件停用时调用）；省略 owner 则清空全部 */
  clear(owner?: string): void;
  /** 列出对目标课件生效的脚本，已按 priority 升序排序 */
  list(courseware?: { id?: string; uuid?: string }): IRegisteredCoursewareRuntimeScript[];
  /** 列出当前所有注册方 */
  listOwners(): string[];
}

/**
 * Token for ICoursewareRuntimeScriptRegistry.
 * Identifier: @openlearn/core:ICoursewareRuntimeScriptRegistry
 */
export const ICoursewareRuntimeScriptRegistryToken = new Token<ICoursewareRuntimeScriptRegistry>(
  '@openlearn/core:ICoursewareRuntimeScriptRegistry',
);

// ── Classroom Lifecycle & Interaction Engine Extensibility ─────────────────

/**
 * 课堂生命周期阶段
 */
export type ClassroomLifecycleStage =
  'PRE_CLASS_READY' | 'IN_CLASS_TEACHING' | 'WRAP_UP_EXIT_TICKET' | 'ARCHIVED_REPORT';

export interface StageGuardResult {
  allowed: boolean;
  reason?: string;
  guardIds?: string[];
  progress?: {
    current: number;
    target: number;
    unit?: string;
  };
}

export type ClassroomStageGuard = (
  fromStage: ClassroomLifecycleStage,
  toStage: ClassroomLifecycleStage,
  context: { lessonId: string; classId?: string; actorId: string },
) => boolean | StageGuardResult | Promise<boolean | StageGuardResult>;

export interface IClassroomLifecycleService {
  getStage(lessonId: string): Promise<ClassroomLifecycleStage>;
  transitionStage(
    lessonId: string,
    toStage: ClassroomLifecycleStage,
    actorId: string,
    classId?: string,
  ): Promise<{ success: boolean; stage: ClassroomLifecycleStage; reason?: string }>;
  registerStageGuard(owner: string, guard: ClassroomStageGuard): void;
  unregisterStageGuard(owner: string): void;
}

export const IClassroomLifecycleServiceToken = new Token<IClassroomLifecycleService>(
  '@openlearn/core:IClassroomLifecycleService',
);

/**
 * 互动运行时服务接口 —— 支持极速投票、抢答、结课通票，并支持第三方插件注册自定义互动
 */
export interface QuickActivityDescriptor {
  id: string;
  name: string;
  category: string;
  icon?: string;
  description?: string;
  supportedRoles?: ('teacher' | 'student')[];
}

export interface IInteractionRuntimeService {
  registerActivityProvider(owner: string, descriptor: QuickActivityDescriptor): void;
  unregisterActivityProvider(owner: string, id: string): void;
  listActivityProviders(): QuickActivityDescriptor[];
}

export const IInteractionRuntimeServiceToken = new Token<IInteractionRuntimeService>(
  '@openlearn/core:IInteractionRuntimeService',
);

/**
 * 课堂倒计时管理服务接口 —— 支持教师端与第三方插件控制全班倒计时并广播
 */
export interface ClassroomCountdownDescriptor {
  lessonId: string;
  totalDuration: number;
  timeRemaining: number;
  isRunning: boolean;
  isPaused: boolean;
  label: string;
  endsAt: number | null;
}

export interface IClassroomCountdownService {
  getCountdown(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  start(lessonId: string, duration: number, label?: string): Promise<ClassroomCountdownDescriptor>;
  pause(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  resume(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  reset(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  addTime(lessonId: string, seconds: number): Promise<ClassroomCountdownDescriptor>;
}

export const IClassroomCountdownServiceToken = new Token<IClassroomCountdownService>(
  '@openlearn/core:IClassroomCountdownService',
);

/**
 * 教学环节流转门禁上下文与结果定义
 */
export interface StageGuardContext {
  studentId: string;
  lessonId: string;
  currentStageId: string | null;
  targetStageId: string;
  metadata?: Record<string, unknown>;
}

export interface StageGuard {
  readonly id: string;
  readonly name: string;
  /** 优先级：数值越小越优先执行，默认 100 */
  readonly priority?: number;
  /** 核心判定逻辑 */
  canEnterStage(ctx: StageGuardContext): Promise<StageGuardResult>;
}

export interface IStageGuardService {
  /**
   * 注册守卫，返回注销函数。
   *
   * @param owner 注册方（通常是 pluginId）。**强烈建议提供**（I-3）：
   *   守卫按 `owner + id` 复合键存储，跨插件同名不再互相覆盖。
   *   旧实现只用 `guard.id` 作唯一键，实测两个插件都注册 `id:'gate'` 时
   *   后者静默覆盖前者 —— **一个守卫的拒绝被另一个插件无声吃掉**。
   *   省略 owner 时退化为旧语义并打告警。
   */
  registerGuard(guard: StageGuard, owner?: string): () => void;
  /** 注销守卫。省略 owner 时按「无 owner」注销（兼容旧调用）。 */
  unregisterGuard(guardId: string, owner?: string): void;
  /** 按注册方批量注销 —— 插件停用 / 热重载时用（I-3）。 */
  unregisterByOwner?(owner: string): number;
  listGuards(): StageGuard[];
  checkAccess(ctx: StageGuardContext): Promise<StageGuardResult>;
}

export const IStageGuardServiceToken = new Token<IStageGuardService>('@openlearn/core:IStageGuardService');

// ── 插件可解析的 Token 白名单（审计 E-2）─────────────────────────────────
//
// 背景：`ctx.resolve` 接受 `string | Token`。Token 对象路径天然安全 —— 插件必须
// import SDK 导出的常量才拿得到它。但**字符串路径**此前直接落到
// `serviceRegistry.resolveByName(name)`，那里是纯粹的 `registry.get(name)`，
// 没有任何门禁：插件只要知道一个内部 token 名（LessonEngine / ClassroomRuntime /
// Presence / Collaboration / Analytics 等 20+ 个内核服务），就能在 inline 模式下
// 拿到宿主内部服务实例（worker 模式有 computeAllowedWorkerTokens 兜底）。
//
// 本集合 = `packages/plugin-sdk/index.ts` value 导出的全部 Token（对插件作者的
// 公开承诺面）。字符串 resolve 只允许命中本集合；Token 对象路径不受限。
// **新增对外 Token 时同步加到这里**，否则插件用名字解析会被拒（报错信息
// 会指明，属显式失败而非静默降级）。
export const PLUGIN_RESOLVABLE_TOKENS = [
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
  IPlatformServiceRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  ICapabilityRegistryToken,
  IAuthSessionBridgeToken,
  ICoursewareRuntimeScriptRegistryToken,
  IStageGuardServiceToken,
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
  IClassroomCountdownServiceToken,
] as const;

// IActivityRegistryToken 定义在 activity-ecosystem（interfaces.ts import 它会形成
// 反向依赖），故按名字收录 —— 名字必须与 SDK value 导出的常量一致。
export const PLUGIN_RESOLVABLE_TOKEN_NAMES: ReadonlySet<string> = new Set([
  ...PLUGIN_RESOLVABLE_TOKENS.map((t) => t.name),
  '@openlearn/activity-ecosystem:IActivityRegistry',
]);
