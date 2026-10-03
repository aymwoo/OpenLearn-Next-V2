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
 * Two barriers are enforced at the top of {@link handleInvoke}:
 *
 * 1. **Token Allowlist Guard** (Security Barrier 1) — when the constructor was
 *    given `allowedTokens`, any service token not in that set is rejected before
 *    resolution. This is the token-level sandbox mirroring the backend fix in
 *    `packages/core/worker-runtime/service-host.ts`; the allowlist is computed
 *    per manifest by `computeAllowedWorkerTokens` in `./allowed-tokens`.
 * 2. **Manifest capability check** (Security Barrier 2) — if manifestCapabilities
 *    is empty, the plugin can ONLY call `'get'` methods (read-only).
 *    Mutation methods are denied with error.
 *
 * `allowedTokens` is optional for backward compatibility: when omitted the host
 * keeps its previous (permissive) behavior, but every production entry point
 * (`BrowserWorkerManager.createWorker`) passes a computed allowlist.
 *
 * ## Event Forwarding
 *
 * handleSubscribe creates Socket.IO listeners (via ISocketService)
 * and forwards events to the Worker via transport.postMessage.
 * Subscriptions are tracked for cleanup on dispose().
 *
 * @module
 */

import { checkMethodPolicy } from './method-policy';
import type {
  IWorkerTransport,
  InvokeMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from '../../packages/core/worker-runtime/types';
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
   * 授权的 Service Token 白名单（Security Barrier 1）。
   * undefined = 未传入白名单，保持向后兼容的宽松行为。
   */
  private readonly allowedServiceTokens?: ReadonlySet<string>;

  /**
   * @param serviceRegistry - FrontendServiceRegistry for resolving service instances
   * @param pluginActorId - Actor identity for all invokes
   * @param manifestCapabilities - Capability strings from manifest.capabilitiesProposed
   * @param socketService - Optional ISocketService for event forwarding
   * @param allowedTokens - Optional service token allowlist; when provided, any
   *   token outside the set is denied. Mirrors the backend `allowedTokens`
   *   constructor argument (`packages/core/worker-runtime/service-host.ts`).
   */
  constructor(
    private readonly serviceRegistry: FrontendServiceRegistry,
    private readonly pluginActorId: string,
    private readonly manifestCapabilities: string[],
    private readonly socketService?: ISocketService,
    allowedTokens?: Iterable<string>,
  ) {
    if (allowedTokens) {
      this.allowedServiceTokens = new Set(allowedTokens);
    }
  }

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
  async handleMessage(msg: unknown, transport: IWorkerTransport): Promise<void> {
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
      console.error(`[ServiceHost] Unhandled error in handleMessage for ${this.pluginActorId}:`, err);
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
      console.warn(`[ServiceHost] No ISocketService available -- cannot subscribe for actor ${this.pluginActorId}`);
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
        console.error(`[ServiceHost] Failed to forward event "${msg.eventType}" to Worker:`, err);
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
  async handleInvoke(msg: InvokeMessage, transport: IWorkerTransport): Promise<void> {
    try {
      // ── Security Barrier 1: Token 白名单门禁 ────────────────────────
      // 严格 Token 级能力沙箱：拦截任何未显式授权给本 Worker 插件的服务 Token。
      // 与后端 packages/core/worker-runtime/service-host.ts 的 Barrier 1 同构。
      if (this.allowedServiceTokens && !this.allowedServiceTokens.has(msg.token)) {
        const err = new Error(
          `Access to service token '${msg.token}' denied: not in worker allowedTokens for ${this.pluginActorId}`,
        );
        err.name = 'WorkerCapabilityError';
        throw err;
      }

      // ── Security Barrier 2: 空 manifest 能力检查 ─────────────────────
      // manifestCapabilities 为空时，插件未声明任何能力，只允许 'get' 只读方法。
      if (this.manifestCapabilities.length === 0 && !msg.method.startsWith('get')) {
        throw new Error(
          `Capability denied for actor ${this.pluginActorId}: ` +
            `empty manifestCapabilities, only 'get' methods allowed`,
        );
      }

      // ── Security Barrier 3: 方法 / 路径级门禁（纵深防御）──────────────
      // 前两道门禁的粒度分别是 Token 与"是否声明过任意能力"。数据链打通后
      // Barrier 2 变为"按 manifest 声明判定"，而**声明是插件自己写的**，
      // 且基础白名单含 IFrontendAPI（对任意 path 的同源 fetch）——
      // 只要声明任意一条能力，就能对全部用户会话 API 发 post/del。
      // 此处按方法与路径再收一道。
      //
      // 注意：这是**纵深防御，不是访问控制**。真正的权限边界在服务端
      // （每个 REST 端点自己校验 session 与角色）。此处只降低"插件被诱导
      // 或被植入恶意逻辑"时的爆炸半径。
      const methodDenied = checkMethodPolicy(msg.token, msg.method, msg.args, this.manifestCapabilities);
      if (methodDenied) {
        const err = new Error(
          `Call denied for actor ${this.pluginActorId}: ` +
            `${msg.token}.${msg.method}() — ${methodDenied}`,
        );
        err.name = 'WorkerCapabilityError';
        throw err;
      }

      // ── Resolve service by token name ──────────────────────────────
      const service = await this.resolveService(msg.token);

      // ── Get the method from the service instance ───────────────────
      const method = (service as Record<string, unknown>)[msg.method];
      if (typeof method !== 'function') {
        throw new Error(`Method "${msg.method}" not found on service "${msg.token}"`);
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
      const stack = error.stack && error.stack.length > STACK_CAP ? error.stack.slice(0, STACK_CAP) : error.stack;

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
        console.error(`[ServiceHost] Error cleaning up subscription:`, err);
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
