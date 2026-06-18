# Phase 5: Worker 隔离 + 双运行时 — Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 17 (8 new + 5 test + 4 modified)
**Analogs found:** 17 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/worker-runtime/types.ts` | types | — | `packages/core/plugin-host/types.ts` | exact |
| `packages/core/worker-runtime/transport.ts` | utility | request-response | `packages/core/esm-loader/esm-loader.ts` (+ node-loader.ts, browser-loader.ts) | role-match |
| `packages/core/worker-runtime/service-proxy.ts` | service | request-response | `packages/core/plugin-host/context-builder.ts` | role-match |
| `packages/core/worker-runtime/service-host.ts` | service | request-response | `packages/core/di/service-registry.ts` | role-match |
| `packages/core/worker-runtime/event-forwarder.ts` | service | event-driven | `packages/core/event-bus/index.ts` | exact data-flow |
| `packages/core/worker-runtime/worker-manager.ts` | service | lifecycle management | `packages/core/plugin-host/index.ts` | exact role |
| `packages/core/worker-runtime/errors.ts` | utility | — | `packages/core/plugin-host/errors.ts` | exact |
| `packages/core/worker-runtime/index.ts` | config (barrel) | — | `packages/core/esm-loader/index.ts` | exact |
| `packages/core/worker-runtime/__tests__/service-proxy.test.ts` | test | unit | `packages/core/plugin-host/__tests__/plugin-host.test.ts` | role-match |
| `packages/core/worker-runtime/__tests__/service-host.test.ts` | test | unit | `packages/core/plugin-host/__tests__/plugin-host.test.ts` | role-match |
| `packages/core/worker-runtime/__tests__/event-forwarder.test.ts` | test | unit | `packages/core/plugin-host/__tests__/plugin-host.test.ts` | role-match |
| `packages/core/worker-runtime/__tests__/worker-manager.test.ts` | test | unit | `packages/core/plugin-host/__tests__/plugin-host.test.ts` | role-match |
| `packages/core/worker-runtime/__tests__/integration.test.ts` | test | integration | `packages/core/plugin-host/__tests__/plugin-host.test.ts` | role-match |
| `packages/core/plugin-host/index.ts` (modified) | service | lifecycle | same file (self-analog) | exact |
| `packages/core/kernel/index.ts` (modified) | config | initialization | same file (self-analog) | exact |
| `packages/core/db/index.ts` (modified) | config | schema | same file (self-analog) | exact |
| `server.ts` (modified) | config | initialization | same file (self-analog) | exact |

## Pattern Assignments

### `packages/core/worker-runtime/types.ts` (types)

**Analog:** `packages/core/plugin-host/types.ts`

**Imports pattern** (lines 10-17):
```typescript
import type { IActionRegistryService } from '../di/interfaces.js';
import type { ICommandBusService } from '../di/interfaces.js';
import type { IEventBusService } from '../di/interfaces.js';
// ... 7 IService interfaces + Manifest
```

**Interface + enum definition pattern** (lines 41-72):
```typescript
export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  // ...
}

export interface PluginContext {
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    // ... 7 services
  };
  pluginId: string;
  manifest: Manifest;
}
```

**Key pattern to copy:** Union type for message protocol (`WorkerMessage | MainThreadMessage`), `IWorkerTransport` interface with `postMessage` + `onMessage` + `terminate` methods. Follow the same interface-before-class ordering as plugin-host/types.ts.

---

### `packages/core/worker-runtime/transport.ts` (utility, request-response)

**Analog:** `packages/core/esm-loader/esm-loader.ts` (+ `node-loader.ts`, `browser-loader.ts`)

**Abstract base class + platform implementations pattern** (esm-loader.ts lines 36-38):
```typescript
export abstract class EsmLoader {
  abstract load(code: string): Promise<PluginModule>;
}
```

**Node.js implementation pattern** (node-loader.ts lines 22-43):
```typescript
export class NodeEsmLoader extends EsmLoader {
  async load(code: string): Promise<PluginModule> {
    const base64 = Buffer.from(code, 'utf-8').toString('base64');
    const dataUrl = `data:text/javascript;base64,${base64}#${++this.loadCounter}`;
    try {
      return await import(dataUrl);
    } catch (err: unknown) {
      throw this.classifyError(err);
    }
  }
}
```

**Browser implementation (stub) pattern** (browser-loader.ts lines 19-42):
```typescript
export class BrowserEsmLoader extends EsmLoader {
  async load(code: string): Promise<PluginModule> {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      return await this.doImport(url);
    } catch (err: unknown) {
      throw this.classifyError(err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
```

**Key pattern to copy:** Same abstract-interface + Node impl + Browser stub pattern. `IWorkerTransport` as an interface (not abstract class since it's simpler), `NodeWorkerTransport` wrapping `worker_threads.Worker`, `BrowserWorkerTransport` as a stub throwing `NotImplementedError`.

---

### `packages/core/worker-runtime/service-proxy.ts` (service, request-response)

**Analog:** `packages/core/plugin-host/context-builder.ts`

**Safe wrapper function pattern** (context-builder.ts lines 70-107):
```typescript
function wrapCommandBus(
  commandBus: ICommandBusService,
  tracker: ResourceTracker,
  pluginId: string,
): ICommandBusService {
  return {
    registerHandler: createSafeFunction((commandType: string, handler: CommandHandler) => {
      const safeHandler: CommandHandler = {
        execute: async (command) => {
          try {
            return await handler.execute(command);
          } catch (e) {
            console.error(`[Plugin:${pluginId}] Error executing command ${commandType}:`, e);
            throw e;
          }
        },
      };
      return commandBus.registerHandler(commandType, safeHandler).then(() => {
        tracker.track(pluginId, {
          dispose: () => {
            commandBus.unregisterHandler(commandType).catch(() => {});
          },
        });
      });
    }),
    // ... other methods proxied through
  } as ICommandBusService;
}
```

**buildContext assembly pattern** (context-builder.ts lines 363-416):
```typescript
export async function buildContext(
  serviceRegistry: ServiceRegistry,
  tracker: ResourceTracker,
  pluginId: string,
  manifest: Manifest,
  db: any,
): Promise<PluginContext> {
  // 1. Resolve all 7 services from DI
  const commandBusService = await serviceRegistry.resolve(ICommandBusServiceToken);
  // ... resolve all 7

  // 2. Wrap each service
  const wrappedCommandBus = wrapCommandBus(commandBusService, tracker, pluginId);
  // ... wrap all 7

  // 3. Freeze prototypes
  Object.setPrototypeOf(wrappedCommandBus, null);

  // 4. Build + freeze services container
  const services = { commandBus: wrappedCommandBus, ... };
  Object.freeze(services);

  return { services, pluginId, manifest };
}
```

**Key pattern to copy:** The Proxy-based RPC uses JavaScript `Proxy` + `Reflect` traps instead of manual wrapper functions. The `createMethodProxy` function returns a `new Proxy({}, { get(target, method) { return (...args) => { /* postMessage + Promise */ } } })`. Use `crypto.randomUUID()` or `uuidv7()` for invokeId generation (see command-bus/index.ts line 73). The pending calls Map pattern matches the service resolution pattern.

---

### `packages/core/worker-runtime/service-host.ts` (service, request-response)

**Analog:** `packages/core/di/service-registry.ts`

**Async resolve pattern** (service-registry.ts lines 105-112):
```typescript
async resolve<T>(token: Token<T>): Promise<T> {
  const name = token.name;
  const entry = this.registry.get(name);
  if (!entry) {
    throw new Error(`No provider registered for token: ${name}`);
  }
  return entry.instance as T;
}
```

**Service entry tracking pattern** (service-registry.ts lines 34-42):
```typescript
private registry = new Map<string, ServiceEntry>();
private depGraph = new Map<string, DepEdge>();
```

**CapabilityGuard integration pattern** (kernel/index.ts lines 50-76):
```typescript
this.commandBus.setInterceptor(async (command) => {
  const action = this.actionRegistry.getActionByCommandType(command.type);
  if (action) {
    if (action.capabilityRequired) {
      const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
      if (!allowed) {
        throw new Error(`[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`);
      }
    }
  }
});
```

**Key pattern to copy:** ServiceHost holds a `Map<invokeId, PendingCall>` for matching responses, resolves services by token string via `serviceRegistry.resolve()`, checks `capabilityGuard.check(actorId, capRequired)` before executing, and serializes errors explicitly (structured clone loses prototype). Follow DI/service-registry.ts method dispatch pattern.

---

### `packages/core/worker-runtime/event-forwarder.ts` (service, event-driven)

**Analog:** `packages/core/event-bus/index.ts`

**Core EventBus subscribe/publish pattern** (event-bus/index.ts lines 15-37):
```typescript
export class EventBus {
  private subscribers = new Map<string, Set<EventSubscriber>>();

  public subscribe(eventType: string, subscriber: EventSubscriber) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(subscriber);
  }

  public unsubscribe(eventType: string, subscriber: EventSubscriber) {
    this.subscribers.get(eventType)?.delete(subscriber);
  }

  public async publish(event: PlatformEvent) {
    const subs = this.subscribers.get(event.type) || new Set();
    const wildcards = this.subscribers.get('*') || new Set();
    const allSubs = [...subs, ...wildcards];
    await Promise.all(allSubs.map(sub => Promise.resolve(sub(event)).catch(err => {
      console.error(`Error in event subscriber for ${event.type}:`, err);
    })));
  }
}
```

**ResourceTracker cleanup pattern** (resource-tracker.ts lines 45-63):
```typescript
disposeAll(pluginId: string): void {
  const list = this.resources.get(pluginId);
  if (!list) { return; }
  for (const disposable of list) {
    try { disposable.dispose(); } catch (e) {
      console.error(`[PluginHost] Error disposing resource for plugin "${pluginId}":`, e);
    }
  }
  this.resources.delete(pluginId);
}
```

**Key pattern to copy:** EventForwarder maintains a Map of Worker subscriptions `Map<subId, Map<eventType, unsubscribe>>`. On subscribe from Worker, subscribe to real EventBus with a forwarding handler. On event trigger, postMessage the serialized event. On Worker terminate, disposeAll subscriptions. Worker-side EventBusProxy tracks local handlers in `Map<string, Array<(event) => void>>` and dispatches forwarded events.

---

### `packages/core/worker-runtime/worker-manager.ts` (service, lifecycle management)

**Analog:** `packages/core/plugin-host/index.ts`

**Lifecycle state management pattern** (plugin-host/index.ts lines 86-93):
```typescript
private pluginStates = new Map<string, PluginState>();
private resourceTracker = new ResourceTracker();
private pluginInstances = new Map<string, { manifest: Manifest; activate: ...; deactivate?: ... }>();
```

**Activation with timeout + rollback pattern** (plugin-host/index.ts lines 299-411):
```typescript
async activatePlugin(pluginId: string): Promise<void> {
  const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
  this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);
  this.pluginStates.set(pluginId, PluginState.ACTIVATING);

  const row = this.db.prepare('SELECT source_code, manifest FROM plugins WHERE id = ?')
    .get(pluginId) as ...;

  try {
    // ... activation logic ...
    await Promise.race([
      activate(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new EsmLoadTimeoutError(ACTIVATION_TIMEOUT_MS)), ACTIVATION_TIMEOUT_MS)),
    ]);
    this.pluginStates.set(pluginId, PluginState.ACTIVE);
  } catch (err) {
    // Rollback
    this.pluginStates.set(pluginId, PluginState.ERROR);
    this.resourceTracker.disposeAll(pluginId);
    throw err;
  }
}
```

**Deactivation with forced cleanup in finally block pattern** (plugin-host/index.ts lines 435-504):
```typescript
async deactivatePlugin(pluginId: string): Promise<void> {
  try {
    if (instance?.deactivate) {
      try {
        await Promise.race([
          instance.deactivate(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new PluginDeactivateTimeoutError(...)), TIMEOUT_MS)),
        ]);
      } catch (deactivateErr) {
        console.error(`[PluginHost] ... continuing forced cleanup:`, deactivateErr);
      }
    }
  } finally {
    this.resourceTracker.disposeAll(pluginId);
    this.pluginStates.set(pluginId, PluginState.INACTIVE);
    // revoke capabilities
  }
}
```

**Worker crash detection pattern** (proposed, based on worker_threads `exit` event):
```typescript
instance.worker.on('exit', (code) => {
  if (code !== 0 && this.workers.has(pluginId)) {
    this.workers.get(pluginId)!.status = 'crashed';
    this.cleanup(pluginId);
  }
});
```

**Key pattern to copy:** WorkerRegistry uses `Map<pluginId, WorkerInstance>` + `Map<threadId, pluginId>`. Lifecycle: createWorker → validate state → spawn Worker → setup ServiceHost/EventForwarder → send activate message → await 'activated' response → mark active. `finally` block guarantees cleanup. Timeout protection on deactivate similar to PluginHost.

---

### `packages/core/worker-runtime/errors.ts` (utility)

**Analog:** `packages/core/plugin-host/errors.ts`

**Exact pattern to copy** (plugin-host/errors.ts lines 19-76):
```typescript
export class PluginHostError extends Error {
  constructor(message: string) {
    super(`[PluginHost] ${message}`);
    this.name = 'PluginHostError';
  }
}

export class PluginActivateError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Plugin "${pluginId}" activation failed: ${message}`);
    this.name = 'PluginActivateError';
    if (options?.cause) { this.cause = options.cause; }
  }
}
```

**Key pattern:** 1) extends Error (or parent class), 2) constructor super with `[WorkerRuntime]` prefix, 3) `this.name = 'ErrorClassName'`, 4) `public readonly` contextual properties. See also `packages/core/esm-loader/errors.ts` for same pattern with `{ cause?: Error }` options parameter.

**Required error classes:**
- `WorkerRuntimeError` — base class
- `WorkerTransportError` — transport failure
- `WorkerActivateError` — activation failed inside Worker
- `WorkerTimeoutError` — RPC timeout
- `WorkerCapabilityError` — capability check denied
- `WorkerNotSupportedError` — browser transport stub

---

### `packages/core/worker-runtime/index.ts` (config, barrel)

**Analog:** `packages/core/esm-loader/index.ts`

**Exact pattern to copy** (esm-loader/index.ts lines 13-25):
```typescript
export { EsmLoader } from './esm-loader.js';
export type { PluginModule } from './esm-loader.js';
export { NodeEsmLoader } from './node-loader.js';
export { BrowserEsmLoader } from './browser-loader.js';
export { manifestSchema } from './manifest-schema.js';
export type { Manifest } from './manifest-schema.js';
export {
  EsmLoaderError,
  EsmSyntaxError,
  EsmModuleNotFoundError,
  EsmLoadTimeoutError,
  EsmActivationError,
} from './errors.js';
```

**Key pattern:** Named exports for classes/functions (not `export * from`). Type exports use `export type`. Error classes grouped together. Consistent ordering: core class → types → platform implementations → errors.

---

### Test files (`__tests__/*.test.ts`)

**Analog:** `packages/core/plugin-host/__tests__/plugin-host.test.ts`

**Test setup pattern** (plugin-host.test.ts lines 11-30, 39-62, 148-191):
```typescript
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
// ... other imports

/** 创建内存 SQLite 数据库并初始化插件相关表 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS plugins (...);`);
  return db;
}

/** 创建最小化的 mock service（返回 undefined 的 vi.fn） */
function createMockServices(): Record<string, unknown> {
  return {
    commandBus: {
      execute: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      // ... all methods mocked
    } as ICommandBusService,
    // ... all 7 services
  };
}

describe('PluginHost — 完整生命周期', () => {
  let db: Database.Database;
  let host: PluginHost;

  beforeEach(async () => {
    db = createTestDb();
    // ... setup
  });

  afterEach(() => { db.close(); });

  it('installPlugin 成功 — 插件安装后 DB 和状态均正确', async () => {
    // test body
  });
});
```

**Key pattern to copy:** For `worker-manager.test.ts`: use real `worker_threads.Worker` with inline data URL code (or mock Worker using EventEmitter). For `service-proxy.test.ts`: create a mock `IWorkerTransport` using `EventEmitter` pattern (pair of emitters simulating message channel). For `service-host.test.ts`: mock `ServiceRegistry` and `CapabilityGuard`. For `integration.test.ts`: use inline Worker code that exports a minimal plugin and verify full lifecycle.

---

### `packages/core/plugin-host/index.ts` (modified — dual-mode extension)

**Self-analog pattern for extension** (lines 299-411, existing `activatePlugin`):

Add execution_mode detection and worker-mode branch:

```typescript
// After line 348, before capability grant (insert mode check):
async activatePlugin(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void> {
  const mode = options?.mode ?? this.getPluginExecutionMode(pluginId) ?? 'inline';
  // ...
}
```

The `getPluginExecutionMode()` reads from DB column:
```typescript
private getPluginExecutionMode(pluginId: string): 'inline' | 'worker' | null {
  const row = this.db.prepare('SELECT execution_mode FROM plugins WHERE id = ?')
    .get(pluginId) as { execution_mode: string } | undefined;
  if (!row) return null;
  return row.execution_mode as 'inline' | 'worker';
}
```

Follow the existing `validateTransition` → `setState` → `load from DB` → `execute` → `rollback on error` pattern already established at lines 299-411.

---

### `packages/core/kernel/index.ts` (modified — WorkerManager integration)

**Self-analog pattern** (kernel/index.ts lines 1-48):

Add WorkerManager as a new subsystem, following the same Layer-construction pattern:

```typescript
import { WorkerManager } from '../worker-runtime/index.js';

export class Kernel {
  public readonly workerManager: WorkerManager;

  constructor() {
    // After line 44 (pluginHost), add:
    // WorkerManager — depends on PluginHost + ServiceRegistry
    this.workerManager = new WorkerManager(this.serviceRegistry, this.capabilityGuard, this.db);
  }
}
```

Follow the exact layering pattern: Layer 0 (EventBus, CapabilityGuard, ServiceRegistry) → Layer 1 (CommandBus, ActionRegistry) → Layer 2 (ProcessManager, EsmLoader, PluginHost) → Layer 3 (WorkerManager, PluginRuntime).

---

### `packages/core/db/index.ts` (modified — execution_mode column)

**Self-analog pattern** (db/index.ts lines 57-64, existing plugins table):

After the existing `CREATE TABLE IF NOT EXISTS plugins (...)` block, add ALTER TABLE:

```typescript
// In the schema initialization section, after the plugins table:
try {
  db.exec(`ALTER TABLE plugins ADD COLUMN execution_mode TEXT DEFAULT 'inline'`);
} catch {
  // Column already exists — ignore error
}
```

This follows the existing "additive schema evolution" convention used throughout the codebase (no migration framework). See lines 398-406 in server.ts for the same `CREATE TABLE IF NOT EXISTS` pattern.

---

### `server.ts` (modified — bootstrap integration)

**Self-analog pattern** (server.ts lines 381-412, 412-472 existing startup):

In `startServer()`, after `kernelContainer.pluginRuntime.loadFromDB()`:

```typescript
// After line 412 (loadFromDB), add:
// Start WorkerManager — restore any worker-mode plugins
await kernelContainer.workerManager.restoreWorkers();
```

Also update the startup section lines 55-60 to add WorkerManager initialization if needed.

---

## Shared Patterns

### Error Hierarchy
**Source:** `packages/core/plugin-host/errors.ts` (lines 19-76)
**Apply to:** `packages/core/worker-runtime/errors.ts`
```typescript
// Pattern: Base class → context-specific subclasses
export class WorkerRuntimeError extends Error {
  constructor(message: string) {
    super(`[WorkerRuntime] ${message}`);
    this.name = 'WorkerRuntimeError';
  }
}
export class WorkerActivateError extends WorkerRuntimeError {
  constructor(public readonly pluginId: string, message: string, options?: { cause?: Error }) {
    super(`Plugin "${pluginId}" activation failed in Worker: ${message}`);
    this.name = 'WorkerActivateError';
    if (options?.cause) this.cause = options.cause;
  }
}
```

### Barrel Export
**Source:** `packages/core/esm-loader/index.ts` (lines 13-25)
**Apply to:** `packages/core/worker-runtime/index.ts`
```typescript
// Pattern: named exports for classes, `export type` for interfaces, errors grouped
export { ServiceProxy, createServicesProxy } from './service-proxy.js';
export { ServiceHost } from './service-host.js';
export { EventForwarder } from './event-forwarder.js';
export { WorkerManager, WorkerRegistry } from './worker-manager.js';
export { NodeWorkerTransport } from './transport.js';
export type { IWorkerTransport, WorkerMessage, MainThreadMessage } from './types.js';
export { WorkerRuntimeError, WorkerActivateError } from './errors.js';
```

### Abstract Base + Platform Implementations
**Source:** `packages/core/esm-loader/esm-loader.ts` + `node-loader.ts` + `browser-loader.ts`
**Apply to:** `packages/core/worker-runtime/transport.ts` (IWorkerTransport interface + NodeWorkerTransport + BrowserWorkerTransport stub)
```typescript
// Pattern: common interface, two platform impls, Node.js first, Browser stub
export interface IWorkerTransport {
  postMessage(msg: unknown): void;
  onMessage(handler: (msg: any) => void): void;
  terminate(): Promise<void>;
  readonly id: string;
}

export class NodeWorkerTransport implements IWorkerTransport { /* ... */ }
export class BrowserWorkerTransport implements IWorkerTransport {
  postMessage(): void { throw new Error('[WorkerRuntime] Not implemented in browser yet'); }
  onMessage(): void { throw notImplemented; }
  terminate(): Promise<void> { return Promise.resolve(); }
}
```

### CapabilityGuard Check Before Service Execution
**Source:** `packages/core/kernel/index.ts` (lines 50-56)
**Apply to:** `packages/core/worker-runtime/service-host.ts` (check before every proxied invoke)
```typescript
// Pattern: fixed actorId from manifest, check before ANY service method execution
const allowed = this.capabilityGuard.check(this.pluginActorId, requiredCap);
if (!allowed) {
  transport.postMessage({
    type: 'error',
    invokeId: msg.invokeId,
    message: `Capability denied: ${this.pluginActorId} missing ${requiredCap}`,
    code: 'CapabilityError',
  });
  return;
}
```

### Async Interfaces for Cross-Runtime Compatibility
**Source:** `packages/core/di/interfaces.ts` (all 7 service interfaces return `Promise<T>`)
**Apply to:** All RPC call signatures in service-proxy.ts and service-host.ts
```typescript
// Pattern: all methods already return Promise — matches Worker RPC async nature
interface ICommandBusService {
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;
  registerHandler(commandType: string, handler: CommandHandler): Promise<void>;
  // ...
}
```
The Worker-side Proxy returns `Promise` (must wait for roundtrip), so existing async IService signatures are exactly right for RPC mode.

### Forced Cleanup in finally Block
**Source:** `packages/core/plugin-host/index.ts` (lines 477-504)
**Apply to:** `packages/core/worker-runtime/worker-manager.ts` (Worker termination + registry cleanup)
```typescript
// Pattern: Worker termination in finally, independent of deactivate handler result
try {
  await Promise.race([gracefulDeactivate, timeout]);
} catch { /* force terminate */ } finally {
  await instance.worker.terminate();
  this.cleanup(pluginId);
}
```

### Resource Tracking + Disposal
**Source:** `packages/core/plugin-host/resource-tracker.ts` (lines 14-63)
**Apply to:** `packages/core/worker-runtime/worker-manager.ts` (WorkerRegistry cleanup)
```typescript
// Pattern: per-pluginId disposables, disposal in order, each wrapped in try/catch
private resources = new Map<string, Disposable[]>();
track(pluginId: string, disposable: Disposable): void { /* ... */ }
disposeAll(pluginId: string): void {
  const list = this.resources.get(pluginId);
  if (!list) return;
  for (const d of list) { try { d.dispose(); } catch (e) { console.error(e); } }
  this.resources.delete(pluginId);
}
```

### Test Setup with In-Memory SQLite + vi.fn Mocks
**Source:** `packages/core/plugin-host/__tests__/plugin-host.test.ts` (lines 11-30, 148-191)
**Apply to:** All `__tests__/*.test.ts` files
```typescript
// Pattern: Database(':memory:'), vi.fn().mockResolvedValue() for mocks, beforeEach/afterEach
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createMockTransport(): IWorkerTransport {
  // EventEmitter-based mock for bidirectional message testing
  const mainToWorker = new EventEmitter();
  const workerToMain = new EventEmitter();
  return {
    postMessage: (msg) => workerToMain.emit('message', msg),
    onMessage: (handler) => mainToWorker.on('message', handler),
    terminate: vi.fn().mockResolvedValue(undefined),
    id: 'test-transport',
  };
}
```

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All files have analogs in existing Phase 4 architecture |

All new files have direct structural analogs in existing subsystems. The JavaScript `Proxy`-based RPC mechanism is the only genuinely new technique, but its pattern is well-documented in RESEARCH.md lines 218-317 and the context-builder.ts wrapping pattern demonstrates the same functional interception approach.

## Metadata

**Analog search scope:** `packages/core/` (all subsystems: kernel, command-bus, event-bus, capability-system, plugin-runtime, plugin-host, di, esm-loader, process-manager, registry, db) + `server.ts`
**Files scanned:** 28 TypeScript source files + 5 test files
**Pattern extraction date:** 2026-06-18
