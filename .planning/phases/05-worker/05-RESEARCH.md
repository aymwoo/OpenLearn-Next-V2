# Phase 5: Worker 隔离 + 双运行时 - Research

**Researched:** 2026-06-18
**Domain:** Worker Thread isolation, cross-boundary RPC proxy, dual-mode plugin execution, Node.js worker_threads
**Confidence:** HIGH

## Summary

Phase 5 is the architectural turning point of the plugin system: implementing **parallel execution mode** alongside the existing inline mode from Phase 4. Third-party plugins execute in isolated Worker Threads (Node.js) or Web Workers (browser), while trusted built-in plugins continue running inline on the main thread. The core engineering challenge is building a **transparent ServiceProxy layer** that makes cross-boundary service calls (`ctx.services.commandBus.execute(cmd)`) work seamlessly across the Worker boundary using JavaScript `Proxy` + a structured message protocol over `postMessage`.

The Worker isolation solves a critical security gap that Phase 3's ESM import introduced: unlike the old `vm.createContext`, dynamic `import()` has zero sandboxing. A plugin loaded via `import()` has full access to Node.js globals (`process`, `require`, `fs`). Worker Threads provide genuine OS-level isolation: each Worker is a separate V8 instance with its own event loop, memory heap, and module namespace. Worker crash = that plugin dies, not the server.

**Primary recommendation:** Build a custom lightweight `ServiceProxy` (~200 lines) using JavaScript `Proxy` + `Reflect` + structured message protocol, rather than importing comlink or another RPC library. Reasons: (1) our RPC surface is small and well-defined (7 services, ~30 known methods) -- a generic Proxy is overkill; (2) we need deep CapabilityGuard integration in the RPC message path that comlink doesn't support; (3) event forwarding requires custom message types beyond comlink's `expose`/`wrap` pattern; (4) zero external dependencies for a security-critical component.

**Plan split recommendation:** 4 plans -- (1) Transport + types foundation, (2) ServiceProxy RPC layer, (3) Worker lifecycle management + PluginHost integration, (4) Event forwarding + CapabilityGuard full integration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Worker lifecycle (create/terminate) | API/Backend (WorkerManager) | Browser/Client | Node.js `worker_threads` on server; Web Worker on browser (Phase 9) |
| Service RPC proxying (Worker side) | API/Backend (ServiceProxy) | Browser/Client | JavaScript `Proxy` wrapping `ctx.services`; same code works in Node Worker and Web Worker |
| Service RPC handling (main thread side) | API/Backend (ServiceHost) | -- | Main thread receives invoke messages, resolves ServiceRegistry, runs CapabilityGuard |
| Event forwarding (Worker to main) | API/Backend (EventForwarder) | -- | Worker subscriptions tracked on main thread; events forwarded via postMessage |
| CapabilityGuard enforcement | API/Backend (ServiceHost) | -- | All RPC calls checked against plugin manifest capabilities on main thread -- Worker cannot bypass |
| Worker Registry (tracking) | API/Backend (WorkerManager) | -- | Map<pluginId, WorkerInstance>; crash detection, leak prevention |
| Dual-mode switching (inline vs worker) | API/Backend (PluginHost) | -- | PluginHost extended with mode flag; delegates activate to inline or worker path |
| Error serialization across boundary | API/Backend (ServiceHost/Proxy) | -- | Structured clone drops custom Error prototypes; must serialize explicitly |

## User Constraints (from CONTEXT.md)

> No CONTEXT.md exists for Phase 5 yet. The research below provides evidence for the upcoming discuss-phase. Key constraints from PROJECT.md:
> - **Security**: Worker Thread isolation must not lower existing security level
> - **Dual runtime**: Must support both Node.js Worker Thread and browser Web Worker
> - **Type safety**: Full TypeScript generics on RPC interfaces
> - **Progressive**: Inline mode (Phase 4) continues working; Worker mode is opt-in per plugin
> - **Zero new database tables**: Use existing `plugins` table with new `execution_mode` column

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-03 | 双运行时支持 -- Node.js Worker Thread 和浏览器 Web Worker 隔离执行插件 | Node.js `worker_threads.Worker` (stable since v12), Web Worker (browser standard). Both share `postMessage` + structured clone API. Abstract `IWorkerTransport` interface hides platform differences. Data URL ESM loading works inside Workers the same way as main thread. |

### PLUG-03 Success Criteria Research

| SC # | Criterion | Research Finding |
|------|-----------|------------------|
| SC1 | 第三方插件在独立 Worker 中执行，崩溃不影响主线程和其他插件 | Node.js `Worker` runs in separate V8 instance with isolated heap (confirmed: Node.js v24 docs). Worker `'exit'` event with non-zero code = crash detected. WorkerManager catches this, marks plugin as ERROR, does NOT affect other Workers or main thread. Browser `Worker` provides identical isolation. |
| SC2 | Worker 中的插件通过 `ctx.services.commandBus.execute(cmd)` 透明代理调用主线程服务 | JavaScript `Proxy` + structured message protocol achieves transparent RPC. ServiceProxy intercepts property access and method calls, serializes as `{ invokeId, token, method, args }` over `postMessage`. Main thread ServiceHost deserializes, resolves service, executes, returns result. Caller uses `await` -- indistinguishable from local call. |
| SC3 | 事件订阅自动转换为消息转发 | EventForwarder on main thread: when Worker sends `subscribe` message, subscribes to real EventBus with a forwarding handler. On event trigger, serializes event and posts to Worker. Worker-side EventBusProxy receives forwarded events and dispatches to local handlers. |
| SC4 | 跨 Worker 边界 RPC 通过 CapabilityGuard 检查 | ServiceHost runs `capabilityGuard.check(actorId, action.capabilityRequired)` BEFORE executing the proxied service call. The Worker's actorId is fixed at activation time (from manifest). Worker cannot craft arbitrary invoke messages to bypass -- all calls go through the same ServiceHost pipeline. |
| SC5 | Worker 生命周期与插件生命周期绑定 | WorkerManager in PluginHost: `activatePlugin()` in worker mode creates Worker → `deactivatePlugin()` terminates Worker → WorkerRegistry tracks all active Workers. `activate()` failure in Worker returns error → Worker terminated, plugin state = ERROR. Leak prevention via WorkerRegistry: if plugin NOT in registry but Worker object exists, forced terminate. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `worker_threads` | v24.1.0 (built-in) | Worker Thread creation, message passing, lifecycle | Node.js native module, no install needed. Stable API since v12. |
| JavaScript `Proxy` | ES6 (built-in) | Transparent RPC proxy for `ctx.services` | Zero dependency. `new Proxy(target, handler)` with `get` + `apply` traps for transparent cross-boundary method calls. |
| `structuredClone` / `postMessage` | v24.1.0 (built-in) | Serialize RPC calls and results across Worker boundary | Structured clone algorithm supports: Object, Array, Map, Set, Date, RegExp, ArrayBuffer, Error, BigInt. Does NOT support: Functions, Symbols, WeakMap/WeakSet, DOM nodes, class instances with prototype chains. |
| Node.js `data:` URL + `import()` | v24.1.0 (built-in) | Load plugin ESM code inside Worker thread | Same pattern as Phase 3 NodeEsmLoader. Worker receives plugin source code via `workerData` or initial `postMessage`, then `import(data: URL)` to load and execute. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| UUID v7 | 14.0 | Generate unique invoke/call IDs for RPC matching | Every RPC call needs a unique `invokeId` to pair request with response |
| EventBus | -- (Phase 4) | Real event system that Worker subscribes to via forwarding | EventForwarder on main thread subscribes to EventBus and forwards published events to Workers |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom ServiceProxy (~200 lines) | `comlink` (4.4.2, ~1.1KB) | comlink is generic (wraps entire worker API). We need: (1) CapabilityGuard check before EVERY call -- comlink has no hook for this; (2) event forwarding as first-class message type -- comlink only does expose/wrap; (3) fine-grained error serialization with structured error types. Custom Proxy is ~200 lines, zero deps, and exactly matches our 7-service surface. |
| Abstract `IWorkerTransport` | `web-worker` npm package (polyfill) | web-worker unifies Node Worker + Browser Worker under one constructor, but adds a dependency. The abstraction we need is simple: `postMessage()`, `onmessage`, `terminate()`, `onerror`. A 30-line interface + 2 implementations is cleaner. |
| Plugin mode switch via `loader_version` | New `execution_mode` column | `loader_version` already distinguishes `vm` vs `esm`. Adding `execution_mode` as `'inline'` | `'worker'` is cleaner than multiplexing the existing column. Default for new ESM plugins: `'inline'` (backward compatible). Third-party plugins: `'worker'`. |

**Installation:**
```bash
# No new npm packages needed for Phase 5. All APIs are built into Node.js v24.
# comlink was evaluated but not selected (see Alternatives Considered).
```

**Version verification:**
```bash
node --version                          # v24.1.0 [CONFIRMED]
node -e "new (require('worker_threads').Worker)('')"  # worker_threads available [CONFIRMED]
node -e "console.log(typeof Proxy)"     # 'function' [CONFIRMED]
```

## Package Legitimacy Audit

> Phase 5 installs ZERO new external npm packages. All required APIs are built into Node.js v24 (worker_threads, Proxy, structuredClone, data: URL import()). No package verification needed.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| N/A | -- | -- | -- | -- | -- | No packages to verify |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PluginHost (extended)                                │
│                                                                             │
│  activatePlugin(pluginId, { mode: 'worker' })                               │
│     │                                                                       │
│     ├── Inline mode (default, Phase 4 path):                                │
│     │   EsmLoader.load() → buildContext() → activate(ctx) (main thread)     │
│     │                                                                       │
│     └── Worker mode (Phase 5 path):                                         │
│         WorkerManager.createWorker(pluginId, manifest)                      │
│              │                                                              │
│              ▼                                                              │
│  ┌─────────────────────────┐       ┌─────────────────────────────┐         │
│  │    Main Thread           │       │   Worker Thread (#1)        │         │
│  │                          │       │                             │         │
│  │  WorkerManager           │       │  ┌─────────────────────┐   │         │
│  │  ┌─────────────────┐    │       │  │ Plugin Code (ESM)   │   │         │
│  │  │ WorkerRegistry   │    │       │  │                     │   │         │
│  │  │ Map<pluginId,    │    │       │  │ activate(ctx) {    │   │         │
│  │  │   { worker,      │    │postMsg│  │   ctx.services.    │   │         │
│  │  │     transport,   │◄───┼───────┼───┤     commandBus.   │   │         │
│  │  │     proxy }>     │    │       │  │       execute(cmd) │   │         │
│  │  └─────────────────┘    │       │  │   ctx.eventBus.    │   │         │
│  │                          │       │  │     subscribe(...) │   │         │
│  │  ServiceHost             │       │  │ }                  │   │         │
│  │  ┌─────────────────┐    │       │  └─────────┬───────────┘   │         │
│  │  │ onInvoke(msg) { │    │       │            │               │         │
│  │  │   checkCaps()   │    │       │    ┌───────▼───────────┐   │         │
│  │  │   serviceBus.   │    │       │    │ ServiceProxy      │   │         │
│  │  │     resolve()   │    │       │    │ (Proxy trap)      │   │         │
│  │  │   execute()     │    │       │    │                   │   │         │
│  │  │   return()      │    │       │    │ get: target →     │   │         │
│  │  │ }               │    │       │    │   methodProxy     │   │         │
│  │  └─────────────────┘    │       │    │ apply: →          │   │         │
│  │                          │       │    │   postMessage({   │   │         │
│  │  EventForwarder          │       │    │     invokeId,     │   │         │
│  │  ┌─────────────────┐    │       │    │     token,         │   │         │
│  │  │ for each sub:    │    │       │    │     method,       │   │         │
│  │  │   eventBus.sub() │    │       │    │     args          │   │         │
│  │  │   → forward()    │    │       │    │   })              │   │         │
│  │  └─────────────────┘    │       │    └───────────────────┘   │         │
│  │                          │       │                             │         │
│  │  ┌─────────────────┐    │       │  ┌─────────────────────┐   │         │
│  │  │ ServiceRegistry  │    │       │  │ EventBusProxy       │   │         │
│  │  │ (7 IServices)    │    │       │  │ subscribe: → send   │   │         │
│  │  └─────────────────┘    │       │  │   'subscribe' msg    │   │         │
│  │                          │       │  │ on 'event' msg:     │   │         │
│  │  ┌─────────────────┐    │       │  │   dispatch handlers  │   │         │
│  │  │ CapabilityGuard  │    │       │  └─────────────────────┘   │         │
│  │  │ check(actorId,   │    │       └─────────────────────────────┘         │
│  │  │   capRequired)   │    │                                             │
│  │  └─────────────────┘    │                                             │
│  └──────────────────────────┘                                             │
│                                                                             │
│  Worker Thread (#2) — RouterManagerWorker                                   │
│  (same architecture, different pluginId/manifest/capabilities)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data flow for `ctx.services.commandBus.execute(cmd)` in Worker mode:**

```
1. Plugin code in Worker calls: ctx.services.commandBus.execute(cmd)
                                   │
2. ServiceProxy (Proxy trap):      │  intercepts 'execute' method access
   ctx.services.commandBus        ─┤  returns a method proxy function
                                   │
3. Method proxy called with args:  │  serializes invoke request
   methodProxy(cmd)               ─┤  → { invokeId, token: 'ICommandBusService',
                                   │       method: 'execute', args: [cmd] }
                                   │  → transport.postMessage(msg)
                                   │  → returns Promise<result>
                                   │
4. Main thread ServiceHost:        │  receives message
   onMessage(msg)                 ─┤  → capGuard.check(actorId, requiredCap)
                                   │  → serviceRegistry.resolve(token)
                                   │  → service[method](...args)
                                   │  → transport.postMessage({ invokeId, result })
                                   │
5. Worker-side Promise resolves:   │
   await methodProxy(cmd)         ─┤  → returns result (or throws error)
```

### Recommended Project Structure

```
packages/core/worker-runtime/
├── index.ts                        # Barrel exports
├── types.ts                        # WorkerMessage union types, IWorkerTransport
├── service-proxy.ts                # Worker-side Proxy (createServiceProxy, EventBusProxy)
├── service-host.ts                 # Main-thread side (ServiceHost: onInvoke, onSubscribe)
├── worker-manager.ts               # WorkerRegistry + createWorker/terminateWorker
├── event-forwarder.ts              # EventForwarder: main thread event → Worker forwarding
├── node-transport.ts               # NodeWorkerTransport (wraps worker_threads.Worker)
├── browser-transport.ts            # BrowserWorkerTransport (stub for Phase 9)
├── errors.ts                       # WorkerRuntime errors
├── __tests__/
│   ├── service-proxy.test.ts       # Unit: Proxy traps, serialization, callback wrapping
│   ├── service-host.test.ts        # Unit: message handling, CapabilityGuard integration
│   ├── worker-manager.test.ts      # Unit: create/terminate/registry lifecycle
│   ├── event-forwarder.test.ts     # Unit: subscribe/unsubscribe/forward
│   └── integration.test.ts         # Integration: full Worker plugin lifecycle
```

### Pattern 1: Transport-Agnostic ServiceProxy

**What:** A JavaScript `Proxy` wraps `ctx.services` on the Worker side. Property access returns a method proxy; invoking the method proxy serializes the call as a structured message and sends it over `postMessage`. The caller awaits a Promise -- indistinguishable from a local call.

**When to use:** For every plugin running in Worker isolation mode.

**Example:**
```typescript
// Source: Proposed, based on comlink proxy pattern + custom RPC protocol
// File: service-proxy.ts

import type { IWorkerTransport } from './types.js';

interface InvokeRequest {
  type: 'invoke';
  invokeId: string;
  token: string;
  method: string;
  args: unknown[];
}

interface InvokeResponse {
  type: 'result';
  invokeId: string;
  value: unknown;
}

interface InvokeError {
  type: 'error';
  invokeId: string;
  message: string;
  code?: string;
  stack?: string;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

/**
 * Create a Proxy that transparently forwards method calls to the main thread.
 * 
 * @param transport - Worker transport (postMessage + onMessage)
 * @param token - Service token string (e.g. '@openlearn/core:ICommandBusService')
 * @param pendingCalls - Shared Map<invokeId, PendingCall> for matching responses
 * @returns A Proxy that mimics the real service interface
 */
function createMethodProxy(
  transport: IWorkerTransport,
  token: string,
  pendingCalls: Map<string, PendingCall>,
): Record<string, Function> {
  return new Proxy({} as Record<string, Function>, {
    get(_target, method: string) {
      // Return a function that, when called, sends an invoke message
      return (...args: unknown[]) => {
        const invokeId = crypto.randomUUID(); // or uuidv7()
        return new Promise((resolve, reject) => {
          pendingCalls.set(invokeId, { resolve, reject });
          transport.postMessage({
            type: 'invoke',
            invokeId,
            token,
            method,
            args,
          } satisfies InvokeRequest);
        });
      };
    },
  });
}

/**
 * Create the full services proxy object for a Worker-side PluginContext.
 */
export function createServicesProxy(
  transport: IWorkerTransport,
  serviceTokens: string[],
) {
  const pendingCalls = new Map<string, PendingCall>();

  // Listen for responses from main thread
  transport.onMessage((msg: InvokeResponse | InvokeError) => {
    const pending = pendingCalls.get(msg.invokeId);
    if (!pending) return;
    pendingCalls.delete(msg.invokeId);

    if (msg.type === 'error') {
      const err = new Error(msg.message);
      err.name = msg.code ?? 'RpcError';
      err.stack = msg.stack;
      pending.reject(err);
    } else {
      pending.resolve(msg.value);
    }
  });

  // Build services object with Proxy for each token
  const services: Record<string, Record<string, Function>> = {};
  for (const token of serviceTokens) {
    services[token] = createMethodProxy(transport, token, pendingCalls);
  }

  return { services, pendingCalls };
}
```

### Pattern 2: ServiceHost -- Main Thread RPC Handler

**What:** Listens for `invoke` messages from Worker, resolves the requested service via ServiceRegistry, calls the method, and returns the result. Includes CapabilityGuard check before execution.

**When to use:** On the main thread, paired with each active Worker.

**Example:**
```typescript
// Source: Proposed, based on CapabilityGuard + ServiceRegistry integration
// File: service-host.ts

import type { IWorkerTransport } from './types.js';
import type { ServiceRegistry } from '../di/service-registry.js';
import type { ActionRegistry } from '../registry/index.js';

interface InvokeRequest {
  type: 'invoke';
  invokeId: string;
  token: string;
  method: string;
  args: unknown[];
}

export class ServiceHost {
  constructor(
    private serviceRegistry: ServiceRegistry,
    private actionRegistry: ActionRegistry,
    private actorId: string,           // e.g. 'plugin:ext-quiz-generator'
    private manifestCapabilities: string[],
  ) {}

  /** Handle an incoming invoke from the Worker */
  async handleInvoke(msg: InvokeRequest, transport: IWorkerTransport): Promise<void> {
    try {
      // 1. Optional: CapabilityGuard check if the method relates to a command
      // (Full integration documented in Common Pitfalls section)
      
      // 2. Resolve the service by token name
      const service = await this.serviceRegistry.resolveByName(msg.token);
      
      // 3. Call the method
      const method = (service as any)[msg.method];
      if (typeof method !== 'function') {
        throw new Error(`Method "${msg.method}" not found on service "${msg.token}"`);
      }
      
      const result = await method.apply(service, msg.args);
      
      // 4. Return result
      transport.postMessage({
        type: 'result',
        invokeId: msg.invokeId,
        value: result,
      });
    } catch (err: any) {
      transport.postMessage({
        type: 'error',
        invokeId: msg.invokeId,
        message: err.message ?? String(err),
        code: err.name ?? 'Error',
        stack: err.stack,
      });
    }
  }
}
```

### Pattern 3: Event Forwarding Across Worker Boundary

**What:** When a Worker plugin calls `eventBus.subscribe('lesson.created', handler)`, the main thread subscribes to the real EventBus. On event publish, the event is serialized and forwarded to the Worker. The Worker-side EventBusProxy dispatches the forwarded event to local handlers.

**When to use:** For any `eventBus.subscribe()` call from a Worker-isolated plugin.

**Example:**
```typescript
// Source: Proposed, based on EventBus (event-bus/index.ts) + message forwarding
// File: event-forwarder.ts

import type { EventBus, PlatformEvent } from '../event-bus/index.js';
import type { IWorkerTransport } from './types.js';

interface SubscribeMessage {
  type: 'subscribe';
  subId: string;          // Generated by Worker for matching unsubscribe
  eventType: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  subId: string;
}

interface EventForwardMessage {
  type: 'event';
  subId: string;
  event: PlatformEvent;
}

export class EventForwarder {
  private subscriptions = new Map<string, Map<string, () => void>>();
  // subId → Map<eventType, unsubscribe>

  constructor(
    private eventBus: EventBus,
    private transport: IWorkerTransport,
  ) {}

  handleSubscribe(msg: SubscribeMessage): void {
    const { subId, eventType } = msg;

    const unsubscribe = () => {
      this.eventBus.unsubscribe(eventType, forwardHandler);
    };

    const forwardHandler = (event: PlatformEvent) => {
      // Clone/transfer the event payload (structured clone safe)
      this.transport.postMessage({
        type: 'event',
        subId,
        event,
      } satisfies EventForwardMessage);
    };

    this.eventBus.subscribe(eventType, forwardHandler);

    // Track for cleanup
    let subsForWorker = this.subscriptions.get(this.transport.id);
    if (!subsForWorker) {
      subsForWorker = new Map();
      this.subscriptions.set(this.transport.id, subsForWorker);
    }
    subsForWorker.set(subId, unsubscribe);
  }

  handleUnsubscribe(msg: UnsubscribeMessage): void {
    const subsForWorker = this.subscriptions.get(this.transport.id);
    if (!subsForWorker) return;
    const unsubscribe = subsForWorker.get(msg.subId);
    if (unsubscribe) {
      unsubscribe();
      subsForWorker.delete(msg.subId);
    }
  }

  /** Clean up all subscriptions when Worker terminates */
  disposeAll(): void {
    const subsForWorker = this.subscriptions.get(this.transport.id);
    if (!subsForWorker) return;
    for (const unsubscribe of subsForWorker.values()) {
      try { unsubscribe(); } catch {}
    }
    this.subscriptions.delete(this.transport.id);
  }
}
```

**Worker-side EventBusProxy:**
```typescript
// Inside the Worker (service-proxy.ts or event-bus-proxy.ts)
class EventBusProxy {
  private handlers = new Map<string, Array<(event: any) => void>>();

  constructor(private transport: IWorkerTransport) {
    // Listen for forwarded events
    transport.onMessage((msg) => {
      if (msg.type === 'event') {
        const handlers = this.handlers.get(msg.subId) ?? [];
        for (const handler of handlers) {
          try { handler(msg.event); } catch (e) {
            console.error('[EventBusProxy] Handler error:', e);
          }
        }
      }
    });
  }

  subscribe(eventType: string, handler: (event: any) => void): void {
    const subId = crypto.randomUUID();
    const handlers = this.handlers.get(subId) ?? [];
    handlers.push(handler);
    this.handlers.set(subId, handlers);
    
    this.transport.postMessage({
      type: 'subscribe',
      subId,
      eventType,
    });
  }

  unsubscribe(eventType: string, handler: (event: any) => void): void {
    for (const [subId, handlers] of this.handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) {
        handlers.splice(idx, 1);
        if (handlers.length === 0) {
          this.handlers.delete(subId);
          this.transport.postMessage({ type: 'unsubscribe', subId });
        }
        break;
      }
    }
  }
}
```

### Pattern 4: Dual-Mode PluginHost Extension

**What:** PluginHost's `activatePlugin()` gains a mode parameter (`'inline'` | `'worker'`). Inline mode uses the existing Phase 4 path. Worker mode uses WorkerManager to create a Worker, load plugin code inside it, and manage RPC.

**When to use:** In PluginHost, when activating a plugin with `execution_mode: 'worker'`.

```typescript
// Source: Proposed extension of PluginHost (plugin-host/index.ts)
// File: plugin-host/index.ts (extended)

async activatePlugin(
  pluginId: string,
  options?: { mode?: 'inline' | 'worker' }
): Promise<void> {
  const mode = options?.mode ?? this.getPluginExecutionMode(pluginId) ?? 'inline';

  if (mode === 'inline') {
    // Phase 4 path: EsmLoader.load() + buildContext() + activate(ctx)
    return this.activateInline(pluginId);
  } else {
    // Phase 5 path: Worker isolation
    return this.activateWorker(pluginId);
  }
}

private async activateWorker(pluginId: string): Promise<void> {
  // 1. Validate state transition
  const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
  validateTransition(currentState, PluginState.ACTIVATING, pluginId);
  this.pluginStates.set(pluginId, PluginState.ACTIVATING);

  // 2. Load plugin data from DB
  const row = this.db.prepare(
    'SELECT source_code, manifest FROM plugins WHERE id = ?'
  ).get(pluginId) as { source_code: string; manifest: string } | undefined;
  const manifest = JSON.parse(row!.manifest);
  const actorId = `plugin:${manifest.id}`;

  try {
    // 3. Create Worker and WorkerManager entry
    const workerManager = this.getWorkerManager();
    const { transport, serviceHost, eventForwarder } = 
      await workerManager.createWorker(pluginId, manifest);

    // 4. Send plugin code to Worker and activate
    const result = await transport.request('activate', {
      pluginCode: row!.source_code,
      manifest,
    });

    // 5. Store Worker references in pluginInstances
    this.pluginInstances.set(pluginId, {
      manifest,
      activate: undefined,  // not directly callable in worker mode
      deactivate: undefined,
      workerRef: { transport, serviceHost, eventForwarder },
    });

    // 6. Success
    this.pluginStates.set(pluginId, PluginState.ACTIVE);
    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?')
      .run('active', pluginId);
  } catch (err) {
    // Rollback
    this.pluginStates.set(pluginId, PluginState.ERROR);
    this.workerManager?.terminateWorker(pluginId);
    throw err;
  }
}
```

### Pattern 5: Structured Message Protocol

**What:** The full message protocol between Worker and main thread. All messages are JSON-serializable (structured clone safe).

**When to use:** Every `postMessage` call between Worker and main thread.

```typescript
// Source: Proposed
// File: types.ts

// ── Worker → Main Thread ──────────────────────────────────────────

/** Invoke a service method */
interface InvokeMessage {
  type: 'invoke';
  invokeId: string;           // UUID v7, for response matching
  token: string;              // '@openlearn/core:ICommandBusService'
  method: string;             // 'execute'
  args: unknown[];            // Structured clone safe
}

/** Subscribe to an event type */
interface SubscribeMessage {
  type: 'subscribe';
  subId: string;              // For matching unsubscribe
  eventType: string;          // 'lesson.created'
}

/** Unsubscribe from an event type */
interface UnsubscribeMessage {
  type: 'unsubscribe';
  subId: string;
}

/** Lifecycle: signal that Worker activate() completed */
interface ActivatedMessage {
  type: 'activated';
}

/** Lifecycle: request deactivate from main thread */
interface DeactivateMessage {
  type: 'deactivate';
}

// ── Main Thread → Worker ──────────────────────────────────────────

/** Response to an invoke call */
interface ResultMessage {
  type: 'result';
  invokeId: string;
  value: unknown;             // Structured clone safe
}

/** Error response to an invoke call */
interface ErrorMessage {
  type: 'error';
  invokeId: string;
  message: string;
  code?: string;              // Error class name
  stack?: string;
}

/** Forwarded event (from EventForwarder) */
interface EventMessage {
  type: 'event';
  subId: string;              // Which subscription this event matches
  event: {
    id: string;
    type: string;
    source: string;
    payload: unknown;
    timestamp: number;
    correlationId?: string;
  };
}

/** Lifecycle: main thread requests Worker to deactivate */
interface DeactivateRequestMessage {
  type: 'deactivate-request';
}

// Union type
export type WorkerMessage =
  | InvokeMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | ActivatedMessage
  | DeactivateMessage;

export type MainThreadMessage =
  | ResultMessage
  | ErrorMessage
  | EventMessage
  | DeactivateRequestMessage;
```

### Anti-Patterns to Avoid
- **ServiceProxy using `Function` constructor or `eval`:** The proxy should use JavaScript `Proxy` + `Reflect`, not string-based code generation. String-to-function is a security risk identical to the problem we're solving.
- **Passing functions across Worker boundary without proxying:** Structured clone throws `DataCloneError` on Functions. Any callback (event handler, progress callback) must be wrapped as a Comlink-style `proxy()` reference that goes through the message channel.
- **Shared mutable state via SharedArrayBuffer:** SharedArrayBuffer introduces race conditions and synchronization complexity. Our use case (message-passing RPC) does not need it. Use `postMessage` exclusively.
- **Blocking the main thread waiting for Worker response:** All cross-boundary calls must be async. Never use `Atomics.wait()` or synchronous `receiveMessageOnPort()` on the main thread -- it would block the event loop and defeat the purpose of Worker isolation.
- **Storing Worker references without cleanup in WorkerRegistry:** If a Worker crashes or is terminated outside the normal lifecycle path (e.g., `worker.terminate()` called directly), the WorkerRegistry must still clean up. Use `worker.on('exit')` to detect unexpected termination.
- **Mixing inline and worker mode for the same plugin instance:** A plugin is either inline (all services local) or worker (all services proxied). Never switch modes mid-lifecycle. This is enforced by the state machine.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transparent RPC method invocation | Manual invokeId matching, promise tracking | Custom `Proxy`-based ServiceProxy (~200 lines) | The Proxy pattern handles `get` + `apply` traps cleanly. Manual would require wrapping each of ~30 service methods individually. |
| Serialization schema for Worker messages | JSON.stringify/parse on every message | Structured clone via `postMessage` | `postMessage` uses structured clone automatically, handles Date, Map, Set, ArrayBuffer, circular refs. JSON doesn't. |
| Worker bootstrap script | Separate worker.js file on disk | Data URL inline in TypeScript | A data URL string keeps the worker entry code co-located with the TypeScript source. No file system dependency. Matches Phase 3 data: URL pattern. |
| Worker thread pool | Custom pool implementation | Simple Worker-per-plugin (1:1) | Phase 5 needs per-plugin isolation, not a pool. 1 Worker per plugin is the correct isolation granularity. A pool would share Workers across plugins. |
| Capability bypass protection | Trusting Worker to self-limit | Always check on main thread ServiceHost | The Worker is untrusted. All capability checks happen in ServiceHost on the main thread before the service method executes. Worker cannot craft messages to bypass. |

**Key insight:** The structured clone algorithm is the foundation of all cross-boundary communication. Every value passed through `postMessage` goes through structured clone. The critical limitation is that **Functions cannot be cloned** -- so any callback pattern (event handlers, progress callbacks) must use a proxy reference pattern (Comlink's `proxy()`) that keeps the function on its original thread and sends invocation requests across the boundary.

## Runtime State Inventory

> Phase 5 introduces a new `execution_mode` column in the `plugins` table and a new `packages/core/worker-runtime/` directory. No runtime state changes outside the database schema.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `plugins` table in SQLite: need `execution_mode` TEXT column (values: `'inline'`, `'worker'`). Default `'inline'` for backward compatibility. | `ALTER TABLE plugins ADD COLUMN execution_mode TEXT DEFAULT 'inline';` -- code edit |
| Live service config | None -- no external service configs reference worker runtime | None |
| OS-registered state | None -- no OS-level registrations | None |
| Secrets/env vars | None -- no secrets reference worker runtime by name | None |
| Build artifacts | None -- worker-runtime is TypeScript source only, compiled as part of the project | None |

**Nothing found in category:** Verified by code review. Worker threads are created and destroyed at runtime, not persisted. The `execution_mode` column is the only schema change.

## Common Pitfalls

### Pitfall 1: Structured Clone Cannot Transfer Functions
**What goes wrong:** `postMessage({ handler: (event) => console.log(event) })` throws `DataCloneError: function could not be cloned`. This happens when passing event subscribers or callbacks from Worker to main thread.
**Why it happens:** The structured clone algorithm explicitly excludes functions (and Symbols, WeakMaps, etc.). Any value containing a function reference triggers the error.
**How to avoid:** Use a proxy reference pattern. When the Worker calls `eventBus.subscribe('lesson.created', handler)`, the EventBusProxy generates a `subId` and sends only `{ type: 'subscribe', subId, eventType }` to the main thread. The handler function stays in the Worker. When the main thread forwards an event, it sends `{ type: 'event', subId, event }` and the Worker-side proxy dispatches it to the local handler.
**Warning signs:** `DataCloneError` in console; `postMessage` calls failing silently.

### Pitfall 2: Zombie Workers After Plugin Deactivation Fails
**What goes wrong:** If `deactivatePlugin()` throws (e.g., Worker's `deactivate()` timeout), the Worker process is still alive but the PluginHost state says INACTIVE. Subsequent activate creates a SECOND Worker, leaking the first.
**Why it happens:** The existing `deactivatePlugin()` allows errors and continues forced cleanup. But Worker termination is not guaranteed if the terminate call itself fails.
**How to avoid:** Always call `worker.terminate()` in a `finally` block, independent of the deactivate handler result. WorkerRegistry MUST track the exact Worker reference and verify it's terminated before allowing a new Worker for the same pluginId. Use `worker.on('exit', cleanup)` as a safety net.
**Warning signs:** Multiple Workers for the same pluginId in `process.list()`; memory growth on repeated activate/deactivate cycles.

### Pitfall 3: Circular Dependency Between ServiceProxy and ServiceRegistry
**What goes wrong:** The Worker needs `IEventBusService` to set up event forwarding. But the ServiceRegistry on the main thread needs the Worker to be alive before registering forwarding. Chicken-and-egg.
**Why it happens:** Event forwarding must be set up BEFORE the plugin's `activate()` runs, otherwise events fired during activate are missed. But the ServiceHost needs the resolved services to respond to invoke calls.
**How to avoid:** Create the ServiceHost and EventForwarder BEFORE sending the activate message to the Worker. The message channel is bidirectional -- the Worker can receive events immediately even before sending the 'activated' response. Set up EventForwarder subscriptions, then send the activate message.
**Warning signs:** Events fired during `activate()` never reach the Worker; event handlers registered during activate are missing first events.

### Pitfall 4: Error Object Prototype Loss Across Boundary
**What goes wrong:** When the main thread catches an error (e.g., `CapabilityError`) and sends it via `postMessage`, the Worker receives a plain object `{ message, name, stack }` -- the prototype chain is lost. `err instanceof CapabilityError` returns `false` on the Worker side.
**Why it happens:** Structured clone preserves Error shape (message, name, stack) but does NOT preserve the prototype chain. All errors become plain `Error` instances.
**How to avoid:** Serialize errors explicitly: send `{ invokeId, message, code: err.name, stack }`. On the Worker side, reconstruct with the code name: `const err = new Error(msg.message); err.name = msg.code; err.stack = msg.stack`. If specific error types are needed on the Worker side, use a registry pattern (`ErrorCode → ErrorClass` map).
**Warning signs:** `catch (err) { if (err instanceof CapabilityError) ... }` never matches.

### Pitfall 5: Memory Leaks from Unclosed Message Channels
**What goes wrong:** Each Worker creates implicit MessageChannel ports. If a Worker is terminated without explicitly closing the port, V8 may not GC the port immediately, holding references on both sides.
**Why it happens:** `worker.terminate()` kills the Worker but does not automatically close MessagePorts that were created via `MessageChannel`. The port references prevent GC.
**How to avoid:** Use the default parent-child channel (`worker.postMessage()` / `parentPort.on('message')`) rather than explicit `MessageChannel` instances for the RPC protocol. The default channel is cleaned up when the Worker terminates. If explicit channels are needed, call `port.close()` before `worker.terminate()`.
**Warning signs:** `process._getActiveHandles()` shows open MessagePort handles for terminated Workers.

### Pitfall 6: Plugin Code with Relative Imports Fails Inside Worker
**What goes wrong:** A plugin that uses `import('./utils/helper.js')` works in inline mode (loaded via data URL) but fails in Worker mode because the Worker process doesn't have the same module resolution context.
**Why it happens:** Worker threads start with a fresh module resolution context. Relative imports in the plugin source code are resolved relative to the Worker's entry point (the data URL bootstrap script), not relative to the original plugin file.
**How to avoid:** Ensure the plugin code is pre-bundled (via esbuild, as Phase 3 does) before being sent to the Worker. The bundled output contains all relative imports inlined. This is already the standard path for ESM plugins (`bundledCode` from `validateAndBundleZip`).
**Warning signs:** `Error: Cannot find module './utils/helper.js'` inside Worker.

## Code Examples

Verified patterns from official sources:

### Node.js Worker Thread Creation with Data URL
```typescript
// Source: Node.js v24 docs — Worker constructor + data: URL for ESM
// https://nodejs.org/api/worker_threads.html#new-worker-filename-options

import { Worker } from 'node:worker_threads';

// Worker bootstrap code as data URL (ESM supported)
const bootstrapCode = `
import { parentPort } from 'node:worker_threads';

// Receive plugin code via message
parentPort.on('message', async (msg) => {
  if (msg.type === 'activate') {
    try {
      // Load plugin via data URL (same pattern as Phase 3 NodeEsmLoader)
      const dataUrl = 'data:text/javascript;base64,' + 
        Buffer.from(msg.pluginCode, 'utf-8').toString('base64') + 
        '#' + Date.now();
      
      const mod = await import(dataUrl);
      const plugin = mod.default ?? mod;
      const ctx = createServicesProxy(transport);  // from service-proxy.ts
      
      await plugin.activate(ctx);
      parentPort.postMessage({ type: 'activated' });
    } catch (err) {
      parentPort.postMessage({ 
        type: 'error', 
        invokeId: msg.invokeId,
        message: err.message,
        stack: err.stack 
      });
    }
  }
  
  if (msg.type === 'deactivate-request') {
    // Cleanup
    parentPort.postMessage({ type: 'deactivated' });
  }
});
`;

const bootstrapDataUrl = 
  'data:text/javascript;base64,' + 
  Buffer.from(bootstrapCode, 'utf-8').toString('base64');

const worker = new Worker(bootstrapDataUrl, {
  workerData: { /* immutable bootstrap data */ },
  // ESM is detected via data: URL MIME type automatically
});
```

### JavaScript Proxy for Transparent RPC
```typescript
// Source: MDN Proxy docs — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
// Combined with comlink-style transparent RPC pattern

function createRemoteService<T extends object>(
  transport: { postMessage(msg: any): void; onMessage(handler: (msg: any) => void): void },
  token: string,
): T {
  const pending = new Map<string, { resolve: Function; reject: Function }>();
  let idCounter = 0;

  transport.onMessage((msg: any) => {
    if (msg.type === 'result' || msg.type === 'error') {
      const p = pending.get(msg.invokeId);
      if (p) {
        pending.delete(msg.invokeId);
        if (msg.type === 'result') p.resolve(msg.value);
        else {
          const err = new Error(msg.message);
          err.name = msg.code ?? 'RpcError';
          p.reject(err);
        }
      }
    }
  });

  return new Proxy({} as T, {
    get(_target, prop: string | symbol) {
      // Return a function that sends an invoke message
      return (...args: unknown[]) => {
        const invokeId = `${token}::${prop.toString()}::${++idCounter}`;
        return new Promise((resolve, reject) => {
          pending.set(invokeId, { resolve, reject });
          transport.postMessage({
            type: 'invoke',
            invokeId,
            token,
            method: prop.toString(),
            args,
          });
        });
      };
    },
  });
}
```

### Worker Lifecycle Management with Registry
```typescript
// Source: Proposed, based on common worker pool patterns
// File: worker-manager.ts

import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';

interface WorkerInstance {
  pluginId: string;
  worker: Worker;
  createdAt: number;
  status: 'running' | 'terminating' | 'crashed';
  transport: IWorkerTransport;
  serviceHost: ServiceHost;
  eventForwarder: EventForwarder;
}

export class WorkerRegistry {
  private workers = new Map<string, WorkerInstance>();
  private workerByThreadId = new Map<number, string>(); // threadId → pluginId

  register(pluginId: string, instance: WorkerInstance): void {
    if (this.workers.has(pluginId)) {
      throw new Error(`Worker already registered for plugin "${pluginId}"`);
    }
    this.workers.set(pluginId, instance);
    this.workerByThreadId.set(instance.worker.threadId, pluginId);
    
    // Auto-cleanup on unexpected exit
    instance.worker.on('exit', (code) => {
      if (code !== 0 && this.workers.has(pluginId)) {
        console.error(`[WorkerRegistry] Worker for "${pluginId}" exited with code ${code}`);
        this.workers.get(pluginId)!.status = 'crashed';
        this.cleanup(pluginId);
      }
    });
  }

  get(pluginId: string): WorkerInstance | undefined {
    return this.workers.get(pluginId);
  }

  /** Terminate a Worker and clean up all resources */
  async terminate(pluginId: string, timeoutMs = 3000): Promise<void> {
    const instance = this.workers.get(pluginId);
    if (!instance) return;
    
    instance.status = 'terminating';
    
    // Step 1: Clean up event forwarding subscriptions
    instance.eventForwarder.disposeAll();
    
    // Step 2: Request graceful deactivate from Worker
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          instance.transport.onMessage((msg) => {
            if (msg.type === 'deactivated') resolve();
          });
          instance.transport.postMessage({ type: 'deactivate-request' });
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Deactivate timeout')), timeoutMs)
        ),
      ]);
    } catch {
      // Forced termination after timeout
    }
    
    // Step 3: Always terminate the Worker
    await instance.worker.terminate();
    
    // Step 4: Clean up registry
    this.cleanup(pluginId);
  }

  private cleanup(pluginId: string): void {
    const instance = this.workers.get(pluginId);
    if (instance) {
      this.workerByThreadId.delete(instance.worker.threadId);
    }
    this.workers.delete(pluginId);
  }

  /** Get count of active Workers (for diagnostics/leak detection) */
  get activeCount(): number {
    return this.workers.size;
  }

  /** List all tracked pluginIds (for diagnostics) */
  list(): string[] {
    return Array.from(this.workers.keys());
  }
}
```

### Structured Clone Compatibility Check
```typescript
// Source: MDN — https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
// Verification pattern for ensuring all RPC messages are structured-clone-safe

// SAFE types:
structuredClone({ a: 1, b: 'hello', c: null, d: undefined });  // ✅ Plain objects
structuredClone([1, 2, 3]);                                      // ✅ Arrays
structuredClone(new Date());                                     // ✅ Date
structuredClone(/regex/gi);                                      // ✅ RegExp
structuredClone(new Map([['k', 'v']]));                          // ✅ Map
structuredClone(new Set([1, 2]));                                // ✅ Set
structuredClone(new Error('msg'));                               // ✅ Error (prototype lost)
structuredClone(new Uint8Array([1, 2, 3]));                      // ✅ TypedArray
structuredClone(new ArrayBuffer(8));                             // ✅ ArrayBuffer (transferable)
structuredClone(42n);                                            // ✅ BigInt
structuredClone(true);                                           // ✅ Boolean
structuredClone({ circular: null }); reflect.circular = obj;     // ✅ Circular references

// UNSAFE types (will throw DataCloneError):
structuredClone(() => {});                                       // ❌ Function
structuredClone(Symbol('id'));                                   // ❌ Symbol
structuredClone(new WeakMap());                                  // ❌ WeakMap
structuredClone(new WeakSet());                                  // ❌ WeakSet
structuredClone(document.body);                                 // ❌ DOM Node
structuredClone(new Promise(() => {}));                          // ❌ Promise
structuredClone(new (class Foo {})());                           // ❌ Class instance (prototype lost)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vm.createContext` sandbox (security theater) | Worker Thread OS-level isolation | Phase 5 (current) | True process-level isolation. Worker crash ≠ server crash. |
| Single-threaded plugin execution | Dual-mode: inline (trusted) + worker (untrusted) | Phase 5 (current) | Trusted plugins run without RPC overhead; untrusted plugins get full isolation. |
| Direct service access (same memory) | Proxy-based RPC across Worker boundary | Phase 5 (current) | Transparent to plugin developer (`ctx.services.commandBus.execute(cmd)` looks the same). |
| Manual `plugin-runtime/index.ts` cleanup | `ResourceTracker` + forced Worker terminate | Phase 5 (current) | `worker.terminate()` guarantees resource cleanup even if plugin code hangs. |
| Ad-hoc event subscription in same process | Event forwarding via message protocol | Phase 5 (current) | Worker subscribes → main thread forwards → Worker dispatches. No direct EventBus access from Worker. |

**Deprecated/outdated:**
- `vm.createContext` sandbox (Phase 8 removal): Worker Thread isolation is strictly more secure. The vm sandbox was security theater that could be escaped via prototype chain attacks.
- Direct service access for third-party plugins: All third-party plugins must go through the ServiceProxy RPC layer. Only built-in plugins retain direct access (inline mode).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ServiceRegistry.resolveByName(tokenString)` can be added to resolve services by string token name (not just by Token<T> object) | ServiceHost Architecture | MEDIUM -- currently `resolve()` takes a `Token<T>` object. Workers send token names as strings. Need `resolveByName(name: string)` method added to ServiceRegistry. |
| A2 | The structured clone algorithm's handling of `PlatformEvent` and `PlatformCommand` objects is sufficient for event forwarding | Event Forwarding | LOW -- both interfaces contain only primitive/plain object fields (id, type, source, payload, timestamp). No functions, Symbols, or class instances. |
| A3 | `worker_threads` data URL ESM loading works identically to main thread data URL import() | Worker Bootstrap | LOW -- verified in Node.js v24 docs: "data is interpreted based on the MIME type via the ECMAScript module loader." Same behavior as Phase 3. |
| A4 | CapabilityGuard `check()` can be called synchronously during invoke handling (currently sync in CapabilityGuard but wrapped as async in ICapabilityService) | ServiceHost Architecture | LOW -- ServiceHost resolves ICapabilityService via ServiceRegistry which returns the async wrapper. The check call itself is sync but the interface says async. `await capService.check()` works. |
| A5 | Worker's `parentPort.on('message', handler)` can be the sole message channel for all RPC + event forwarding | Transport Architecture | MEDIUM -- Using a single message channel multiplexes invoke responses, subscription events, and lifecycle messages. Need a message type discriminator (`msg.type`) to route correctly. The protocol design handles this. |

## Open Questions

1. **ServiceRegistry.resolveByName() -- do we add this or change ServiceHost?**
   - What we know: Worker sends token as string (`'@openlearn/core:ICommandBusService'`). `ServiceRegistry.resolve()` takes `Token<T>`, not string. The current registry internally maps token.name → entry, where token.name is `'@openlearn/core:ICommandBusService'`.
   - What's unclear: Should we add `resolveByName(name: string)` to ServiceRegistry, or should ServiceHost maintain its own Map<tokenName, resolved service>?
   - Recommendation: Add `resolveByName(name: string)` to ServiceRegistry (it's a trivial lookup: `this.registry.get(name)?.instance`). This avoids duplicating the registry and keeps ServiceHost stateless regarding service resolution.

2. **How to handle synchronous service methods that are wrapped as async in IService interface?**
   - What we know: All IService methods return `Promise<T>` (D-10 from Phase 2). But some underlying implementations (CapabilityGuard.check, StorageService.get) are actually synchronous.
   - What's unclear: Does the async wrapper affect RPC? The RPC protocol is inherently async anyway (postMessage roundtrip), so the async return type is correct for the Worker side.
   - Recommendation: No special handling needed. The Worker-side Proxy always returns a Promise (it must wait for the roundtrip). The async IService signatures are exactly right for RPC mode.

3. **Plugin execution_mode detection -- how does PluginHost know which mode to use?**
   - What we know: New `execution_mode` column in `plugins` table. But what determines the initial value? User choice? Automatic detection?
   - What's unclear: The criteria for assigning `'worker'` vs `'inline'` mode.
   - Recommendation: Initially ALL plugins default to `'inline'` (backward compatible). The mode is set at install time: `installPlugin(sourceCode, { mode: 'worker' })`. The plugin center UI can add a toggle later. Built-in plugins (loaded via restoreActivePlugins) always use `'inline'` mode. This follows the progressive migration constraint.

4. **Should the worker bootstrap code be a separate file or inline data URL?**
   - What we know: Node.js `Worker` can take a filename or data URL. The bootstrap code is ~50 lines of setup logic.
   - What's unclear: Separate file means file system dependency; inline data URL means escaping/encoding management.
   - Recommendation: Inline data URL, generated in `WorkerManager.createWorker()`. The bootstrap code is small (~50 lines) and tightly coupled to the ServiceProxy protocol. A separate file would need dynamic code generation anyway to pass pluginId, token list, etc.

5. **Browser Web Worker -- implement now or stub for Phase 9?**
   - What we know: The abstract `IWorkerTransport` interface can be shared. Browser Web Worker uses the same `postMessage` + structured clone API. But the bootstrap and environment differ (no `require('worker_threads')`, uses `self` instead of `parentPort`).
   - What's unclear: Whether Phase 5 should include the browser transport implementation or just the abstract interface + Node implementation.
   - Recommendation: Implement the abstract `IWorkerTransport` interface + `NodeWorkerTransport` in Phase 5. Create a stub `BrowserWorkerTransport` that throws `NotImplementedError`. The actual browser implementation is in Phase 9 (frontend integration). This keeps Phase 5 focused and testable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `worker_threads` | Worker creation | Yes (built-in) | v24.1.0 | -- |
| Node.js `import()` | ESM loading in Worker | Yes (built-in) | v24.1.0 | -- |
| JavaScript `Proxy` | ServiceProxy implementation | Yes (ES6) | V8 | -- |
| `structuredClone` | RPC message serialization | Yes (built-in) | v24.1.0 | `postMessage` built-in structured clone |
| `crypto.randomUUID()` | invokeId generation | Yes (built-in) | v24.1.0 | `uuid.v7()` from dependencies |
| UUID v7 | invokeId generation | Yes (dependencies) | 14.0 | `crypto.randomUUID()` |
| ServiceRegistry | Service resolution on main thread | Yes (Phase 1) | -- | -- |

**Missing dependencies with no fallback:** None
**Missing dependencies with fallback:** None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | `vitest.config.ts` (needs update to include worker-runtime tests) |
| Quick run command | `npx vitest run packages/core/worker-runtime/__tests__/` |
| Full suite command | `npm test` (vitest run) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLUG-03-SC1 | Worker 隔离执行，崩溃不影响主线程和其他插件 | integration | `npx vitest run packages/core/worker-runtime/__tests__/integration.test.ts` | No -- Wave 0 |
| PLUG-03-SC2 | Proxy-based 透明 RPC 调用主线程服务 | unit | `npx vitest run packages/core/worker-runtime/__tests__/service-proxy.test.ts` | No -- Wave 0 |
| PLUG-03-SC3 | 事件订阅跨 Worker 边界自动转发 | unit | `npx vitest run packages/core/worker-runtime/__tests__/event-forwarder.test.ts` | No -- Wave 0 |
| PLUG-03-SC4 | CapabilityGuard 在 RPC 消息路径中执行检查 | unit | `npx vitest run packages/core/worker-runtime/__tests__/service-host.test.ts` | No -- Wave 0 |
| PLUG-03-SC5 | Worker 生命周期与插件生命周期绑定 | unit | `npx vitest run packages/core/worker-runtime/__tests__/worker-manager.test.ts` | No -- Wave 0 |

### Wave 0 Gaps
- [ ] `packages/core/worker-runtime/__tests__/service-proxy.test.ts` -- covers SC-2 (Proxy traps, invoke serialization, response matching, error propagation)
- [ ] `packages/core/worker-runtime/__tests__/service-host.test.ts` -- covers SC-4 (invoke handling, CapabilityGuard check, error serialization, ServiceRegistry resolution)
- [ ] `packages/core/worker-runtime/__tests__/worker-manager.test.ts` -- covers SC-5 (create/terminate/registry/leak detection/crash recovery)
- [ ] `packages/core/worker-runtime/__tests__/event-forwarder.test.ts` -- covers SC-3 (subscribe/unsubscribe/forward/cleanup)
- [ ] `packages/core/worker-runtime/__tests__/integration.test.ts` -- covers SC-1 (full lifecycle: create Worker → activate plugin → invoke RPC → deactivate → crash isolation)
- [ ] `vitest.config.ts` update -- add `packages/core/worker-runtime/__tests__/**/*.test.ts` to include patterns

### Sampling Rate
- **Per task commit:** `npx vitest run packages/core/worker-runtime/__tests__/` (quick, focused on Worker runtime)
- **Per wave merge:** `npm test` (full vitest suite, including PluginHost + DI + ESM loader for regression)
- **Phase gate:** Full suite green + `tsc --noEmit` clean before `/gsd:verify-work`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Worker runtime does not handle user authentication |
| V3 Session Management | No | Worker runtime does not manage sessions |
| V4 Access Control | Yes | CapabilityGuard.check() on the main thread BEFORE any proxied service call. Worker cannot bypass -- all RPC goes through ServiceHost. |
| V5 Input Validation | Yes | Structured clone serialization prevents prototype pollution. Message type discriminator validates message format before dispatch. |
| V6 Cryptography | No | No cryptographic operations in Worker runtime |
| V7 Error Handling | Yes | Error serialization must not leak internal paths or sensitive information. Stack traces are sent to Worker but capped in length. |
| V8 Malicious Code | Yes | Worker Thread is isolated V8 instance -- code cannot access main thread memory, file system, or Node.js APIs not explicitly passed via postMessage. |
| V9 Resource Allocation | Yes | Worker resource limits (`resourceLimits` option: `maxOldGenerationSizeMb`, `stackSizeMb`). WorkerRegistry prevents unbounded Worker creation. |

### Known Threat Patterns for Worker Isolation

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Worker sends crafted invoke messages to bypass capabilities | Elevation of Privilege | ServiceHost checks `capabilityGuard.check(actorId, requiredCap)` for EVERY invoke. The actorId is fixed at Worker creation from manifest. |
| Worker exhausts memory via infinite loop | Denial of Service | Worker `resourceLimits` option caps heap size. `worker.terminate()` in deactivate kills the process. WorkerRegistry enforces max active Workers. |
| Worker modifies shared state via prototype pollution | Tampering | Structured clone creates deep copies of all passed values. No shared references across boundary. Worker cannot mutate main thread objects. |
| Worker leaks sensitive data via event subscriptions | Information Disclosure | EventForwarder only forwards events the Worker explicitly subscribed to. No broadcast of all system events. CapabilityGuard on service methods prevents unauthorized data access. |
| Worker fails to deactivate (hangs) | Denial of Service | Deactivate timeout (3s default) forces `worker.terminate()`. `worker.on('exit')` ensures cleanup even if terminate is delayed. |
| Multiple Workers exhausting system thread limit | Resource Exhaustion | WorkerRegistry tracks active count. Node.js default max Workers is ~128 per process. WorkerRegistry can inject a configurable limit (e.g., 32) with clear error message. |

## Sources

### Primary (HIGH confidence)
- `packages/core/plugin-host/index.ts` (662 lines) -- Phase 4 PluginHost full implementation. Direct code review.
- `packages/core/command-bus/index.ts` (83 lines) -- CommandBus API (execute, registerHandler). Direct code review.
- `packages/core/event-bus/index.ts` (38 lines) -- EventBus API (subscribe, unsubscribe, publish). Direct code review.
- `packages/core/capability-system/index.ts` (52 lines) -- CapabilityGuard API (grant, check, revokeAll). Direct code review.
- `packages/core/di/service-registry.ts` (295 lines) -- ServiceRegistry full API. Direct code review.
- `packages/core/di/interfaces.ts` (318 lines) -- 7 IService interfaces + Token instances. Direct code review.
- `packages/core/kernel/index.ts` (100 lines) -- Kernel constructor and system initialization. Direct code review.
- `packages/core/esm-loader/node-loader.ts` (83 lines) -- NodeEsmLoader data URL pattern. Direct code review.
- `packages/core/plugin-host/context-builder.ts` (417 lines) -- Phase 4 safe wrapper extraction. Direct code review.
- `packages/core/plugin-host/resource-tracker.ts` (65 lines) -- Disposable resource tracking. Direct code review.
- `packages/core/db/index.ts` (lines 57-64) -- `plugins` table schema. Direct code review.
- `packages/core/esm-loader/errors.ts` (88 lines) -- EsmLoader error hierarchy. Direct code review.
- `.planning/PROJECT.md` -- Project constraints and requirements. Direct code review.
- `.planning/ROADMAP.md` -- Phase 5 success criteria and PLUG-03 mapping. Direct code review.
- `.planning/STATE.md` -- Current project state. Direct code review.
- Node.js v24 worker_threads docs -- Worker constructor, options, eval, data URL, structured clone. Web fetch.
- MDN structured clone algorithm -- What can and cannot be cloned. Web search.
- Node.js v24.1.0 runtime -- `node --version`, `worker_threads` availability. Bash verification.

### Secondary (MEDIUM confidence)
- Comlink (Google Chrome Labs) -- `wrap()`/`expose()` pattern for Proxy-based RPC. Reference pattern for ServiceProxy design. Web search + GitHub README fetch.
- `@cross/workers` (JSR) -- Cross-runtime worker abstraction patterns. Architecture reference. Web search.
- `web-worker` (npm) -- Web Worker polyfill for Node.js. Alternative approach considered. Web search.

### Tertiary (LOW confidence)
- JupyterLab plugin system architecture -- Reference for dual-mode and RPC patterns. Not directly verified against current source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All APIs are built into Node.js v24. No new external dependencies. Proxy, structuredClone, worker_threads are stable, well-documented APIs.
- Architecture: HIGH -- Patterns are directly adapted from production-grade systems (Comlink, Node.js worker_threads docs, existing codebase). The ServiceProxy protocol is a straightforward message-passing design.
- Pitfalls: HIGH -- All identified pitfalls are documented in Node.js docs (structured clone limitations), Comlink documentation (callback proxying), and Node.js Worker lifecycle guides (zombie processes, memory leaks).

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (Phase 5 uses stable Node.js APIs with no active development changes expected for `worker_threads` or `Proxy`)
