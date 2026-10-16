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

import type {
  IWorkerTransport,
  InvokeMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  HttpResponseMessage,
  HttpStreamChunkMessage,
  HttpStreamEndMessage,
  HttpStreamErrorMessage,
  RoutesRegisteredMessage,
} from './types.js';
import type { ServiceRegistry } from '../di/service-registry.js';
import type { CapabilityGuard } from '../capability/index.js';
import type { EventBus } from '../event-bus/index.js';
import { EventForwarder } from './event-forwarder.js';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { WorkerCapabilityError } from './errors.js';
import { resolvePluginCommandType, stripPluginCommandPrefix } from '../plugin-host/plugin-namespace.js';
import type { PluginApiRequest, PluginApiResponse, PluginStreamResponse } from '../plugin-host/types.js';
import { checkMethodPolicy, type MethodPolicyTokens } from '../plugin-host/method-policy.js';
import { bindPluginCommand } from '../command-bus/plugin-command.js';
import { isBlockedPluginCapability, isPrivateOrReservedHost } from '../plugin-host/plugin-grants.js';
import {
  isSafePluginTablePrefix,
  pluginTablePrefix,
  listAllowedPluginTablePrefixes,
} from '../plugin-host/plugin-tables.js';
import { assertPluginSqlAllowed } from '../plugin-host/sql-guard.js';

/**
 * 后端 Worker 侧的 Token 名集合。
 *
 * 与浏览器侧 `@openlearn/frontend:*` 命名空间不同 —— 共享的只是**规则结构**，
 * Token 名各自声明（审计项 B-4）。名字必须与 `worker-manager.ts` 的
 * `BASE_WORKER_SERVICE_TOKENS` 保持一致，否则该 Token 会落到策略的
 * `default` 分支（不裁决）而形同没有 Barrier 3。
 */
const CORE_WORKER_TOKENS: MethodPolicyTokens = Object.freeze({
  storageService: '@openlearn/core:IStorageService',
  aiService: '@openlearn/core:IAIService',
  processService: '@openlearn/core:IProcessService',
  actionRegistry: '@openlearn/core:IActionRegistryService',
});

/** Maximum length of serialized stack trace in characters. */
const STACK_CAP = 4096;

/**
 * 递归清洗不可结构化克隆的值（如函数属性、循环引用、未知复杂对象原型）。
 * 用于 postMessage 序列化降级，防止 DataCloneError。
 */
export function sanitizeClonableValue(val: unknown, depth = 0, seen = new WeakSet()): unknown {
  if (depth > 12) return null;
  if (val === null || val === undefined) return val;
  const t = typeof val;
  if (t === 'function') return undefined;
  if (t === 'symbol' || t === 'bigint') return val.toString();
  if (t !== 'object') return val;

  if (ArrayBuffer.isView(val) || val instanceof ArrayBuffer) return val;
  if (val instanceof Date) return new Date(val.getTime());
  if (val instanceof RegExp) return new RegExp(val.source, val.flags);

  if (seen.has(val as object)) return '[Circular]';
  seen.add(val as object);

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeClonableValue(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (typeof v === 'function') continue;
    const clean = sanitizeClonableValue(v, depth + 1, seen);
    if (clean !== undefined) {
      out[k] = clean;
    }
  }
  return out;
}

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
   * @param pluginActorId - Actor identity for all invokes (e.g. `'plugin:ext-my-service'`)
   * @param manifestCapabilities - Capability strings from manifest.capabilitiesProposed
   * @param eventBus - Optional EventBus for event forwarding (Plan 4). When provided,
   *                   subscribe/unsubscribe messages from Worker create EventForwarder
   *                   subscriptions on the real EventBus. When absent, subscribe/unsubscribe
   *                   emit a warning.
   */
  private readonly pendingCommandExecutes = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly pendingHttpRequests = new Map<
    string,
    {
      resolve: (res: PluginApiResponse) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly registeredCommandTypes = new Set<string>();
  private readonly registeredActionIds = new Set<string>();
  /**
   * actionId → commandType：本插件经 RPC 登记的 ActionDescriptor 清单（Issue #71）。
   * 仅用于在 registerHandler 时做「是否声明了描述符」的本地预检（无需额外 RPC）。
   */
  private readonly registeredActionCommandTypes = new Map<string, string>();
  private readonly activeStreams = new Map<
    string,
    {
      stream: PluginStreamResponse;
      transport: IWorkerTransport;
      firstChunkTimer?: ReturnType<typeof setTimeout>;
      idleTimer?: ReturnType<typeof setTimeout>;
      lifetimeTimer: ReturnType<typeof setTimeout>;
      cleanup: () => void;
    }
  >();
  private registeredRoutes: Array<{ method: string; pattern: string; isStream?: boolean }> = [];

  private readonly allowedServiceTokens?: ReadonlySet<string>;

  private readonly networkAllowlist?: readonly string[];

  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly capabilityGuard: CapabilityGuard,
    private readonly pluginActorId: string,
    private manifestCapabilities: string[],
    private readonly eventBus?: EventBus,
    private eventForwarder?: EventForwarder,
    private readonly pluginId?: string,
    private readonly dbPluginId?: string,
    allowedTokens?: Iterable<string>,
    networkAllowlist?: Iterable<string>,
  ) {
    if (allowedTokens) {
      this.allowedServiceTokens = new Set(allowedTokens);
    }
    if (networkAllowlist) {
      this.networkAllowlist = Array.from(networkAllowlist);
    }
  }

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

        case 'commandResult': {
          const rMsg = msg as { invokeId: string; value: unknown };
          const pending = this.pendingCommandExecutes.get(rMsg.invokeId);
          if (pending) {
            this.pendingCommandExecutes.delete(rMsg.invokeId);
            pending.resolve(rMsg.value);
          }
          break;
        }

        case 'commandError': {
          const eMsg = msg as { invokeId: string; message: string; stack?: string };
          const pending = this.pendingCommandExecutes.get(eMsg.invokeId);
          if (pending) {
            this.pendingCommandExecutes.delete(eMsg.invokeId);
            const err = new Error(eMsg.message);
            err.stack = eMsg.stack;
            pending.reject(err);
          }
          break;
        }

        case 'httpResponse': {
          const rMsg = msg as HttpResponseMessage;
          const pending = this.pendingHttpRequests.get(rMsg.invokeId);
          if (pending) {
            this.pendingHttpRequests.delete(rMsg.invokeId);
            clearTimeout(pending.timer);
            if (rMsg.error) {
              const err = new Error(rMsg.error.message);
              err.stack = rMsg.error.stack;
              pending.reject(err);
            } else {
              pending.resolve(rMsg.response ?? { status: 200, body: null });
            }
          }
          break;
        }

        case 'httpStreamChunk': {
          const cMsg = msg as HttpStreamChunkMessage;
          const active = this.activeStreams.get(cMsg.streamId);
          if (active) {
            if (active.firstChunkTimer) {
              clearTimeout(active.firstChunkTimer);
              active.firstChunkTimer = undefined;
            }
            if (active.idleTimer) {
              clearTimeout(active.idleTimer);
              active.idleTimer = setTimeout(() => {
                this.abortStream(cMsg.streamId, 'Stream idle timeout (60s)');
                active.stream.error(new Error('Stream idle timeout (60s)'));
                active.stream.end();
              }, 60000);
            }
            // Check chunk size limit (T-STR-03: 64KB)
            const rawData = cMsg.data;
            const payloadLength =
              typeof rawData === 'string' ? Buffer.byteLength(rawData) : Buffer.byteLength(JSON.stringify(rawData));
            if (payloadLength > 65536) {
              this.abortStream(cMsg.streamId, 'Chunk size exceeded 64KB limit');
              active.stream.error(new Error('Chunk size exceeded 64KB limit'));
              active.stream.end();
              break;
            }
            active.stream.write(cMsg.data, cMsg.event, cMsg.id);
          }
          break;
        }

        case 'httpStreamEnd': {
          const eMsg = msg as HttpStreamEndMessage;
          const active = this.activeStreams.get(eMsg.streamId);
          if (active) {
            active.cleanup();
            this.activeStreams.delete(eMsg.streamId);
            active.stream.end();
          }
          break;
        }

        case 'httpStreamError': {
          const errMsg = msg as HttpStreamErrorMessage;
          const active = this.activeStreams.get(errMsg.streamId);
          if (active) {
            active.cleanup();
            this.activeStreams.delete(errMsg.streamId);
            active.stream.error(new Error(errMsg.error.message));
            active.stream.end();
          }
          break;
        }

        case 'routesRegistered': {
          const rMsg = msg as RoutesRegisteredMessage;
          this.registeredRoutes = rMsg.routes || [];
          break;
        }

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
      console.warn(`[ServiceHost] No EventBus available -- cannot subscribe for actor ${this.pluginActorId}`);
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

  /**
   * Dispose all resources held by this ServiceHost (EventForwarder and registered command handlers).
   * Called by WorkerManager when the worker is terminated.
   */
  async dispose(): Promise<void> {
    this.disposeEventForwarder();

    // Clean up registered command handlers
    if (this.registeredCommandTypes.size > 0) {
      try {
        const commandBus = (await this.resolveService('@openlearn/core:ICommandBusService')) as any;
        if (commandBus) {
          for (const commandType of this.registeredCommandTypes) {
            try {
              commandBus.unregisterHandler(commandType);
            } catch (err) {
              console.error(`[ServiceHost] Failed to unregister command handler "${commandType}" on dispose:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[ServiceHost] Failed to resolve commandBus on dispose:`, err);
      }
      this.registeredCommandTypes.clear();
    }

    // Clean up registered actions
    if (this.registeredActionIds.size > 0) {
      try {
        const actionRegistry = (await this.resolveService('@openlearn/core:IActionRegistryService')) as any;
        if (actionRegistry) {
          for (const actionId of this.registeredActionIds) {
            try {
              await actionRegistry.unregister(actionId);
            } catch (err) {
              console.error(`[ServiceHost] Failed to unregister action "${actionId}" on dispose:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[ServiceHost] Failed to resolve actionRegistry on dispose:`, err);
      }
      this.registeredActionIds.clear();
      this.registeredActionCommandTypes.clear();
    }

    // Clean up pending HTTP requests (reject with termination error)
    if (this.pendingHttpRequests.size > 0) {
      for (const [, pending] of this.pendingHttpRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Worker for plugin "${this.pluginActorId}" was terminated`));
      }
      this.pendingHttpRequests.clear();
    }

    // Clean up active HTTP streams (abort and end)
    if (this.activeStreams.size > 0) {
      for (const [streamId, active] of this.activeStreams) {
        active.cleanup();
        try {
          active.transport.postMessage({
            type: 'httpStreamAbort',
            streamId,
            reason: `Worker for plugin "${this.pluginActorId}" was terminated`,
          });
        } catch {}
        active.stream.end();
      }
      this.activeStreams.clear();
    }
  }

  /**
   * 中止指定的 Worker HTTP 流
   */
  abortStream(streamId: string, reason?: string): void {
    const active = this.activeStreams.get(streamId);
    if (!active) return;
    active.cleanup();
    this.activeStreams.delete(streamId);
    try {
      active.transport.postMessage({
        type: 'httpStreamAbort',
        streamId,
        reason,
      });
    } catch {}
  }

  /**
   * 向 Worker 隔离线程派发 HTTP 请求 DTO，并等待响应（带超时守卫）
   *
   * @param transport - Worker 通信运输层
   * @param request - 纯 DTO 请求对象
   * @param timeoutMs - 超时时间（毫秒，默认 5000ms）
   */
  async dispatchHttpRequest(
    transport: IWorkerTransport,
    request: PluginApiRequest,
    timeoutMs: number = 5000,
  ): Promise<PluginApiResponse> {
    const invokeId = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingHttpRequests.has(invokeId)) {
          this.pendingHttpRequests.delete(invokeId);
          const err = new Error(`Plugin API request timed out after ${timeoutMs}ms`);
          err.name = 'GatewayTimeoutError';
          reject(err);
        }
      }, timeoutMs);

      this.pendingHttpRequests.set(invokeId, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      try {
        transport.postMessage({
          type: 'httpRequest',
          invokeId,
          request,
        });
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingHttpRequests.delete(invokeId);
        reject(err);
      }
    });
  }

  /**
   * 向 Worker 隔离线程派发 HTTP SSE 流式请求，并桥接流式数据块（带超时看门狗与中断感知）
   *
   * @param transport - Worker 通信运输层
   * @param request - 纯 DTO 请求对象
   * @param stream - 主线程流式响应写入器
   * @param maxLifetimeMs - 最大生命周期超时（默认 300,000ms = 5分钟）
   */
  async dispatchHttpStream(
    transport: IWorkerTransport,
    request: PluginApiRequest,
    stream: PluginStreamResponse,
    maxLifetimeMs: number = 300000,
  ): Promise<void> {
    const streamId = globalThis.crypto.randomUUID();

    let firstChunkTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      const active = this.activeStreams.get(streamId);
      if (active) {
        this.abortStream(streamId, 'First chunk timeout (10s)');
        stream.error(new Error('First chunk timeout (10s)'));
        stream.end();
      }
    }, 10000);

    let idleTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      const active = this.activeStreams.get(streamId);
      if (active) {
        this.abortStream(streamId, 'Stream idle timeout (60s)');
        stream.error(new Error('Stream idle timeout (60s)'));
        stream.end();
      }
    }, 60000);

    const lifetimeTimer = setTimeout(() => {
      const active = this.activeStreams.get(streamId);
      if (active) {
        this.abortStream(streamId, `Stream max lifetime exceeded (${Math.round(maxLifetimeMs / 1000)}s)`);
        stream.error(new Error(`Stream max lifetime exceeded (${Math.round(maxLifetimeMs / 1000)}s)`));
        stream.end();
      }
    }, maxLifetimeMs);

    const cleanup = () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer);
        firstChunkTimer = undefined;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      clearTimeout(lifetimeTimer);
    };

    // 监听客户端连接关闭（反向中止 Worker 中的大模型或耗时流）
    stream.onClose(() => {
      this.abortStream(streamId, 'Client closed connection');
    });

    this.activeStreams.set(streamId, {
      stream,
      transport,
      firstChunkTimer,
      idleTimer,
      lifetimeTimer,
      cleanup,
    });

    try {
      transport.postMessage({
        type: 'httpStreamStart',
        streamId,
        request,
      });
    } catch (err: any) {
      cleanup();
      this.activeStreams.delete(streamId);
      stream.error(err);
      stream.end();
    }
  }

  /**
   * 获取由 Worker 注册的所有路由（含是否为流式路由）
   */
  getRegisteredRoutes(): Array<{ method: string; pattern: string; isStream?: boolean }> {
    return this.registeredRoutes;
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
  async handleInvoke(msg: InvokeMessage, transport: IWorkerTransport): Promise<void> {
    try {
      // ── Security Barrier 1: Token Allowlist Guard ───────────────────
      // Strict token-level capability sandbox: block any service token
      // not explicitly granted to this worker plugin. 空允许列表（undefined 或空 Set）
      // 视为 fail-closed，避免“未注入 allowlist 就放行全部 token”。
      if (!this.allowedServiceTokens || !this.allowedServiceTokens.has(msg.token)) {
        throw new WorkerCapabilityError(
          this.pluginActorId,
          msg.token,
          `Access to service token '${msg.token}' denied: not in worker allowedTokens for ${this.pluginActorId}`,
        );
      }

      // ── Security Barrier 2: Capability check on empty manifest ─────
      // If manifestCapabilities is empty, the Worker plugin has no
      // declared capabilities. Block all mutation methods and only allow
      // read-only 'get' methods.
      // B-3：此处与浏览器侧 `src/plugin-host/service-host.ts` 曾是同一道 Barrier 的**两种语义** ——
      // 后端 `msg.method !== 'get'`（仅放行方法名恰好为 `get`）vs 前端 `!msg.method.startsWith('get')`
      // （放行所有 get* 前缀方法）。后果：`getUserList` / `getAllActions` 这类
      // 非 `get` 前缀的方法在 server worker 插件里被拒、在浏览器 worker 插件里放行。
      //
      // 统一为 `startsWith('get')`：Barrier 2 的意图是「manifest 未声明任何 capability 时降级为只读」，
      // 而 getter 语义在两端都由 `get*` 命名约定承载。前端本已是该语义，故改后端。
      if (this.manifestCapabilities.length === 0 && !msg.method.startsWith('get')) {
        throw new WorkerCapabilityError(
          this.pluginActorId,
          '__rpc__',
          `Capability denied for actor ${this.pluginActorId}: ` +
            `empty manifestCapabilities, only 'get' methods allowed`,
        );
      }

      // ── Security Barrier 3: Method / Path Policy (B-5) ─────────────
      // 此前后端**只有** Barrier 1（Token 白名单）与 Barrier 2（空 manifest 只读），
      // 没有方法级收窄 —— 与浏览器侧 `method-policy.ts` 各写一套，规则漂移无从察觉。
      // 现两端共用 `packages/core/plugin-host/method-policy.ts`（审计项 B-4），
      // 策略常量与判定逻辑只有一处真理源，本层只提供后端的 Token 名集合。
      const methodDenial = checkMethodPolicy({
        token: msg.token,
        method: msg.method,
        args: msg.args,
        caps: this.manifestCapabilities,
        tokens: CORE_WORKER_TOKENS,
      });
      if (methodDenial) {
        throw new WorkerCapabilityError(
          this.pluginActorId,
          msg.token,
          `Method policy denied for actor ${this.pluginActorId}: ${methodDenial}`,
        );
      }

      // ── Intercept INetworkProxyService RPC (trust boundary: host-only proxy fetch) ──
      if (msg.token === '@openlearn/core:INetworkProxyService') {
        const [request] = msg.args as [
          { url?: string; method?: string; headers?: Record<string, string>; body?: string | null },
        ];
        const url = String(request?.url ?? '');
        const verdict = this.isOutboundUrlAllowed(url, this.networkAllowlist ?? []);
        if (!verdict.allowed) {
          throw new WorkerCapabilityError(
            this.pluginActorId,
            msg.token,
            `Outbound request denied for actor ${this.pluginActorId}: ${verdict.reason}`,
          );
        }
        const parsedHost = new URL(url).hostname.toLowerCase();
        if (!net.isIP(parsedHost) && !parsedHost.startsWith('[')) {
          try {
            const resolved = await dns.lookup(parsedHost, { all: true });
            for (const entry of resolved) {
              if (isPrivateOrReservedHost(entry.address)) {
                throw new WorkerCapabilityError(
                  this.pluginActorId,
                  msg.token,
                  `Outbound request denied for actor ${this.pluginActorId}: host ${parsedHost} resolves to forbidden address (${entry.address})`,
                );
              }
            }
          } catch (dnsErr) {
            if (dnsErr instanceof WorkerCapabilityError) throw dnsErr;
          }
        }
        const response = await fetch(url, {
          method: request?.method ?? 'GET',
          headers: request?.headers,
          body: request?.body ?? undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
        });
        const body = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        transport.postMessage({
          type: 'result',
          invokeId: msg.invokeId,
          value: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            body,
            url: response.url || url,
          },
        });
        return;
      }
      // ── Resolve service by token name ──────────────────────────────
      const service = await this.resolveService(msg.token);

      // ── Intercept IStorageService RPC helper methods ─────────────────
      if (msg.token === '@openlearn/core:IStorageService') {
        const manifestId = this.pluginActorId.startsWith('plugin:') ? this.pluginActorId.slice(7) : this.pluginActorId;

        const db = (await this.resolveService('@openlearn/core:IDatabase')) as import('better-sqlite3').Database;

        let result: unknown;
        if (msg.method === 'get') {
          const [key] = msg.args as [string];
          const row = db
            .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
            .get(manifestId, key) as { value: string } | undefined;
          result = row ? JSON.parse(row.value) : null;
        } else if (msg.method === 'set') {
          const [key, value] = msg.args as [string, unknown];
          const valueStr = JSON.stringify(value);
          db.prepare(
            `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          ).run(manifestId, key, valueStr, Date.now());
          result = undefined;
        } else if (msg.method === 'delete') {
          const [key] = msg.args as [string];
          db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(manifestId, key);
          result = undefined;
        } else {
          throw new Error(`Method "${msg.method}" not supported on IStorageService RPC`);
        }

        transport.postMessage({
          type: 'result',
          invokeId: msg.invokeId,
          value: result,
        });
        return;
      }

      // ── Intercept IDatabase RPC helper methods ──────────────────────
      if (msg.token === '@openlearn/core:IDatabase') {
        const db = service as import('better-sqlite3').Database;
        const [sql] = msg.args as [string];
        this.assertDatabaseAccessAllowed(sql);
        let result: unknown;
        if (msg.method === 'exec') {
          db.exec(sql);
          result = undefined;
        } else if (msg.method === 'prepareAndRun') {
          const [, args] = msg.args as [string, unknown[]];
          result = db.prepare(sql).run(...args);
        } else if (msg.method === 'prepareAndGet') {
          const [, args] = msg.args as [string, unknown[]];
          result = db.prepare(sql).get(...args);
        } else if (msg.method === 'prepareAndAll') {
          const [, args] = msg.args as [string, unknown[]];
          result = db.prepare(sql).all(...args);
        } else {
          throw new Error(`Method "${msg.method}" not supported on IDatabase RPC`);
        }

        transport.postMessage({
          type: 'result',
          invokeId: msg.invokeId,
          value: result,
        });
        return;
      }

      // ── Intercept IEventBusService helper methods ───────────────────
      if (msg.token === '@openlearn/core:IEventBusService') {
        const eventBus = service as any;
        if (msg.method === 'publish') {
          const [event] = msg.args as [any];
          const pluginId = this.pluginId || this.pluginActorId.replace(/^plugin:/, '');
          const enrichedEvent = {
            id: event.id || `evt_${Date.now()}_${crypto.randomUUID()}`,
            timestamp: event.timestamp || Date.now(),
            ...event,
            source: event.source ? `plugin:${pluginId}.${event.source}` : `plugin:${pluginId}`,
          };
          const result = await eventBus.publish(enrichedEvent);
          transport.postMessage({
            type: 'result',
            invokeId: msg.invokeId,
            value: result,
          });
          return;
        }
      }

      // ── Intercept ICommandBusService helper methods ─────────────────
      if (msg.token === '@openlearn/core:ICommandBusService') {
        const commandBus = service as import('../command-bus/index.js').CommandBus;
        if (msg.method === 'registerHandler') {
          let [commandType] = msg.args as [string];
          const pluginId = this.pluginId || this.pluginActorId.replace(/^plugin:/, '');
          commandType = resolvePluginCommandType(commandType, pluginId);

          commandBus.registerHandler(commandType, {
            execute: async (command) => {
              const rpcId = globalThis.crypto.randomUUID();
              return new Promise((resolve, reject) => {
                this.pendingCommandExecutes.set(rpcId, { resolve, reject });
                transport.postMessage({
                  type: 'executeCommand',
                  invokeId: rpcId,
                  commandType,
                  command,
                });
              });
            },
          });
          this.registeredCommandTypes.add(commandType);
          this.warnIfCommandHasNoDescriptor(commandType);
          transport.postMessage({
            type: 'result',
            invokeId: msg.invokeId,
            value: undefined,
          });
          return;
        } else if (msg.method === 'unregisterHandler') {
          let [commandType] = msg.args as [string];
          const pluginId = this.pluginId || this.pluginActorId.replace(/^plugin:/, '');
          commandType = resolvePluginCommandType(commandType, pluginId);

          commandBus.unregisterHandler(commandType);
          this.registeredCommandTypes.delete(commandType);
          transport.postMessage({
            type: 'result',
            invokeId: msg.invokeId,
            value: undefined,
          });
          return;
        } else if (msg.method === 'execute') {
          const [command] = msg.args as [unknown];
          const bound = bindPluginCommand(command, this.pluginActorId);
          const result = await commandBus.execute(bound as never);
          transport.postMessage({ type: 'result', invokeId: msg.invokeId, value: result });
          return;
        } else if (msg.method === 'createCommand') {
          const [type, payload, , metadata] = msg.args as [
            string,
            unknown,
            unknown,
            Record<string, unknown> | undefined,
          ];
          const cleanMeta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
          delete cleanMeta.approved;
          const result = commandBus.createCommand(type, payload, this.pluginActorId, cleanMeta);
          transport.postMessage({ type: 'result', invokeId: msg.invokeId, value: result });
          return;
        }
      }

      if (
        msg.token === '@openlearn/core:ICapabilityService' &&
        (msg.method === 'grant' || msg.method === 'revokeAll')
      ) {
        throw new WorkerCapabilityError(
          this.pluginActorId,
          msg.token,
          `Plugin "${this.pluginId || this.pluginActorId}" cannot ${msg.method} capabilities`,
        );
      }

      // ── Intercept IActionRegistryService helper methods ──────────────
      if (msg.token === '@openlearn/core:IActionRegistryService') {
        const actionRegistry = service as any;
        if (msg.method === 'register') {
          const [descriptor] = msg.args as [any];
          await actionRegistry.register(descriptor);
          this.registeredActionIds.add(descriptor.id);
          if (typeof descriptor?.commandType === 'string') {
            this.registeredActionCommandTypes.set(descriptor.id, descriptor.commandType);
          }
          transport.postMessage({
            type: 'result',
            invokeId: msg.invokeId,
            value: undefined,
          });
          return;
        } else if (msg.method === 'unregister') {
          const [actionId] = msg.args as [string];
          await actionRegistry.unregister(actionId);
          this.registeredActionIds.delete(actionId);
          this.registeredActionCommandTypes.delete(actionId);
          transport.postMessage({
            type: 'result',
            invokeId: msg.invokeId,
            value: undefined,
          });
          return;
        }
      }

      // ── Get the method from the service instance ───────────────────
      const method = (service as Record<string, unknown>)[msg.method];
      if (typeof method !== 'function') {
        throw new Error(`Method "${msg.method}" not found on service "${msg.token}"`);
      }

      // ── Execute the method ─────────────────────────────────────────
      // NOTE: The result value must be structured-clone-safe (no
      // functions, Symbols, WeakRefs, or DOM nodes). JavaScript's
      // structured clone algorithm throws DataCloneError if the result
      // contains unserializable values. This is a documented constraint
      // of the Worker RPC boundary.
      const result = await method.apply(service, msg.args);

      // ── Return result to Worker ───────────────────────────────────
      try {
        transport.postMessage({
          type: 'result',
          invokeId: msg.invokeId,
          value: result,
        });
      } catch (cloneErr: any) {
        // DataCloneError 兜底降级：清洗不可克隆的原型与函数属性
        const safeValue = sanitizeClonableValue(result);
        transport.postMessage({
          type: 'result',
          invokeId: msg.invokeId,
          value: safeValue,
        });
      }
    } catch (err: unknown) {
      // ── Serialize error with stack capped at STACK_CAP ─────────────
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
  private isOutboundUrlAllowed(url: string, allowedHosts: readonly string[]): { allowed: boolean; reason: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'invalid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: `disallowed protocol ${parsed.protocol}` };
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrReservedHost(host)) {
      return { allowed: false, reason: 'loopback/private/metadata address blocked' };
    }
    if (allowedHosts.length === 0) {
      return { allowed: false, reason: 'no outbound hosts declared in manifest (default deny)' };
    }
    const ok = allowedHosts.some((entry) => {
      const pattern = entry.trim().toLowerCase();
      if (!pattern || pattern.includes('*')) return false;
      return host === pattern;
    });
    return ok ? { allowed: true, reason: '' } : { allowed: false, reason: `host ${host} not in allowlist` };
  }

  /**
   * Issue #71：worker 插件登记命令 handler 时，检查本插件是否已登记匹配的
   * ActionDescriptor。缺失时给出清晰告警（kernel default-deny 会拒绝该命令），
   * 不改变默认拒绝策略本身。使用本地登记清单比对，不产生额外 RPC。
   */
  private warnIfCommandHasNoDescriptor(registeredType: string): void {
    const pluginId = this.pluginId || this.pluginActorId.replace(/^plugin:/, '');
    const declared = new Set(this.registeredActionCommandTypes.values());
    const stripped = stripPluginCommandPrefix(registeredType, pluginId);
    if (declared.has(registeredType) || (stripped && declared.has(stripped))) return;
    console.warn(
      `[ServiceHost] Plugin "${pluginId}" registered command "${registeredType}" without a matching ActionDescriptor; ` +
        `the kernel default-deny policy will reject this command. ` +
        `Register one via ctx.services.actionRegistry.register({ commandType, capabilityRequired, inputSchema }) first.`,
    );
  }

  private async resolveService(tokenName: string): Promise<unknown> {
    // Prefer resolveByName if available (Plan 03+)
    if (typeof (this.serviceRegistry as unknown as Record<string, unknown>).resolveByName === 'function') {
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

  /**
   * 插件 SQL 只允许自己的表前缀。
   */
  private assertDatabaseAccessAllowed(sql: string): void {
    if (typeof sql !== 'string' || sql.trim() === '') return;

    const pluginId = this.pluginId || this.pluginActorId.replace(/^plugin:/, '');
    const scopeId = this.dbPluginId || pluginId;
    const manifestId =
      this.pluginId ||
      (this.pluginActorId.startsWith('plugin:') ? this.pluginActorId.replace(/^plugin:/, '') : undefined);
    const ownPrefix = scopeId ? pluginTablePrefix(scopeId, manifestId) : '';
    const allowedPrefixes = listAllowedPluginTablePrefixes(scopeId, manifestId);

    const researchIds = researchSqlPluginIds();
    const researchAllowed = researchIds.has(pluginId) || (!!this.dbPluginId && researchIds.has(this.dbPluginId));

    try {
      assertPluginSqlAllowed({
        sql,
        ownPrefix,
        allowedPrefixes,
        researchAllowed,
      });
    } catch (err: any) {
      const msg = err.message || String(err);
      const formatted = msg.startsWith('Worker plugin is not permitted')
        ? msg.replace('Worker plugin', `Worker plugin "${pluginId}"`)
        : `Worker plugin "${pluginId}": ${msg}`;
      throw new WorkerCapabilityError(
        this.pluginActorId,
        '@openlearn/core:IDatabase',
        formatted,
      );
    }
  }
}

function researchSqlPluginIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (env.OPENLEARN_RESEARCH_SQL_PLUGINS !== undefined) {
    return new Set(
      env.OPENLEARN_RESEARCH_SQL_PLUGINS.split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  }
  return new Set(['lianyun-course']);
}
