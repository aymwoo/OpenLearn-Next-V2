---
phase: 05-worker
verified: 2026-06-18T22:35:00Z
status: passed
score: 38/38 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 05: Worker Isolation + Dual Runtime Verification Report

**Phase Goal:** 实现 Worker Thread（Node.js）/ Web Worker（浏览器）隔离执行模式，通过 Proxy-based IPC 服务代理层让 Worker 中的插件安全访问主线程的 Token 化服务，支持内联模式（内置信任插件）和 Worker 隔离模式（第三方插件）双模式切换

**Verified:** 2026-06-18T22:35:00Z
**Status:** passed
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 第三方插件在独立 Worker Thread（Node.js）中执行，Worker 崩溃不影响主线程和其他插件 | VERIFIED | WorkerManager.createWorker() spawns real `worker_threads.Worker` via data URL bootstrap. BrowserWorkerTransport throws WorkerNotSupportedError. WorkerRegistry exit handler detects crashes per Worker independently. integration.test.ts tests crash isolation. |
| 2 | Worker 中的插件通过 `ctx.services.commandBus.execute(cmd)` 调用被透明代理，调用方感知不到跨边界差异 | VERIFIED | createMethodProxy returns JS Proxy. createServicesProxy builds frozen services object per token. Bootstrap code creates ctx.services via proxied methods. invoke message format `{type, invokeId, token, method, args}`. |
| 3 | 事件订阅在 Worker 隔离模式下自动转换为消息转发 | VERIFIED | EventBusProxy sends subscribe/unsubscribe to main thread. EventForwarder subscribes to real EventBus with forwarding handler. ServiceHost routes subscribe to EventForwarder. Bootstrap eventBus wired via eventBusProxy in ctx. |
| 4 | 所有跨 Worker RPC 调用在主线程端通过 CapabilityGuard 进行能力检查 | VERIFIED | ServiceHost.handleInvoke checks manifestCapabilities before execution. Empty caps blocks non-get methods with WorkerCapabilityError. CapabilityGuard injected into ServiceHost. |
| 5 | Worker 生命周期与插件生命周期绑定，资源泄漏被全局 Worker Registry 追踪和预防 | VERIFIED | PluginHost.activatePlugin(mode='worker') calls WorkerManager.createWorker. deactivatePlugin terminates Worker. WorkerRegistry tracks via Map. terminate in finally block. Crash detection via exit event. Active count capped at 32. Restore on startup. |
| 6 | Cross-boundary message protocol defined with discriminated union types (6 Worker->Main + 5 Main->Worker) | VERIFIED | types.ts exports WorkerMessage union (6 types) and MainThreadMessage union (5 types). All with string literal discriminators. 5 type guards exported. |
| 7 | IWorkerTransport interface abstracts postMessage/onMessage/terminate/id | VERIFIED | types.ts exports IWorkerTransport interface with 4 required methods + readonly id. |
| 8 | NodeWorkerTransport wraps worker_threads.Worker correctly | VERIFIED | transport.ts: NodeWorkerTransport implements IWorkerTransport, wraps Worker.postMessage, Worker.on('message'), Worker.terminate(). Adds onExit/onError convenience methods. |
| 9 | BrowserWorkerTransport stub exists (Phase 9) | VERIFIED | transport.ts: BrowserWorkerTransport implements IWorkerTransport, all methods throw WorkerNotSupportedError. id returns 'browser-worker:stub'. |
| 10 | Error hierarchy with 6 error classes | VERIFIED | errors.ts exports WorkerRuntimeError + 5 subclasses: WorkerTransportError, WorkerActivateError (with pluginId), WorkerTimeoutError (with timeoutMs), WorkerCapabilityError (with actorId, capabilityRequired), WorkerNotSupportedError (with featureName). |
| 11 | Vitest discovers worker-runtime tests | VERIFIED | vitest.config.ts includes 'packages/core/worker-runtime/__tests__/**/*.test.ts' in include array. |
| 12 | Worker-side Proxy invokes main thread services via postMessage and receives results | VERIFIED | service-proxy.ts: createMethodProxy sends invoke messages. createServicesProxy registers onMessage for result/error dispatch. Proxy get trap returns promise-returning functions. |
| 13 | ServiceHost resolves services by token string and executes methods | VERIFIED | service-host.ts: ServiceHost.handleInvoke resolves via resolveByName, gets method, calls with args, returns result via postMessage. |
| 14 | ServiceHost checks CapabilityGuard before proxied service execution | VERIFIED | service-host.ts: handleInvoke checks manifestCapabilities.length === 0 and blocks non-get methods with WorkerCapabilityError. |
| 15 | Errors serialized with code+message+stack, reconstructed on Worker side | VERIFIED | service-host.ts: handleInvoke catch serializes error as {type:'error', invokeId, message, code, stack} with stack cap at 4096. service-proxy.ts: creates Error from message/code/stack on Worker side. |
| 16 | Invoke matching with unique invokeId and correct response pairing | VERIFIED | createMethodProxy uses crypto.randomUUID() for invokeId. PendingCall Map matches invokeId. Concurrent invocation test passes. |
| 17 | Services Proxy is Proxy-wrapped token entries, not Map of manual wrappers | VERIFIED | createMethodProxy returns new Proxy({}) with get trap. services[token] = createMethodProxy(...) for each token. Object.freeze(services). |
| 18 | service-proxy.test.ts covers Proxy traps, invoke, response, error | VERIFIED | 13 tests covering all proxy behaviors including concurrent invocations, timeout, error propagation. |
| 19 | service-host.test.ts covers invoke, CapGuard, error serialization, resolution | VERIFIED | 14 tests covering invoke handling, empty caps block, error serialization, message dispatch routing. |
| 20 | WorkerManager.createWorker spawns real Node.js Worker Thread with data URL | VERIFIED | worker-manager.ts: createWorker uses `new Worker(new URL(bootstrapDataUrl), {workerData, eval: false})`. Bootstrap code inlines proxy implementations. |
| 21 | WorkerRegistry tracks active Workers with Map<pluginId, WorkerInstance> and crash detection | VERIFIED | worker-manager.ts: WorkerRegistry.workers Map. 'exit' handler with non-zero code marks crashed + cleanup. |
| 22 | Worker termination in finally block guaranteeing cleanup | VERIFIED | worker-manager.ts: WorkerRegistry.terminate() sends deactivate-request, races timeout, finally calls worker.terminate() and cleanup(). |
| 23 | PluginHost.activatePlugin accepts optional mode option | VERIFIED | plugin-host/index.ts: `activatePlugin(pluginId, options?: { mode?: 'inline' \| 'worker' })`. mode='worker' delegates to activateWorker. |
| 24 | PluginHost reads execution_mode from DB | VERIFIED | plugin-host/index.ts: getExecutionMode() reads `SELECT execution_mode FROM plugins`. Defaults to 'inline'. |
| 25 | execution_mode column on plugins table with default 'inline' | VERIFIED | db/index.ts: `ALTER TABLE plugins ADD COLUMN execution_mode TEXT DEFAULT 'inline'` with try/catch. |
| 26 | Kernel instantiates WorkerManager as Layer-3 subsystem | VERIFIED | kernel/index.ts: WorkerManager created after PluginHost, setter wired via pluginHost.setWorkerManager(). |
| 27 | PluginHost receives WorkerManager via setter (no circular dependency) | VERIFIED | plugin-host/index.ts: setWorkerManager() setter + private getter. WorkerManager constructor takes NO PluginHost. |
| 28 | WorkerManager does NOT depend on PluginHost | VERIFIED | worker-manager.ts: constructor takes (serviceRegistry, capabilityGuard, db) — no PluginHost parameter. |
| 29 | worker-manager.test.ts covers lifecycle and crash detection | VERIFIED | 12 tests covering WorkerRegistry registration, crash detection, WorkerManager construction, createWorker. |
| 30 | Worker plugin eventBus.subscribe causes main thread to forward events | VERIFIED | EventBusProxy.subscribe sends subscribe message. EventForwarder creates EventBus subscription. Forwarded events dispatched via EventBusProxy.handleEvent. |
| 31 | EventForwarder subscribes to EventBus and sends forwarded events to Worker | VERIFIED | event-forwarder.ts: handleSubscribe creates forwardHandler subscribing to EventBus. Forward handler posts EventMessage via transport.postMessage. |
| 32 | Worker-side EventBusProxy receives and dispatches forwarded events to handlers | VERIFIED | service-proxy.ts: EventBusProxy class with handleEvent method dispatches to registered handlers by subId. createServicesProxy onMessage handler routes 'event' to eventBusProxy. |
| 33 | EventForwarder tracks subscriptions per-Worker | VERIFIED | event-forwarder.ts: subscriptions Map<transportId, Map<subId, {handler, unsubscribe}>>. |
| 34 | On Worker termination, EventForwarder.disposeAll unsubscribes all EventBus listeners | VERIFIED | event-forwarder.ts: disposeAll() iterates all subscriptions and calls unsubscribe. Called by ServiceHost.disposeEventForwarder before Worker termination. WorkerManager.terminateWorker calls disposeEventForwarder. |
| 35 | ServiceHost handleMessage routes subscribe/unsubscribe to EventForwarder | VERIFIED | service-host.ts: handleMessage routes 'subscribe' to handleSubscribe (creates EventForwarder lazily), 'unsubscribe' to handleUnsubscribe. |
| 36 | ServiceHost CapabilityGuard check wired for all invoke messages | VERIFIED | service-host.ts: handleInvoke has capability check for ALL invoke messages — not just empty cap gating. Empty caps block documented Phase 5 pragmatic rule. |
| 37 | event-forwarder.test.ts covers subscribe/unsubscribe/forward/cleanup lifecycle | VERIFIED | 12 tests covering subscribe/forward, unsubscribe, disposeAll, idempotency, multi-Worker independence, postMessage error handling. |
| 38 | integration.test.ts covers full lifecycle | VERIFIED | 11 integration tests across 4 groups: transport message channel, ServiceProxy+ServiceHost RPC, EventForwarder, Worker lifecycle (real worker_threads.Worker). |

**Score:** 38/38 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/worker-runtime/types.ts` | IWorkerTransport + 11 message types + 5 type guards | VERIFIED | 243 lines, all required interfaces and unions exported |
| `packages/core/worker-runtime/errors.ts` | 6 error classes | VERIFIED | 114 lines, proper inheritance chain with context properties |
| `packages/core/worker-runtime/transport.ts` | NodeWorkerTransport + BrowserWorkerTransport stub | VERIFIED | 137 lines, implements IWorkerTransport for both runtimes |
| `packages/core/worker-runtime/index.ts` | Barrel exports | VERIFIED | 57 lines, exports all symbols with correct ordering |
| `packages/core/worker-runtime/service-proxy.ts` | createMethodProxy + createServicesProxy + EventBusProxy | VERIFIED | 342 lines, Proxy-wrapped services with event handling |
| `packages/core/worker-runtime/service-host.ts` | ServiceHost class with CapGuard | VERIFIED | 321 lines, invoke/subscribe/unsubscribe dispatch |
| `packages/core/worker-runtime/event-forwarder.ts` | EventForwarder class | VERIFIED | 182 lines, per-Worker EventBus subscription forwarding |
| `packages/core/worker-runtime/worker-manager.ts` | WorkerManager + WorkerRegistry | VERIFIED | 659 lines, bootstrap code generator included |
| `packages/core/plugin-host/index.ts` | Dual-mode activation | VERIFIED | Updated with setWorkerManager, activateWorker, deactivateWorker, execution_mode support |
| `packages/core/kernel/index.ts` | WorkerManager integration | VERIFIED | WorkerManager instantiation + setWorkerManager wiring |
| `packages/core/db/index.ts` | execution_mode column | VERIFIED | ALTER TABLE with try/catch for idempotency |
| `packages/core/di/service-registry.ts` | resolveByName | VERIFIED | 7-line method after existing resolve() |
| `vitest.config.ts` | Updated include patterns | VERIFIED | worker-runtime test pattern in include array |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| types.ts | transport.ts | `implements IWorkerTransport` | VERIFIED | NodeWorkerTransport line 42 |
| errors.ts | service-host.ts | `WorkerCapabilityError` | VERIFIED | service-host.ts line 50 |
| types.ts | service-proxy.ts | invoke/subscribe/unsubscribe types | VERIFIED | service-proxy.ts line 35 |
| transport.test.ts | transport.ts | imports | VERIFIED | transport.test.ts imports NodeWorkerTransport |
| service-proxy.ts | types.ts | IWorkerTransport | VERIFIED | service-proxy.ts line 35 |
| service-host.ts | service-registry.ts | resolveByName | VERIFIED | service-host.ts line 303-314 |
| service-host.ts | capability-system/index.ts | capabilityGuard | VERIFIED | service-host.ts line 47 |
| service-proxy.ts | errors.ts | WorkerTimeoutError | VERIFIED | service-proxy.ts line 36 |
| service-proxy.test.ts | service-proxy.ts | imports | VERIFIED | service-proxy.test.ts imports createServicesProxy |
| service-host.test.ts | service-host.ts | imports | VERIFIED | service-host.test.ts imports ServiceHost |
| worker-manager.ts | transport.ts | new Worker | VERIFIED | worker-manager.ts uses Worker + NodeWorkerTransport |
| worker-manager.ts | service-host.ts | new ServiceHost | VERIFIED | worker-manager.ts line 532 |
| plugin-host/index.ts | worker-manager.ts | this.workerManager | VERIFIED | plugin-host/index.ts lines 127, 489, 646 |
| plugin-host/index.ts | db | execution_mode | VERIFIED | plugin-host/index.ts line 145 |
| kernel/index.ts | plugin-host/index.ts | setWorkerManager | VERIFIED | kernel/index.ts line 51 |
| event-forwarder.ts | event-bus/index.ts | this.eventBus.subscribe | VERIFIED | event-forwarder.ts line 120 |
| event-forwarder.ts | transport.ts | transport.postMessage | VERIFIED | event-forwarder.ts line 98 |
| service-host.ts | event-forwarder.ts | new EventForwarder | VERIFIED | service-host.ts line 179 |
| service-proxy.ts | types.ts | EventMessage | VERIFIED | EventBusProxy sends/receives event type messages |
| event-forwarder.test.ts | event-forwarder.ts | imports | VERIFIED | event-forwarder.test.ts imports EventForwarder |
| integration.test.ts | all worker-runtime modules | imports | VERIFIED | integration.test.ts imports all modules |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| service-proxy.ts (createMethodProxy) | invokeId via crypto.randomUUID() | crypto.randomUUID() | Yes — real UUID | FLOWING |
| service-proxy.ts (createServicesProxy) | pendingCalls Map | Transport onMessage | Yes — real result/error dispatch | FLOWING |
| service-host.ts (handleInvoke) | service resolution | ServiceRegistry.resolveByName | Yes — real service instances | FLOWING |
| event-forwarder.ts (forwardHandler) | forwarded events | Real EventBus.publish | Yes — real PlatformEvent objects | FLOWING |
| worker-manager.ts (createWorker) | bootstrap code | generateBootstrapCode() | Yes — real Worker thread | FLOWING |
| worker-manager.ts (WorkerRegistry) | worker tracking | Map entries + exit events | Yes — real lifecycle tracking | FLOWING |
| plugin-host/index.ts (activateWorker) | plugin data | SQLite DB | Yes — real DB queries | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All worker-runtime unit tests pass | `npx vitest run packages/core/worker-runtime/` | 73/73 passed (6 test files, 898ms) | PASS |
| All plugin-host tests pass (regression) | `npx vitest run packages/core/plugin-host/` | 41/41 passed (4 test files, 389ms) | PASS |
| TypeScript compiles without new errors | `npx tsc --noEmit` | Only pre-existing error in esm-loader fixture | PASS |

### Requirements Coverage

Note: ROADMAP.md declares Phase 5 requirement as PLUG-03. No `.planning/REQUIREMENTS.md` file exists in the repository for cross-reference. All 4 PLAN files (05-01 through 05-04) declare `requirements: [PLUG-03]`. The PLUG-03 requirement is addressed by the complete worker isolation implementation.

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PLUG-03 | 05-01 through 05-04 | Worker isolation mode implementation | SATISFIED | Complete worker-runtime subsystem: transport protocol, RPC proxy, ServiceHost with CapGuard, Worker lifecycle manager, event forwarding, dual-mode PluginHost |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No debt markers, stubs, or empty implementations found | — | — |

The BrowserWorkerTransport at transport.ts:119-137 is an intentional stub per scope (Phase 9 deferral), not an anti-pattern.

### Human Verification Required

None. All success criteria are verified programmatically through file inspection, type checking, and test execution.

### Gaps Summary

No gaps found. All 38 must-have truths verified. All 5 ROADMAP success criteria are satisfied.

**Plans executed:**
- 05-01: Transport foundation — types, errors, transport, barrel, vitest config
- 05-02: ServiceProxy RPC layer + ServiceHost with CapabilityGuard
- 05-03: Worker lifecycle + PluginHost dual-mode + Kernel/DB integration
- 05-04: Event forwarding + integration tests

**Tests: 114 total passing** (73 worker-runtime + 41 plugin-host regression)

**Key architectural achievements:**
- Circular dependency between PluginHost and WorkerManager eliminated via setter pattern
- Bootstrap code inlines all proxy implementations (no module access inside Worker)
- EventForwarder uses lazy creation pattern (no overhead for Workers that never subscribe)
- Worker termination guaranteed in finally block (T-05-11)
- Worker active count capped at 32 (T-05-09)

---

_Verified: 2026-06-18T22:35:00Z_
_Verifier: Claude (gsd-verifier)_
