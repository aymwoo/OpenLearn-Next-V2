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
import type {
  PlatformCommand,
  CommandHandler,
  CommandMetadata,
} from '../command-bus/index.js';
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
  setInterceptor(
    interceptor: (command: PlatformCommand) => Promise<void>,
  ): void | Promise<void>;
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
  getActionByToolName(
    toolName: string,
  ): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;

  /**
   * Find an action descriptor by its exact command type string.
   * Corresponds to ActionRegistry.getActionByCommandType() — made async for cross-runtime compatibility.
   */
  getActionByCommandType(
    commandType: string,
  ): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
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
   * Spawn a new background process.
   * Corresponds to ProcessManager.spawn() — made async for cross-runtime compatibility.
   * Payload tightened from `any` to `unknown` per D-11.
   */
  spawn(name: string, taskType: string, payload: unknown): string | Promise<string>;

  /**
   * Kill a running process by its id.
   * Corresponds to ProcessManager.kill() — made async for cross-runtime compatibility.
   */
  kill(processId: string): void | Promise<void>;

  /**
   * Register a handler for a task type.
   * Corresponds to ProcessManager.registerHandler() — made async for cross-runtime compatibility.
   */
  registerHandler(
    taskType: string,
    handler: ProcessHandler,
  ): void | Promise<void>;

  /**
   * Unregister a handler for a task type.
   * Corresponds to ProcessManager.unregisterHandler() — made async for cross-runtime compatibility.
   */
  unregisterHandler(taskType: string): void | Promise<void>;

  /**
   * Register a recurring interval process.
   * Corresponds to ProcessManager.registerInterval() — made async for cross-runtime compatibility.
   */
  registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
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
 * Implements a two-tier fallback: third-party AI provider (DB) → Gemini SDK.
 */
export interface IAIService {
  /**
   * Generate text via the configured AI provider or Gemini fallback.
   *
   * @param prompt - The user message / prompt text.
   * @param options - Optional system instruction and temperature.
   * @returns The trimmed response text.
   */
  generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number },
  ): Promise<string>;
}

// ── Token instances (D-13) ────────────────────────────────────────────────

/**
 * Token for ICommandBusService.
 * Identifier: @openlearn/core:ICommandBusService
 */
export const ICommandBusServiceToken = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService',
);

/**
 * Token for IEventBusService.
 * Identifier: @openlearn/core:IEventBusService
 */
export const IEventBusServiceToken = new Token<IEventBusService>(
  '@openlearn/core:IEventBusService',
);

/**
 * Token for IActionRegistryService.
 * Identifier: @openlearn/core:IActionRegistryService
 */
export const IActionRegistryServiceToken = new Token<IActionRegistryService>(
  '@openlearn/core:IActionRegistryService',
);

/**
 * Token for ICapabilityService.
 * Identifier: @openlearn/core:ICapabilityService
 * Capability ID: cap_plugin_management
 */
export const ICapabilityServiceToken = new Token<ICapabilityService>(
  '@openlearn/core:ICapabilityService',
);

/**
 * Token for IProcessService.
 * Identifier: @openlearn/core:IProcessService
 */
export const IProcessServiceToken = new Token<IProcessService>(
  '@openlearn/core:IProcessService',
);

/**
 * Token for IStorageService.
 * Identifier: @openlearn/core:IStorageService
 */
export const IStorageServiceToken = new Token<IStorageService>(
  '@openlearn/core:IStorageService',
);

/**
 * Token for IAIService.
 * Identifier: @openlearn/core:IAIService
 */
export const IAIServiceToken = new Token<IAIService>(
  '@openlearn/core:IAIService',
);

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
export const IDatabaseToken = new Token<SqliteDatabase>(
  '@openlearn/core:IDatabase',
);

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
export const IPluginHostToken = new Token<PluginHost>(
  '@openlearn/core:IPluginHost',
);

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
export const ICapabilityRegistryToken = new Token<CapabilityRegistry>(
  '@openlearn/core:ICapabilityRegistry',
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
export const ISemesterGradeServiceToken = new Token<ISemesterGradeService>(
  '@openlearn/core:ISemesterGradeService'
);

/**
 * Specification for a Student Learning Points Dimension.
 */
export interface PointsDimensionSpec {
  id: string;              // e.g. 'attendance', 'assignment', 'interactive_quiz', 'ai_practice'
  name: string;            // e.g. '课堂互动打卡', 'AI练习积分'
  category: 'builtin' | 'plugin';
  defaultWeight: number;   // e.g. 0.15 (15%)
  maxScore?: number;       // e.g. 100
  description?: string;
  pluginId?: string;
}

/**
 * Interface for PointsDimensionRegistry.
 */
export interface IPointsDimensionRegistry {
  registerDimension(spec: PointsDimensionSpec): void;
  getDimension(id: string): PointsDimensionSpec | undefined;
  listDimensions(): PointsDimensionSpec[];
}

export const IPointsDimensionRegistryToken = new Token<IPointsDimensionRegistry>(
  '@openlearn/core:IPointsDimensionRegistry'
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
    pluginId?: string
  ): Promise<PointLogItem>;
  getLogs(studentId: string, classId?: string): Promise<PointLogItem[]>;
  getStudentTotalByDimension(studentId: string, classId: string, dimensionId: string): Promise<number>;
  getStudentDimensionSummary(studentId: string, classId: string): Promise<Record<string, number>>;
}

export const IPointsLedgerServiceToken = new Token<IPointsLedgerService>(
  '@openlearn/core:IPointsLedgerService'
);

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
export const ILessonEngineServiceToken = new Token<ILessonEngineService>(
  '@openlearn/core:ILessonEngineService'
);

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
  '@openlearn/core:IClassroomRuntimeService'
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
export const IPresenceEngineServiceToken = new Token<IPresenceEngineService>(
  '@openlearn/core:IPresenceEngineService'
);

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
  '@openlearn/core:ITeachingCollaborationService'
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
  '@openlearn/core:ILearningAnalyticsService'
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
export const IAICapabilityServiceToken = new Token<IAICapabilityService>(
  '@openlearn/core:IAICapabilityService'
);

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
  '@openlearn/core:ICapabilityRuntimeService'
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
  '@openlearn/core:ICapabilityGovernanceService'
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
  '@openlearn/core:IPlatformServiceRegistryService'
);











