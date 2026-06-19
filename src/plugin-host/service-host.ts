/**
 * Frontend ServiceHost — browser-side main-thread RPC handler for Worker plugins.
 *
 * D-08: Mirrors backend ServiceHost RPC pattern for browser context.
 * Receives `'invoke'` messages from Worker-side service proxies,
 * resolves frontend services via FrontendServiceRegistry, executes
 * methods, and returns result or serialized error.
 *
 * ## Architecture
 *
 * ```
 * Worker (via transport.postMessage) -> ServiceHost.handleMessage
 *                                              |
 *                            +-----------------+------------------+
 *                            |                                    |
 *                     msg.type === 'invoke'            subscribe/unsubscribe
 *                            |
 *                   handleInvoke
 *                            |
 *                 1. Capability check (manifestCapabilities)
 *                 2. Resolve service by token string
 *                 3. Get method from service instance
 *                 4. Execute method with args
 *                 5. Return result or serialized error
 * ```
 *
 * ## Capability Enforcement
 *
 * If manifestCapabilities is empty, the plugin can ONLY call `'get'`
 * methods (read-only). Mutation methods are denied with error.
 *
 * ## Event Forwarding
 *
 * handleSubscribe creates Socket.IO listeners (via ISocketService)
 * and forwards events to the Worker via transport.postMessage.
 * Subscriptions are tracked for cleanup on dispose().
 *
 * @module
 */

import type { IWorkerTransport, InvokeMessage, SubscribeMessage, UnsubscribeMessage } from '../../../packages/core/worker-runtime/types';
import type { FrontendServiceRegistry } from './service-registry';
import type { ISocketService } from './types';

/** Maximum length of serialized stack trace in characters. */
const STACK_CAP = 4096;

// ── ServiceHost ────────────────────────────────────────────────────────────

/**
 * ServiceHost — browser main-thread RPC handler for Worker-isolated plugins.
 *
 * Each ServiceHost instance is bound to a specific plugin (via pluginActorId
 * and manifestCapabilities). Multiple Workers each have their own ServiceHost.
 */
export class ServiceHost {
  /** Map of subId -> cleanup function for event subscriptions */
  private subscriptions = new Map<string, () => void>();

  /**
   * @param serviceRegistry - FrontendServiceRegistry for resolving service instances
   * @param pluginActorId - Actor identity for all invokes
   * @param manifestCapabilities - Capability strings from manifest.capabilitiesProposed
   * @param socketService - Optional ISocketService for event forwarding
   */
  constructor(
    private readonly serviceRegistry: FrontendServiceRegistry,
    private readonly pluginActorId: string,
    private readonly manifestCapabilities: string[],
    private readonly socketService?: ISocketService,
  ) {}

  // ── Public accessors ───────────────────────────────────────────────────

  /** The plugin actor ID bound to this ServiceHost. */
  get actorId(): string {
    return this.pluginActorId;
  }

  // ── Message dispatch ───────────────────────────────────────────────────

  /**
   * Handle an incoming message from the Worker-side transport.
   *
   * Dispatches based on `msg.type`:
   * - `'invoke'` -> routes to {@link handleInvoke}
   * - `'subscribe'` -> routes to {@link handleSubscribe}
   * - `'unsubscribe'` -> routes to {@link handleUnsubscribe}
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

  // ── Event forwarding ──────────────────────────────────────────────────

  /**
   * Handle a 'subscribe' message from the Worker.
   *
   * Subscribes to socket event via ISocketService.on() with a forwarding
   * handler that posts events to the Worker via transport.postMessage().
   * Tracks subscription for cleanup via dispose().
   *
   * If no socketService is available, logs a warning.
   *
   * @param msg - The parsed subscribe message with subId and eventType
   * @param transport - The Worker transport to forward events through
   */
  private handleSubscribe(msg: SubscribeMessage, transport: IWorkerTransport): void {
    if (!this.socketService) {
      console.warn(
        `[ServiceHost] No ISocketService available -- cannot subscribe for actor ${this.pluginActorId}`,
      );
      return;
    }

    const handler = (...args: any[]) => {
      try {
        transport.postMessage({
          type: 'event',
          subId: msg.subId,
          event: {
            id: '',
            type: msg.eventType,
            source: 'socket',
            payload: args.length === 1 ? args[0] : args,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        console.error(
          `[ServiceHost] Failed to forward event "${msg.eventType}" to Worker:`,
          err,
        );
      }
    };

    this.socketService.on(msg.eventType, handler);

    // Store cleanup function
    this.subscriptions.set(msg.subId, () => {
      this.socketService!.off(msg.eventType, handler);
    });
  }

  /**
   * Handle an 'unsubscribe' message from the Worker.
   *
   * Removes the socket listener by calling the stored cleanup function.
   *
   * @param msg - The parsed unsubscribe message with subId
   */
  private handleUnsubscribe(msg: UnsubscribeMessage): void {
    const cleanup = this.subscriptions.get(msg.subId);
    if (cleanup) {
      cleanup();
      this.subscriptions.delete(msg.subId);
    }
  }

  // ── Invoke handling (core RPC logic) ───────────────────────────────────

  /**
   * Process an `'invoke'` message: resolve service, check capabilities,
   * execute method, return result or serialized error.
   *
   * All errors during execution are caught and serialized as `ErrorMessage`.
   *
   * @param msg - The parsed invoke message with token, method, args
   * @param transport - The transport to send the result/error back through
   */
  async handleInvoke(
    msg: InvokeMessage,
    transport: IWorkerTransport,
  ): Promise<void> {
    try {
      // ── Capability guard (simplified frontend version) ──────────────
      // If manifestCapabilities is empty, the Worker plugin has no
      // declared capabilities. Allow only 'get' prefix methods.
      if (this.manifestCapabilities.length === 0 && !msg.method.startsWith('get')) {
        throw new Error(
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
      const result = await method.apply(service, msg.args);

      // ── Return result to Worker ────────────────────────────────────
      transport.postMessage({
        type: 'result',
        invokeId: msg.invokeId,
        value: result,
      });
    } catch (err: unknown) {
      // ── Serialize error with stack capped at STACK_CAP ──────────────
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

  // ── Dispose ──────────────────────────────────────────────────────────

  /**
   * Dispose all resources held by this ServiceHost.
   *
   * Calls all subscription cleanup functions and clears the map.
   * Must be called BEFORE Worker termination to prevent orphan
   * Socket.IO listeners.
   *
   * Idempotent — calling dispose() multiple times has no effect.
   */
  dispose(): void {
    for (const [, cleanup] of this.subscriptions) {
      try {
        cleanup();
      } catch (err) {
        console.error(
          `[ServiceHost] Error cleaning up subscription:`,
          err,
        );
      }
    }
    this.subscriptions.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Resolve a service instance by its token name string.
   *
   * @param tokenName - The token name string (e.g. '@openlearn/frontend:IFrontendAPI')
   * @returns The resolved service instance
   */
  private async resolveService(tokenName: string): Promise<unknown> {
    return this.serviceRegistry.resolve(tokenName);
  }
}
