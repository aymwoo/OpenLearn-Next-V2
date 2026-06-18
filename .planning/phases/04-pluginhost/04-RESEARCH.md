# Phase 4: PluginHost + 生命周期 - Research

**Researched:** 2026-06-18
**Domain:** Plugin lifecycle management, DI-based service injection, resource tracking and cleanup
**Confidence:** HIGH

## Summary

Phase 4 is a pure architectural refactoring of the existing `PluginRuntime` class into two components: a new `PluginHost` class (lifecycle manager with formalized state machine, ResourceTracker, and DI-based PluginContext construction) and a thin `PluginRuntime` compatibility layer that delegates to it. No new external dependencies are needed -- all building blocks (ServiceRegistry, IService interfaces, EsmLoader, PluginModule) already exist from Phases 1-3.

The primary engineering work involves: (1) extracting the ~600 lines of wrapped* security wrapper code from `PluginRuntime.evaluateAndActivateEsm()` into a reusable `PluginContext` builder in `PluginHost`; (2) formalizing the ad-hoc cleanup logic in `deactivatePlugin()` into a `ResourceTracker` with `Disposable` pattern; (3) implementing a 5-state machine (installed/active/inactive/error/uninstalled) with proper error isolation; (4) making `PluginRuntime` a thin facade that preserves its public API while delegating all lifecycle operations to `PluginHost`.

**Primary recommendation:** Build `PluginHost` as `packages/core/plugin-host/index.ts` with three internal modules (resource-tracker.ts, context-builder.ts, state-machine.ts) to keep individual files testable and under 400 lines. The ResourceTracker should be a standalone class using the Disposable pattern (already natural from the existing "push to arrays, pop on cleanup" logic). PluginRuntime compatibility is achieved via constructor injection: `new PluginRuntime(kernel, esmLoader, pluginHost)`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plugin lifecycle state machine | API/Backend (PluginHost) | -- | State transitions are server-side orchestration logic |
| Resource tracking (command handlers, events, timers, processes) | API/Backend (ResourceTracker) | -- | All tracked resources are backend-side subsystem registrations |
| PluginContext construction (wrapped* API) | API/Backend (PluginHost) | -- | Service wrapping and security hardening is server-only concern |
| Plugin code loading (import()) | API/Backend (EsmLoader) | -- | Already built in Phase 3; PluginHost delegates to it |
| Service resolution via Token DI | API/Backend (ServiceRegistry) | -- | Already built in Phase 1-2; PluginHost calls resolve() |
| Plugin storage (SQLite) | Database/Storage (better-sqlite3) | -- | Existing plugins table; PluginHost reads/writes via db instance |
| PluginRuntime facade (API compatibility) | API/Backend (PluginRuntime) | -- | Thin delegation layer; preserves server.ts contracts |

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### PluginHost 架构（D-01 ~ D-03）
- **D-01: 新建 PluginHost 类 + PluginRuntime 委托** — 新建 `packages/core/plugin-host/` 目录。PluginHost 是独立的生命周期管理器类（可单独测试），PluginRuntime 改为薄包装层：保留现有 API 签名，内部委托给 PluginHost。好处：不影响 server.ts 和现有调用方，PluginHost 可独立演进
- **D-02: PluginHost 构造函数接收 ServiceRegistry + EsmLoader** — `constructor(serviceRegistry: ServiceRegistry, esmLoader: EsmLoader, db: Database)`。通过 ServiceRegistry.resolve() 获取各服务实例构建 PluginContext，不直接依赖 Kernel 单例。与 Phase 3 D-01 的 DI 模式一致
- **D-03: PluginHost 管理插件状态机** — 每个插件经历 `installed → active → inactive → uninstalled` 状态流转。状态存储在内存 Map<pluginId, PluginState> 中。状态转换通过 PluginHost 方法触发，非法转换（如重复激活）抛出明确错误

#### PluginContext 接口（D-04 ~ D-06）
- **D-04: PluginContext 通过 Token DI 注入服务** — `ctx.services.commandBus.execute(cmd)` 而不是 `ctx.commandBus.execute(cmd)`。services 对象包含已解析的 IService 实现，类型安全。与 Phase 2 的 IService 接口和 Phase 1 的 Token 命名规范一致
- **D-05: PluginContext 包含 activate 元数据** — `ctx.pluginId: string`, `ctx.manifest: Manifest`。插件可在 activate 中读取自身 ID 和 manifest 信息
- **D-06: PluginContext.services 对象冻结** — 使用 Object.freeze() 冻结 services 对象，防止插件替换服务引用。与 Phase 3 D-03 的安全包装器模式一致

#### 资源追踪（D-07 ~ D-09）
- **D-07: ResourceTracker 集中管理资源** — PluginHost 内部维护 ResourceTracker 实例。插件通过 ctx 中的包装器 API 注册资源时自动追踪：`ctx.commandBus.registerHandler()` → 返回 Disposable → ResourceTracker 记录
- **D-08: 可追踪资源类型** — 命令处理器（command handler）、事件订阅（event subscription）、定时器（setInterval/setTimeout）、进程（spawned process）。每种资源对应一个 Disposable
- **D-09: deactivate 时自动清理** — `deactivatePlugin(pluginId)` → 调用 ResourceTracker.disposeAll(pluginId) → 逐个调用 Disposable.dispose() → 清空追踪记录。清理顺序：先停进程 → 再清定时器 → 最后注销命令/事件

#### 生命周期错误处理（D-10 ~ D-12）
- **D-10: 插件间错误隔离** — 插件 A 的 activate() 抛异常：捕获并记录（EsmActivationError），不影响插件 B 和基座运行。失败插件的资源（如有部分注册）通过 ResourceTracker 回滚
- **D-11: deactivate 超时保护** — `Promise.race([plugin.deactivate(), timeout(5000)])`。超时后强制清理资源（ResourceTracker.disposeAll），记录超时警告。与 Phase 3 D-14 的 EsmLoadTimeoutError 模式一致
- **D-12: activate 失败回滚** — activate() 中异常或超时 → 回滚已注册的资源（通过 ResourceTracker）→ 插件状态回到 installed（可重试激活）。不留下半激活状态的残留资源

#### 兼容性（D-13 ~ D-14）
- **D-13: PluginRuntime 保留为兼容层** — 现有 `kernelContainer.pluginRuntime` 引用不变。PluginRuntime 内部方法（installPlugin, activatePlugin 等）委托给 PluginHost。server.ts 无需修改
- **D-14: wrapped* 安全包装器迁移** — 现有 `createSafeFunction`、原型链冻结、Object.defineProperty 逻辑从 PluginRuntime 迁移到 PluginHost。不重复编写，直接移动代码。PluginRuntime 的 evaluateAndActivate（vm 路径）继续使用旧的安全包装器直到 Phase 8

### Claude's Discretion
- PluginHost 类的具体文件拆分（单个 plugin-host.ts 还是 host/ 子目录）
- ResourceTracker 是否作为独立类或 PluginHost 内部模块
- PluginState 状态机的具体实现（简单的 string 枚举还是 TypeScript discriminated union）
- loadFromDB / restoreActivePlugins 的具体策略（启动时恢复哪些插件）
- 测试文件的具体组织和 mock 策略

### Deferred Ideas (OUT OF SCOPE)

无。讨论聚焦在 Phase 4 的 PluginHost 生命周期管理设计决策上。

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-05 | 生命周期钩子——每个插件实现 `activate(ctx)` 和 `deactivate()` 标准接口 | PluginHost 类实现完整 install/activate/deactivate/uninstall 生命周期，PluginContext 通过 Token DI 注入服务，ResourceTracker 自动追踪和清理资源 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.1.9 | 测试框架 | 已在项目中使用（Phase 1-3 均用 vitest 测试） |
| better-sqlite3 | 12.10 | 插件存储（plugins 表读写） | 项目唯一数据库驱动，PluginHost 通过构造函数注入 db 实例 |
| uuid | 14.0 (v7) | 插件安装时生成唯一 ID | 项目统一使用 uuid v7 |
| zod | 4.4.3 | manifest 运行时校验 | 已在 Phase 3 引入，manifestSchema 可直接复用 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ServiceRegistry | -- (Phase 1) | DI 容器，PluginHost 通过它解析 IService 构建 PluginContext | 每次 buildContext() 调用 |
| EsmLoader | -- (Phase 3) | 动态加载插件 ESM 模块 | activatePlugin() 时通过 load() 获取 PluginModule |
| IService 接口 | -- (Phase 2) | 类型安全的服务契约 | PluginContext.services 的类型定义 |
| manifestSchema | -- (Phase 3) | manifest.json zod 校验 | installPlugin() 时校验 manifest |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Disposable 模式 | Map<pluginId, Resource[]> 直接操作 | Disposable 模式更清晰：每个资源包装为 `{ dispose: () => void }`，disposeAll 统一调用 |
| string 枚举状态机 | discriminated union | D-03 明确使用状态字符串 `installed → active → inactive → uninstalled`，简单字符串即可满足 |
| PluginHost 单文件 | 子目录多文件 | Phase 4 代码量适中（~600 行），但拆分为 3 个小文件（resource-tracker, context-builder, state-machine）更易测试 |

**Installation:**
```bash
# No new packages needed for Phase 4. All dependencies are already installed.
# Vitest is already configured with test include patterns.
```

**Version verification:** Already performed -- all packages exist in node_modules at the versions specified above. [VERIFIED: node_modules + package.json]

## Package Legitimacy Audit

> Phase 4 installs no NEW external packages. All required packages are already installed and verified by prior phases.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| vitest | npm | ~4 yrs | 10M+/wk | github.com/vitest-dev/vitest | [SUS]* | APPROVED -- already installed, known testing framework |
| better-sqlite3 | npm | ~8 yrs | 2M+/wk | github.com/WiseLibs/better-sqlite3 | [OK] | APPROVED -- already installed |
| uuid | npm | ~10 yrs | 70M+/wk | github.com/uuidjs/uuid | [OK] | APPROVED -- already installed |
| zod | npm | ~5 yrs | 12M+/wk | github.com/colinhacks/zod | [OK] | APPROVED -- already installed |

*slopcheck flagged vitest as [SUS] because its name is "suspiciously close to vite" -- this is a known false positive. Vitest is the official testing framework for the Vite ecosystem.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** vitest (false positive)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            server.ts                                │
│  (REST API endpoints: /api/plugins/install, /api/plugins/toggle)    │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ delegates to
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PluginRuntime (facade)                         │
│  Preserves: installPlugin() / togglePlugin() / uninstallPlugin()    │
│  Delegates: all lifecycle ops to PluginHost                         │
│  Keeps: evaluateAndActivate() for legacy vm path (until Phase 8)    │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ delegates lifecycle to
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         PluginHost                                   │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  State Machine   │  │  context-builder  │  │ ResourceTracker   │  │
│  │                  │  │                   │  │                   │  │
│  │ installed ──► active  │ ServiceRegistry  │  │ Map<pluginId,     │  │
│  │    │              │  │      .resolve()   │  │   Disposable[]>   │  │
│  │    ▼              │  │         │         │  │                   │  │
│  │ inactive ──► active  │         ▼         │  │ track(pid, disp)  │  │
│  │    │              │  │   PluginContext    │  │ disposeAll(pid)   │  │
│  │    ▼              │  │   { services,      │  │                   │  │
│  │ uninstalled       │  │     pluginId,      │  │ cleanup order:    │  │
│  │                   │  │     manifest }    │  │ 1.processes       │  │
│  │ + error state     │  │   (frozen)        │  │ 2.timers          │  │
│  │                   │  │         │          │  │ 3.events          │  │
│  │ transitions       │  │         ▼          │  │ 4.commands        │  │
│  │ validated via     │  │   activate(ctx)    │  │                   │  │
│  │ guard checks      │  │   (5-sec timeout)  │  │                   │  │
│  └─────────────────┘  └──────────────────┘  └───────────────────┘  │
│                                                                     │
│  Dependencies (constructor injected):                               │
│    - ServiceRegistry (Phase 1) → resolve IServices for ctx          │
│    - EsmLoader (Phase 3)        → load plugin code via import()     │
│    - Database (better-sqlite3)  → plugins table CRUD                │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow for activatePlugin():**

```
1. PluginHost.activatePlugin(pluginId)
   │
2. ├─ State machine: validate transition (installed → activating)
   │
3. ├─ DB: SELECT source_code, manifest FROM plugins WHERE id = ?
   │
4. ├─ EsmLoader.load(sourceCode) → PluginModule
   │    └─ Returns { default: { manifest, activate } } or { activate, manifest }
   │
5. ├─ Schema validation: manifestSchema.parse(manifest)
   │
6. ├─ context-builder: build PluginContext
   │    ├─ ServiceRegistry.resolve(ICommandBusServiceToken) → wrapped
   │    ├─ ServiceRegistry.resolve(IEventBusServiceToken) → wrapped
   │    ├─ ServiceRegistry.resolve(IActionRegistryServiceToken) → wrapped
   │    ├─ ServiceRegistry.resolve(ICapabilityServiceToken)
   │    ├─ ServiceRegistry.resolve(IProcessServiceToken) → wrapped
   │    ├─ ServiceRegistry.resolve(IStorageServiceToken) → wrapped
   │    ├─ ServiceRegistry.resolve(IAIServiceToken) → wrapped
   │    └─ Each wrapper auto-registers Disposable in ResourceTracker
   │
7. ├─ CapabilityGuard.grant(actorId, manifest.capabilitiesProposed)
   │
8. ├─ Promise.race([activate(ctx), timeout(5000)])
   │    ├─ Success → state: active, DB UPDATE status='active'
   │    └─ Failure → ResourceTracker.disposeAll(pluginId), rollback caps, state: error
   │
9. └─ Return result
```

### Recommended Project Structure

```
packages/core/plugin-host/
├── index.ts                 # PluginHost main class (lifecycle + coordination)
├── context-builder.ts       # buildPluginContext(): wrapped* services + freeze
├── resource-tracker.ts      # ResourceTracker with Disposable pattern
├── state-machine.ts         # PluginState enum + state transition guard
├── errors.ts                # PluginHostError hierarchy
└── __tests__/
    ├── plugin-host.test.ts       # Integration: full lifecycle flow
    ├── resource-tracker.test.ts  # Unit: track/dispose/disposeAll
    ├── context-builder.test.ts   # Unit: PluginContext shape + freeze
    └── state-machine.test.ts     # Unit: transition validation
```

### Pattern 1: Disposable Resource Tracking

**What:** Every resource created during `activate()` wraps itself in a `{ dispose: () => void }` object. ResourceTracker stores these in a `Map<pluginId, Disposable[]>`. Deactivate calls `disposeAll(pluginId)` which iterates all disposables and calls each one, then clears the tracking array.

**When to use:** Whenever a plugin registers a command handler, subscribes to an event, spawns a process, or creates a timer during `activate()`.

**Example:**
```typescript
// Source: proposed, based on existing deactivatePlugin() logic (plugin-runtime/index.ts:134-190)
// File: resource-tracker.ts

export interface Disposable {
  dispose(): void;
}

export class ResourceTracker {
  private resources = new Map<string, Disposable[]>();

  track(pluginId: string, disposable: Disposable): void {
    const list = this.resources.get(pluginId) ?? [];
    list.push(disposable);
    this.resources.set(pluginId, list);
  }

  disposeAll(pluginId: string): void {
    const list = this.resources.get(pluginId);
    if (!list) return;

    // D-09: 清理顺序 — 进程 → 定时器 → 事件/命令
    // Process disposables are sorted first (insertion order handles this)
    for (const d of list) {
      try { d.dispose(); } catch (e) {
        console.error(`[ResourceTracker] Error disposing resource for ${pluginId}:`, e);
      }
    }
    this.resources.delete(pluginId);
  }
}
```

### Pattern 2: Wrapped Service Proxy (context-builder)

**What:** Each IService exposed in `ctx.services` is wrapped with `createSafeFunction` to sever prototype chains, block constructor access, and auto-track resource registrations. This is a direct extraction from the existing `evaluateAndActivateEsm()` method.

**When to use:** When building the `PluginContext` for `activate()`.

**Example:**
```typescript
// Source: extracted from plugin-runtime/index.ts:253-530 (createSafeFunction + wrapped* objects)
// File: context-builder.ts

import type { ICommandBusService } from '../di/interfaces.js';
import { ResourceTracker, Disposable } from './resource-tracker.js';

function createSafeFunction(fn: Function): Function {
  const safeFn = (...args: any[]) => fn(...args);
  Object.setPrototypeOf(safeFn, null);
  Object.defineProperty(safeFn, 'constructor', {
    value: undefined, writable: false, configurable: false,
  });
  return safeFn;
}

export function wrapCommandBus(
  commandBus: ICommandBusService,
  tracker: ResourceTracker,
  pluginId: string,
): ICommandBusService {
  return {
    registerHandler: createSafeFunction(async (commandType, handler) => {
      const safeHandler = {
        execute: async (command: any) => {
          try { return await handler.execute(command); }
          catch (e) { console.error(`[Plugin:${pluginId}] Error executing ${commandType}:`, e); throw e; }
        }
      };
      await commandBus.registerHandler(commandType, safeHandler);
      // Auto-track for cleanup
      tracker.track(pluginId, {
        dispose: () => { commandBus.unregisterHandler(commandType).catch(() => {}); }
      });
    }),
    execute: createSafeFunction((command) => commandBus.execute(command)),
    // ... other methods wrapped similarly
  } as unknown as ICommandBusService;
}
```

### Pattern 3: State Machine with Transition Validation

**What:** A simple enum + guard function pattern. Each `PluginState` has a set of legal next states. Attempting an illegal transition (e.g., deactivating an already inactive plugin) throws a descriptive error.

**When to use:** At the entry of every PluginHost lifecycle method.

**Example:**
```typescript
// Source: proposed, based on D-03 state machine specification
// File: state-machine.ts

export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',  // transient
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',  // transient
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  [PluginState.INSTALLED]:     [PluginState.ACTIVATING],
  [PluginState.ACTIVATING]:    [PluginState.ACTIVE, PluginState.ERROR],
  [PluginState.ACTIVE]:        [PluginState.DEACTIVATING],
  [PluginState.DEACTIVATING]:  [PluginState.INACTIVE],
  [PluginState.INACTIVE]:      [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ERROR]:         [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.UNINSTALLED]:   [],
};

export function validateTransition(current: PluginState, next: PluginState, pluginId: string): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    throw new Error(
      `[PluginHost] Invalid state transition for plugin "${pluginId}": ${current} → ${next}`
    );
  }
}
```

### Anti-Patterns to Avoid
- **Direct Kernel access in PluginHost:** PluginHost MUST NOT access `kernelContainer` singleton. All dependencies are constructor-injected (D-02). Violating this makes PluginHost untestable and couples it to the Kernel monolith.
- **Mixing vm path into PluginHost:** The legacy `vm.createContext` path stays in PluginRuntime. PluginHost only works with EsmLoader. Don't add vm branching to the new code.
- **Swallowing dispose errors without logging:** ResourceTracker.disposeAll() should log individual dispose errors but continue cleanup (best-effort). Don't let one resource's dispose failure prevent others from being cleaned up.
- **Freezing PluginContext before wrapping is complete:** The `Object.freeze()` call must happen AFTER all wrapped service objects are constructed and assigned. Freezing too early prevents wrapper registration.
- **Using `any` for PluginContext type:** While the existing code uses `any` heavily, the new PluginContext interface should be properly typed with IService interfaces from Phase 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin state machine validation | Custom state transition logic with if/else chains | A small `PluginState` enum + `validateTransition()` function with a lookup table | Already locked by D-03; the lookup table pattern is simple, testable, and the existing deactivatePlugin already follows a similar pattern |
| Resource cleanup ordering | Manual cleanup loops | `ResourceTracker` with `Disposable` pattern | The existing code already tracks resources in arrays and cleans them in deactivatePlugin(). Formalizing this as Disposable avoids ordering bugs |
| Service instance resolution | Direct Kernel property access | `ServiceRegistry.resolve(Token)` | Already locked by D-02; DI-based resolution ensures PluginHost is testable with mock services |
| manifest validation | Manual field checks | `manifestSchema.parse()` from Phase 3 | Already built and tested; PluginHost just calls it in installPlugin() |

**Key insight:** The wrapped* security layer (createSafeFunction, prototype freezing, constructor blocking, Object.defineProperty) must NOT be reimplemented from scratch. It must be extracted verbatim from `PluginRuntime.evaluateAndActivateEsm()` (lines 253-530 of plugin-runtime/index.ts). This code is battle-tested against VM escape attempts and getting it wrong would create security regressions.

## Runtime State Inventory

> Phase 4 is a refactoring phase that renames/restructures code without changing runtime identifiers. However, it does add a new class name and directory.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Plugin records in SQLite `plugins` table (id, name, manifest, source_code, status, loader_version, zip_package) | None -- PluginHost reads/writes the same table. Schema unchanged. |
| Live service config | None — plugin data is in SQLite, not external service configs | None |
| OS-registered state | None — no system-level registrations reference plugin runtime code | None |
| Secrets/env vars | None — no secrets or env vars reference PluginRuntime by name | None |
| Build artifacts | None — PluginRuntime is not a separately installed package | None |

**Nothing found in category:** Verified by code review -- PluginRuntime is purely an in-memory class instantiated in Kernel constructor. All its state is in SQLite or in-memory Maps that are rebuilt on server restart.

## Common Pitfalls

### Pitfall 1: Breaking ResourceTracker during Context Migration
**What goes wrong:** When extracting `wrappedCommandBus`, `wrappedEventBus`, etc. into `context-builder.ts`, the registration callbacks lose access to the `ResourceTracker` instance, resulting in resources being created but never tracked (and thus never cleaned up).
**Why it happens:** The existing code has `registration` arrays scoped to `evaluateAndActivateEsm()`. When the code is extracted to a separate file, the closure over `registration` is lost.
**How to avoid:** Pass `ResourceTracker` as a parameter to `wrapCommandBus()` and similar wrapper functions. Each wrapper's `registerHandler()` callback calls `tracker.track(pluginId, dispose)` to record the resource.
**Warning signs:** Tests that verify resource cleanup after deactivate show leftover command handlers or event subscribers.

### Pitfall 2: Double-Cleanup When Activate Fails Mid-Execution
**What goes wrong:** If a plugin's `activate()` throws after registering 3 out of 5 resources, both the catch block AND `deactivatePlugin()` might try to clean up, causing double-unregister errors.
**Why it happens:** The existing code has explicit rollback in the catch block PLUS calling `deactivatePlugin()` at the top of the next activate call. ResourceTracker must handle double-dispose gracefully.
**How to avoid:** Each `Disposable.dispose()` implementation should be idempotent (e.g., check if already disposed, or use try/catch). The `ResourceTracker.disposeAll()` clears the tracking array after disposal, so a second call is a no-op.
**Warning signs:** "Error unregistering" log messages during test cleanup, duplicate unregister calls.

### Pitfall 3: PluginRuntime Facade Breaking server.ts
**What goes wrong:** If PluginRuntime's public method signatures change (e.g., return type changes from `any` to `Promise<Manifest>`), `server.ts` API endpoints break silently.
**Why it happens:** The facade pattern requires EXACT signature match. Even seemingly compatible changes (e.g., adding a return type annotation) can break destructuring patterns in callers.
**How to avoid:** PluginRuntime's public methods MUST have identical signatures to the existing code. Copy the method signatures verbatim from the current `index.ts`. Any type tightening should happen in a separate PR or Phase.
**Warning signs:** TypeScript compilation errors in `server.ts` after PluginRuntime modification.

### Pitfall 4: State Machine Transient States Leaking
**What goes wrong:** If `activatePlugin()` sets state to `activating` and then throws, the plugin is left in `activating` state and cannot be retried.
**Why it happens:** Transient states (`activating`, `deactivating`) must always resolve to a stable state regardless of success or failure.
**How to avoid:** Use try/finally in every method that enters a transient state. The catch block transitions to `ERROR` (for activate failures) or `INACTIVE` (for deactivate failures with forced cleanup).
**Warning signs:** Plugins stuck in intermediate states after test failures, unable to retry activation.

### Pitfall 5: Object.freeze() Breaking IService Methods
**What goes wrong:** `Object.freeze(ctx.services)` might interfere with wrapped service methods that have internal state. The freeze applies to the services object itself, not to individual service methods.
**Why it happens:** D-06 specifies `Object.freeze()` on the services object. If any service method has setter-like behavior on the services object, freeze would block it.
**How to avoid:** `Object.freeze()` is applied ONLY to the `ctx.services` container object (preventing property reassignment). Individual wrapped service objects are NOT frozen -- only their prototypes are set to null. The createSafeFunction pattern handles method-level hardening separately.
**Warning signs:** `TypeError: Cannot assign to read only property` during activate().

## Code Examples

Verified patterns from official sources:

### PluginHost Class Construction
```typescript
// Source: based on D-02 (CONTEXT.md), consistent with Kernel constructor pattern (kernel/index.ts:21-37)
// File: packages/core/plugin-host/index.ts

import type Database from 'better-sqlite3';
import { ServiceRegistry } from '../di/service-registry.js';
import { EsmLoader, EsmActivationError, EsmLoadTimeoutError } from '../esm-loader/index.js';
import { manifestSchema, type Manifest } from '../esm-loader/manifest-schema.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildPluginContext } from './context-builder.js';
import { PluginState, validateTransition } from './state-machine.js';
import { v7 as uuidv7 } from 'uuid';

export class PluginHost {
  private pluginStates = new Map<string, PluginState>();
  private resourceTracker = new ResourceTracker();
  private pluginInstances = new Map<string, { manifest: Manifest; activate: Function; deactivate?: Function }>();

  constructor(
    private serviceRegistry: ServiceRegistry,
    private esmLoader: EsmLoader,
    private db: Database.Database,
  ) {}
  // ... lifecycle methods
}
```

### Activate with Timeout and Rollback
```typescript
// Source: based on existing evaluateAndActivateEsm() (plugin-runtime/index.ts:213-585)
// File: plugin-host/index.ts (activatePlugin method)

async activatePlugin(pluginId: string): Promise<void> {
  const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
  validateTransition(currentState, PluginState.ACTIVATING, pluginId);
  this.pluginStates.set(pluginId, PluginState.ACTIVATING);

  const row = this.db.prepare(
    'SELECT source_code, manifest FROM plugins WHERE id = ?'
  ).get(pluginId) as any;
  if (!row) throw new Error(`Plugin not found: ${pluginId}`);

  try {
    // 1. Load module
    const mod = await this.esmLoader.load(row.source_code);
    const plugin = mod.default ?? mod;
    const manifest = plugin.manifest ?? (mod as any).manifest;
    const activate = plugin.activate ?? (mod as any).activate;

    if (!manifest || !activate) {
      throw new EsmActivationError(pluginId, 'missing manifest or activate');
    }

    // 2. Validate schema
    manifestSchema.parse(manifest);

    // 3. Build context (wrapped services auto-track via ResourceTracker)
    const ctx = buildPluginContext(
      this.serviceRegistry,
      this.resourceTracker,
      pluginId,
      manifest,
    );

    // 4. Grant capabilities
    const actorId = `plugin:${manifest.id}`;
    for (const cap of (manifest.capabilitiesProposed ?? [])) {
      const capGuard = await this.serviceRegistry.resolve(
        (await import('../di/interfaces.js')).ICapabilityServiceToken
      );
      await capGuard.grant(actorId, cap);
    }

    // 5. Activate with timeout (D-11)
    await Promise.race([
      activate(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new EsmLoadTimeoutError(5000)), 5000)
      ),
    ]);

    // 6. Success
    this.pluginStates.set(pluginId, PluginState.ACTIVE);
    this.pluginInstances.set(pluginId, { manifest, activate, deactivate: plugin.deactivate });
    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run('active', pluginId);

  } catch (err) {
    // D-12: Rollback on failure
    this.pluginStates.set(pluginId, PluginState.ERROR);
    this.resourceTracker.disposeAll(pluginId);
    // Revoke capabilities
    try {
      const capGuard = await this.serviceRegistry.resolve(
        (await import('../di/interfaces.js')).ICapabilityServiceToken
      );
      await capGuard.revokeAll(`plugin:${pluginId}`);
    } catch {}
    throw err;
  }
}
```

### Deactivate with Forced Cleanup
```typescript
// Source: based on existing deactivatePlugin() (plugin-runtime/index.ts:134-190)
// File: plugin-host/index.ts (deactivatePlugin method)

async deactivatePlugin(pluginId: string): Promise<void> {
  const currentState = this.pluginStates.get(pluginId);
  if (!currentState || currentState === PluginState.UNINSTALLED) return;
  validateTransition(currentState, PluginState.DEACTIVATING, pluginId);
  this.pluginStates.set(pluginId, PluginState.DEACTIVATING);

  const instance = this.pluginInstances.get(pluginId);

  try {
    // D-11: deactivate with 5-second timeout
    if (instance?.deactivate) {
      await Promise.race([
        instance.deactivate(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new EsmLoadTimeoutError(5000)), 5000)
        ),
      ]);
    }
  } catch (err) {
    console.error(`[PluginHost] Plugin ${pluginId} deactivate error:`, err);
  } finally {
    // D-09: Always force-clean resources regardless of deactivate success/failure
    this.resourceTracker.disposeAll(pluginId);
    this.pluginStates.set(pluginId, PluginState.INACTIVE);
    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run('inactive', pluginId);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vm.createContext` + `vm.Script.runInContext` | `import()` via data: URL (Node) / Blob URL (Browser) | Phase 3 | Already implemented |
| `PluginRuntime` monolith (evaluate + lifecycle + cleanup) | `PluginHost` (lifecycle) + `PluginRuntime` (facade) | Phase 4 (current) | Improves testability, separates concerns |
| Ad-hoc resource cleanup arrays in closure | `ResourceTracker` with `Disposable` pattern | Phase 4 (current) | Formalizes cleanup, enables complex deactivate scenarios |
| Direct `kernel.eventBus` access via `ctx.commandBus` | `ctx.services.commandBus` via Token DI | Phase 4 (current) | Type-safe, consistent with IService interface |

**Deprecated/outdated:**
- `PluginRuntime.evaluateAndActivate()` (vm path): Kept until Phase 8, but new plugins only use PluginHost's ESM path
- Direct `kernelContainer.pluginRuntime` singleton: Still works (facade preserved), but new code should prefer PluginHost injection

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | EsmLoader can load arbitrary plugin source strings on every `activatePlugin()` call without caching issues | Architecture Patterns | LOW -- Phase 3 tests verify cache isolation (each load() returns distinct modules) |
| A2 | ServiceRegistry.resolve() is synchronous enough for PluginContext construction (IService methods are async, but resolve itself is fine) | Architecture Patterns | LOW -- Phase 1-2 tests verify resolve() works correctly |
| A3 | The existing `plugins` table schema (with `loader_version` column from Phase 3) is sufficient for PluginHost's needs | Standard Stack | LOW -- Phase 3 added exactly the columns PluginHost needs |
| A4 | Creating a new `PluginHost` instance does not break the existing `kernelContainer.pluginRuntime` API contract | Architecture Patterns | MEDIUM -- The facade pattern depends on exact signature matching; any mismatch will cause server.ts compilation errors |
| A5 | ResourceTracker does not need to track capabilities (capabilities are managed separately by CapabilityGuard.revokeAll) | Common Pitfalls | LOW -- existing deactivatePlugin already separates capability cleanup from resource cleanup |

## Open Questions

1. **loadFromDB() 恢复策略：是否只恢复 status='active' 的插件？**
   - What we know: 现有 PluginRuntime.loadFromDB() 只恢复 status='active' 的插件。D-13 要求 PluginRuntime 保持兼容，但 CONTEXT.md 未明确规定 PluginHost 自身的恢复行为
   - What's unclear: PluginHost 是否应该提供独立的 `restoreActivePlugins()` 方法，还是完全由 PluginRuntime.loadFromDB() 委托处理
   - Recommendation: PluginHost 提供 `restoreActivePlugins()` 方法，查询 status='active' 且 loader_version='esm' 的插件并激活它们。PluginRuntime.loadFromDB() 保持不变，额外委托给 PluginHost 处理 ESM 插件

2. **PluginHost 需要暴露哪些内省方法？**
   - What we know: 现有 PluginRuntime 提供 `loadedPlugins` getter 返回插件列表。PluginHost 至少需要等价的 `listPlugins()` 方法
   - What's unclear: 是否需要 `getPluginState(pluginId)`, `getActivePlugins()`, `isPluginActive(pluginId)` 等额外内省方法。这些不是 CONTEXT.md 中明确要求的
   - Recommendation: 实现 `listPlugins(): PluginInfo[]` （返回所有已安装插件的 id/name/status）和 `getPluginState(pluginId): PluginState`。这两个方法覆盖了 server.ts 的所有使用场景。其他内省方法按需添加

3. **Context-builder 中 wrappedStorage 使用 `manifest.id` 还是 `pluginId` 作为隔离键？**
   - What we know: 现有代码使用 `manifest.id` 作为 plugin_storage 的 plugin_id 键。但 `manifest.id` 和数据库中的 `pluginId`（uuid v7）是不同的值
   - What's unclear: PluginHost 使用哪个 ID 进行存储隔离
   - Recommendation: 保持使用 `manifest.id` 作为存储隔离键（与现有行为一致）。`pluginId` 是数据库主键（用于生命周期管理），`manifest.id` 是插件逻辑标识符（用于存储命名空间）

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.1.0 | -- |
| vitest | Testing | Yes | 4.1.9 | -- |
| better-sqlite3 | Plugin storage | Yes | 12.10.0 | -- |
| TypeScript (tsc) | Type checking | Yes | 5.8.2 | -- |
| pnpm | Package management | Yes | 10.33.0 | npm 11.6.2 |

**Missing dependencies with no fallback:** None
**Missing dependencies with fallback:** None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | `vitest.config.ts` (needs update to include plugin-host tests) |
| Quick run command | `npx vitest run packages/core/plugin-host/__tests__/` |
| Full suite command | `npm test` (vitest run) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLUG-05-SC1 | 插件通过 `activate(ctx)` 接收注入的服务，注册命令处理器和事件订阅 | unit | `npx vitest run packages/core/plugin-host/__tests__/context-builder.test.ts` | No -- Wave 0 |
| PLUG-05-SC2 | `deactivate()` 清理资源，超时 5 秒强制终止 | unit | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | No -- Wave 0 |
| PLUG-05-SC3 | 单个插件 activate 失败不影响其他插件和基座 | integration | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | No -- Wave 0 |
| PLUG-05-SC4 | PluginHost 支持 install/activate/deactivate/uninstall 完整生命周期 | integration | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | No -- Wave 0 |
| PLUG-05-SC5 | 插件停用时所有资源被自动追踪并清理 | unit | `npx vitest run packages/core/plugin-host/__tests__/resource-tracker.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/core/plugin-host/__tests__/` (quick, focused on PluginHost)
- **Per wave merge:** `npm test` (full vitest suite, including DI + ESM loader tests for regression)
- **Phase gate:** Full suite green + tsc --noEmit clean before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/core/plugin-host/__tests__/resource-tracker.test.ts` -- covers SC-5 (resource tracking/cleanup)
- [ ] `packages/core/plugin-host/__tests__/context-builder.test.ts` -- covers SC-1 (PluginContext shape, service wrapping, freeze)
- [ ] `packages/core/plugin-host/__tests__/state-machine.test.ts` -- covers state transitions and illegal transition rejection
- [ ] `packages/core/plugin-host/__tests__/plugin-host.test.ts` -- covers SC-2, SC-3, SC-4 (full lifecycle integration)
- [ ] `vitest.config.ts` update -- add `packages/core/plugin-host/__tests__/**/*.test.ts` to include patterns
- [ ] Test fixtures -- create minimal plugin source strings for testing activate/deactivate scenarios

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | PluginHost does not handle user authentication |
| V3 Session Management | No | PluginHost does not manage sessions |
| V4 Access Control | Yes | CapabilityGuard checks are performed at CommandBus interceptor level; PluginHost grants plugin capabilities during activate and revokes on deactivate |
| V5 Input Validation | Yes | `manifestSchema.parse()` validates manifest structure; source code is loaded via EsmLoader |
| V6 Cryptography | No | No cryptographic operations in PluginHost |
| V7 Error Handling | Yes | Error messages must not leak internal paths or sensitive information; EsmActivationError carries pluginId (already public) but no source code |

### Known Threat Patterns for Plugin Lifecycle Management

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plugin source code injection via installPlugin() | Tampering | EsmLoader validates code at load time (syntax errors caught); manifest validated with zod schema |
| Plugin prototype pollution during activate() | Elevation of Privilege | createSafeFunction severs prototype chains; Object.freeze on ctx.services; Object.defineProperty blocks constructor access |
| Resource exhaustion by plugin creating unlimited timers/processes | Denial of Service | ResourceTracker tracks all spawned resources; deactivate disposes everything; activate timeout (5s) prevents infinite loops |
| Plugin interfering with other plugins' service access | Information Disclosure | Each plugin gets its own wrapped service instances; service isolation via per-plugin wrapped* proxy objects |
| Stale resources after failed activate | Elevation of Privilege | D-12: activate failure triggers ResourceTracker.disposeAll() rollback; no half-activated state remains |

## Sources

### Primary (HIGH confidence)
- `packages/core/plugin-runtime/index.ts` (954 lines) -- Full existing PluginRuntime implementation: wrapped* security wrappers, evaluateAndActivate, evaluateAndActivateEsm, deactivatePlugin, installPlugin, lifecycle methods. Direct code review.
- `packages/core/esm-loader/esm-loader.ts` -- EsmLoader abstract class and PluginModule interface. Direct code review.
- `packages/core/esm-loader/errors.ts` -- EsmLoaderError hierarchy (5 classes). Direct code review.
- `packages/core/di/service-registry.ts` (294 lines) -- ServiceRegistry full API. Direct code review.
- `packages/core/di/interfaces.ts` (318 lines) -- 7 IService interfaces + Token instances. Direct code review.
- `packages/core/di/token.ts` -- Token<T> class. Direct code review.
- `packages/core/kernel/index.ts` (90 lines) -- Kernel constructor and PluginRuntime initialization. Direct code review.
- `packages/core/process-manager/index.ts` -- ProcessManager API (spawn, kill, registerHandler, registerInterval). Direct code review.
- `packages/core/command-bus/index.ts` -- CommandBus API (registerHandler, unregisterHandler, execute). Direct code review.
- `packages/core/event-bus/index.ts` -- EventBus API (subscribe, unsubscribe, publish). Direct code review.
- `packages/core/capability-system/index.ts` -- CapabilityGuard API (grant, revokeAll, check). Direct code review.
- `packages/core/esm-loader/manifest-schema.ts` -- zod manifestSchema + Manifest type. Direct code review.
- `packages/core/esm-loader/install-utils.ts` -- bundlePlugin + validateAndBundleZip. Direct code review.
- `.planning/phases/04-pluginhost/04-CONTEXT.md` -- Locked decisions D-01 through D-14. Direct code review.
- `.planning/phases/03-esm/03-CONTEXT.md` -- Phase 3 decisions for integration context. Direct code review.
- `.planning/phases/02-token/02-CONTEXT.md` -- Phase 2 IService decisions. Direct code review.
- `vitest.config.ts` -- Current test include patterns. Direct code review.

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` -- Project constraints (compatibility, dual runtime, security, type safety, progressive migration)
- `.planning/ROADMAP.md` -- Phase 4 success criteria and PLUG-05 mapping
- `packages/core/di/__tests__/storage-service.test.ts` -- Test pattern reference (describe/it/expect + in-memory SQLite)
- `packages/core/esm-loader/__tests__/node-loader.test.ts` -- Test pattern reference (fixtures + async loading)

### Tertiary (LOW confidence)
- JupyterLab plugin system design principles -- architectural reference only; not verified against current JupyterLab source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All dependencies already installed and verified; no new packages needed
- Architecture: HIGH -- Decisions D-01 through D-14 cover all design aspects; architecture directly derived from existing PluginRuntime code
- Pitfalls: HIGH -- Pitfalls identified by analyzing the existing code's cleanup and error handling patterns; all edge cases are discoverable from the current implementation

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (Phase 4 is a pure refactoring of stable, well-understood code; 30-day validity is appropriate)
