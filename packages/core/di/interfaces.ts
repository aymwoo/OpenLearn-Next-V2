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
  registerHandler(commandType: string, handler: CommandHandler): Promise<void>;

  /**
   * Unregister a handler for a command type.
   * Corresponds to CommandBus.unregisterHandler() — made async for cross-runtime compatibility.
   */
  unregisterHandler(commandType: string): Promise<void>;

  /**
   * Create a command envelope with metadata.
   * Corresponds to CommandBus.createCommand() — made async for cross-runtime compatibility.
   */
  createCommand<T>(
    type: string,
    payload: T,
    actorId: string,
    metadata?: CommandMetadata,
  ): Promise<PlatformCommand<T>>;

  /**
   * Set a command interceptor (capability check, high-risk approval, etc.).
   * Corresponds to CommandBus.setInterceptor() — made async for cross-runtime compatibility.
   */
  setInterceptor(
    interceptor: (command: PlatformCommand) => Promise<void>,
  ): Promise<void>;
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
  subscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;

  /**
   * Unsubscribe from events of a given type.
   * Corresponds to EventBus.unsubscribe() — made async for cross-runtime compatibility.
   */
  unsubscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
}

// ── 3. IActionRegistryService ─────────────────────────────────────────────

export interface IActionRegistryService {
  /**
   * Register an action descriptor (tool) discoverable by the AI Agent.
   * Corresponds to ActionRegistry.register() — made async for cross-runtime compatibility.
   */
  register(descriptor: ActionDescriptor): Promise<void>;

  /**
   * Unregister an action by its id.
   * Corresponds to ActionRegistry.unregister() — made async for cross-runtime compatibility.
   */
  unregister(id: string): Promise<void>;

  /**
   * Get all registered action descriptors.
   * Corresponds to ActionRegistry.getAllActions() — made async for cross-runtime compatibility.
   */
  getAllActions(): Promise<ActionDescriptor[]>;

  /**
   * Get tools formatted for @google/genai functionDeclarations.
   * Corresponds to ActionRegistry.getAgentTools() — made async for cross-runtime compatibility.
   * Return type tightened from `any[]` to `unknown[]` per D-11.
   */
  getAgentTools(): Promise<unknown[]>;

  /**
   * Find an action descriptor by its tool name (sanitized command type).
   * Corresponds to ActionRegistry.getActionByToolName() — made async for cross-runtime compatibility.
   */
  getActionByToolName(
    toolName: string,
  ): Promise<ActionDescriptor | undefined>;

  /**
   * Find an action descriptor by its exact command type string.
   * Corresponds to ActionRegistry.getActionByCommandType() — made async for cross-runtime compatibility.
   */
  getActionByCommandType(
    commandType: string,
  ): Promise<ActionDescriptor | undefined>;
}

// ── 4. ICapabilityService ─────────────────────────────────────────────────

export interface ICapabilityService {
  /**
   * Grant a capability to an actor.
   * Corresponds to CapabilityGuard.grant() — made async for cross-runtime compatibility.
   */
  grant(actorId: string, cap: string): Promise<void>;

  /**
   * Revoke all capabilities from an actor.
   * Corresponds to CapabilityGuard.revokeAll() — made async for cross-runtime compatibility.
   */
  revokeAll(actorId: string): Promise<void>;

  /**
   * Check whether an actor has a required capability (supports wildcard matching).
   * Corresponds to CapabilityGuard.check() — made async for cross-runtime compatibility.
   */
  check(actorId: string, requiredCap: string): Promise<boolean>;
}

// ── 5. IProcessService ────────────────────────────────────────────────────

export interface IProcessService {
  /**
   * Spawn a new background process.
   * Corresponds to ProcessManager.spawn() — made async for cross-runtime compatibility.
   * Payload tightened from `any` to `unknown` per D-11.
   */
  spawn(name: string, taskType: string, payload: unknown): Promise<string>;

  /**
   * Kill a running process by its id.
   * Corresponds to ProcessManager.kill() — made async for cross-runtime compatibility.
   */
  kill(processId: string): Promise<void>;

  /**
   * Register a handler for a task type.
   * Corresponds to ProcessManager.registerHandler() — made async for cross-runtime compatibility.
   */
  registerHandler(
    taskType: string,
    handler: ProcessHandler,
  ): Promise<void>;

  /**
   * Unregister a handler for a task type.
   * Corresponds to ProcessManager.unregisterHandler() — made async for cross-runtime compatibility.
   */
  unregisterHandler(taskType: string): Promise<void>;

  /**
   * Register a recurring interval process.
   * Corresponds to ProcessManager.registerInterval() — made async for cross-runtime compatibility.
   */
  registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
  ): Promise<string>;

  /**
   * Restore running processes from DB after server restart.
   * Corresponds to ProcessManager.restore() — made async for cross-runtime compatibility.
   */
  restore(): Promise<void>;
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

/**
 * Token for Database.
 * Identifier: @openlearn/core:IDatabase
 */
export const IDatabaseToken = new Token<import('better-sqlite3').Database>(
  '@openlearn/core:IDatabase',
);

import type { PluginHost } from '../plugin-host/index.js';

/**
 * Token for PluginHost.
 * Identifier: @openlearn/core:IPluginHost
 */
export const IPluginHostToken = new Token<PluginHost>(
  '@openlearn/core:IPluginHost',
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


