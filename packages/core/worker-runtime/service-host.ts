/**
 * Main-thread RPC handler for Worker-isolated plugin services.
 *
 * ServiceHost receives `'invoke'` messages from a Worker-side service proxy,
 * resolves the requested service via ServiceRegistry, enforces capability
 * checks (per plugin manifest), executes the method, and returns the result
 * or serialized error back through the IWorkerTransport.
 *
 * ## Architecture
 *
 * ```
 * Worker (via transport.postMessage) -> ServiceHost.handleMessage
 *                                              |
 *                            +-----------------+------------------+
 *                            |                                    |
 *                     msg.type === 'invoke'             subscribe/no-op
 *                            |
 *                   handleInvoke
 *                            |
 *                 1. Capability check (manifestCapabilities)
 *                 2. Resolve service by token name
 *                 3. Get method from service instance
 *                 4. Execute method with args
 *                 5. Return result or serialized error
 * ```
 *
 * ## Error Serialization
 *
 * All errors are serialized as `ErrorMessage` with `code`, `message`, and
 * `stack` (capped at 4096 characters). The Worker-side proxy reconstructs
 * Error instances from the serialized data (structured clone loses
 * prototype chain across the Worker boundary).
 *
 * ## Capability Enforcement (Phase 5 Pragmatic Rule)
 *
 * If the Worker plugin has an empty `manifestCapabilities` array, it can
 * ONLY call `'get'` methods (read-only). Mutation methods (`'set'`,
 * `'register'`, `'delete'`, `'spawn'`, etc.) are denied with a
 * WorkerCapabilityError. Full per-method capability mapping is deferred
 * to a separate concern (Plan 6+).
 *
 * @module
 */

import type { IWorkerTransport, InvokeMessage, SubscribeMessage, UnsubscribeMessage } from './types.js';
import type { ServiceRegistry } from '../di/service-registry.js';
import type { CapabilityGuard } from '../capability-system/index.js';
import type { EventBus } from '../event-bus/index.js';
import { EventForwarder } from './event-forwarder.js';
import { WorkerCapabilityError } from './errors.js';

/** Maximum length of serialized stack trace in characters. */
const STACK_CAP = 4096;

// ── ServiceHost ────────────────────────────────────────────────────────────

/**
 * ServiceHost — main-thread RPC handler for Worker-isolated plugins.
 *
 * Processes incoming messages from a Worker-side service proxy, dispatches
 * invokes to the correct service from the DI container, enforces capability
 * checks, and returns results or serialized errors.
 *
 * Each ServiceHost instance is bound to a specific plugin (via pluginActorId
 * and manifestCapabilities). Multiple Workers each have their own ServiceHost.
 */
export class ServiceHost {
  /**
   * @param serviceRegistry - DI container for resolving service instances
   * @param capabilityGuard - CapabilityGuard instance (sync access, NOT async ICapabilityService wrapper)
   * @param pluginActorId - Actor identity for all invokes (e.g. `'plugin:ext-quiz-generator'`)
   * @param manifestCapabilities - Capability strings from manifest.capabilitiesProposed
   * @param eventBus - Optional EventBus for event forwarding (Plan 4). When provided,
   *                   subscribe/unsubscribe messages from Worker create EventForwarder
   *                   subscriptions on the real EventBus. When absent, subscribe/unsubscribe
   *                   emit a warning.
   */
  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly capabilityGuard: CapabilityGuard,
    private readonly pluginActorId: string,
    private manifestCapabilities: string[],
    private readonly eventBus?: EventBus,
    private eventForwarder?: EventForwarder,
  ) {}

  // ── Public accessors ───────────────────────────────────────────────────

  /** The plugin actor ID bound to this ServiceHost. */
  get actorId(): string {
    return this.pluginActorId;
  }

  /**
   * Update the manifest capabilities after construction.
   * Used for dynamic capability grants (e.g., after admin approval).
   */
  setManifestCapabilities(caps: string[]): void {
    this.manifestCapabilities = caps;
  }

  // ── Message dispatch ───────────────────────────────────────────────────

  /**
   * Handle an incoming message from the Worker-side transport.
   *
   * Dispatches based on `msg.type`:
   * - `'invoke'` -> routes to {@link handleInvoke}
   * - `'subscribe'` / `'unsubscribe'` -> console.warn (Plan 4 will implement)
   * - `'activated'` / `'deactivated'` -> silently acknowledged
   * - unknown type -> silently ignored (defensive)
   *
   * All errors are caught: this method never throws.
   *
   * @param msg - The raw message from the Worker
   * @param transport - The transport to send responses back through
   */
  async handleMessage(
    msg: unknown,
    transport: IWorkerTransport,
  ): Promise<void> {
    try {
      const typed = msg as { type?: string };
      switch (typed.type) {
        case 'invoke':
          await this.handleInvoke(msg as InvokeMessage, transport);
          break;

        case 'subscribe':
          this.handleSubscribe(msg as SubscribeMessage, transport);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(msg as UnsubscribeMessage);
          break;

        case 'activated':
        case 'deactivated':
          // Silent acknowledgement — no-op
          break;

        default:
          // Defensive: unknown message types are silently ignored
          break;
      }
    } catch (err: unknown) {
      // Never let handler exception crash the message loop
      console.error(
        `[ServiceHost] Unhandled error in handleMessage for ${this.pluginActorId}:`,
        err,
      );
    }
  }

  // ── Event forwarding (Plan 4) ──────────────────────────────────────────

  /**
   * Handle a 'subscribe' message from the Worker.
   *
   * Delegates to EventForwarder.handleSubscribe() to create an EventBus
   * subscription with a forwarding handler. The EventForwarder is created
   * lazily on the first subscribe message if an EventBus was provided.
   *
   * If no EventBus is available (null EventBus), this is a no-op.
   *
   * @param msg - The parsed subscribe message with subId and eventType
   * @param transport - The Worker transport to forward events through
   */
  private handleSubscribe(msg: SubscribeMessage, transport: IWorkerTransport): void {
    if (!this.eventBus) {
      console.warn(
        `[ServiceHost] No EventBus available -- cannot subscribe for actor ${this.pluginActorId}`,
      );
      return;
    }

    // Lazily create EventForwarder on first subscribe
    if (!this.eventForwarder) {
      this.eventForwarder = new EventForwarder(this.eventBus, transport);
    }

    this.eventForwarder.handleSubscribe(msg);
  }

  /**
   * Handle an 'unsubscribe' message from the Worker.
   *
   * Delegates to EventForwarder.handleUnsubscribe() to remove the
   * forwarding handler from EventBus.
   *
   * If no EventForwarder was created yet (no prior subscribe), this is a no-op.
   *
   * @param msg - The parsed unsubscribe message with subId
   */
  private handleUnsubscribe(msg: UnsubscribeMessage): void {
    if (!this.eventForwarder) return;
    this.eventForwarder.handleUnsubscribe(msg);
  }

  /**
   * Dispose the EventForwarder for this Worker.
   *
   * Calls EventForwarder.disposeAll() to unsubscribe all EventBus listeners
   * for this Worker, then clears the reference for GC.
   *
   * Must be called BEFORE Worker termination to prevent orphan EventBus
   * subscriptions. Called by WorkerManager.terminateWorker().
   */
  disposeEventForwarder(): void {
    this.eventForwarder?.disposeAll();
    this.eventForwarder = undefined;
  }

  // ── Invoke handling (core RPC logic) ───────────────────────────────────

  /**
   * Process an `'invoke'` message: resolve service, check capabilities,
   * execute method, return result or serialized error.
   *
   * This is the core RPC handler. All errors during execution are caught
   * and serialized as `ErrorMessage` — this method never throws.
   *
   * @param msg - The parsed invoke message with token, method, args
   * @param transport - The transport to send the result/error back through
   */
  async handleInvoke(
    msg: InvokeMessage,
    transport: IWorkerTransport,
  ): Promise<void> {
    try {
      // ── Phase 5 pragmatic capability guard ─────────────────────────
      // If manifestCapabilities is empty, the Worker plugin has no
      // declared capabilities. Block all mutation methods and only allow
      // read-only 'get' methods.
      // Full per-method capability mapping is deferred (Plan 6+).
      if (
        this.manifestCapabilities.length === 0 &&
        msg.method !== 'get'
      ) {
        throw new WorkerCapabilityError(
          this.pluginActorId,
          '__rpc__',
          `Capability denied for actor ${this.pluginActorId}: ` +
            `empty manifestCapabilities, only 'get' methods allowed`,
        );
      }

      // ── Resolve service by token name ──────────────────────────────
      const service = await this.resolveService(msg.token);

      // ── Get the method from the service instance ───────────────────
      const method = (service as Record<string, unknown>)[msg.method];
      if (typeof method !== 'function') {
        throw new Error(
          `Method "${msg.method}" not found on service "${msg.token}"`,
        );
      }

      // ── Execute the method ─────────────────────────────────────────
      // NOTE: The result value must be structured-clone-safe (no
      // functions, Symbols, WeakRefs, or DOM nodes). JavaScript's
      // structured clone algorithm throws DataCloneError if the result
      // contains unserializable values. This is a documented constraint
      // of the Worker RPC boundary.
      const result = await method.apply(service, msg.args);

      // ── Return result to Worker ───────────────────────────────────
      transport.postMessage({
        type: 'result',
        invokeId: msg.invokeId,
        value: result,
      });
    } catch (err: unknown) {
      // ── Serialize error with stack capped at STACK_CAP ─────────────
      const error = err instanceof Error ? err : new Error(String(err));
      const stack =
        error.stack && error.stack.length > STACK_CAP
          ? error.stack.slice(0, STACK_CAP)
          : error.stack;

      transport.postMessage({
        type: 'error',
        invokeId: msg.invokeId,
        message: error.message,
        code: error.name,
        stack,
      });
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Resolve a service instance by its token name string.
   *
   * Uses `resolveByName()` on the ServiceRegistry when available
   * (added in Plan 03). Falls back to constructing a temporary Token
   * and calling the standard `resolve()` method for backward compatibility.
   *
   * @param tokenName - The token name string (e.g. `'@openlearn/core:ICommandBusService'`)
   * @returns The resolved service instance
   */
  private async resolveService(tokenName: string): Promise<unknown> {
    // Prefer resolveByName if available (Plan 03+)
    if (
      typeof (this.serviceRegistry as unknown as Record<string, unknown>)
        .resolveByName === 'function'
    ) {
      return (
        this.serviceRegistry as unknown as {
          resolveByName: (name: string) => Promise<unknown>;
        }
      ).resolveByName(tokenName);
    }

    // Fallback: dynamically import Token and construct one to call resolve()
    const { Token } = await import('../di/token.js');
    const token = new Token(tokenName);
    return this.serviceRegistry.resolve(token);
  }
}
