# PI-010 Implementation Report — Platform Event Bus

**Increment:** PI-010 — Platform Event Bus
**Module:** `packages/core/event-bus-runtime/`
**Commit:** `feat(kernel): implement platform event bus (PI-010)`
**Status:** ✅ Complete — 15/15 unit tests passing, `tsc --noEmit` clean for the module.

---

## 1. Objective

Introduce a self-contained **Platform Event Bus** as a Platform Kernel subsystem
responsible **only** for platform-infrastructure events (platform lifecycle,
bootstrap pipeline stages, service-registry & capability-runtime notifications,
configuration loading). It is explicitly **not** a business event system, a
classroom messaging system, or a plugin communication system.

---

## 2. Components Delivered

| File | Type | Responsibility |
|---|---|---|
| `EventError.ts` | errors | `EventError` with stable `code`, `eventType`, `correlationId`. |
| `types.ts` | contracts | `PlatformEventType`, `PlatformEvent`/`PlatformEventInit`, `EventDescriptorInit`, `EventHandlerOptions`, `EventResult`/`HandlerResult`, `EventFilter`, `CapabilityEventSource`, `BuilderIntegrationSource`. |
| `PlatformEvent.ts` | model | `PlatformEventObject` — immutable event (fills `eventId`/`timestamp`). |
| `EventDescriptor.ts` | model | Metadata describing an event type. |
| `EventContext.ts` | runtime | Handler context: `eventId`/`timestamp`/`source`/`payload`/`metadata`/`correlationId` + `cancel()`/`timeoutMs`. |
| `EventHandler.ts` | model | Wraps a handler with priority/order/filter/mode/once/timeout; error-isolated `invoke`/`invokeSync` (with per-handler timeout). |
| `EventRegistry.ts` | store | Source of truth: `subscribe`/`subscribeOnce`/`unsubscribe`/`clear`; indexed by handler id and event type (incl. `'*'`). |
| `EventSubscriber.ts` | token | Stable handle returned to callers for `unsubscribe()`. |
| `EventDispatcher.ts` | engine | Priority + ordered dispatch, error isolation, cancellation, `once` removal (async + sync paths). |
| `EventPublisher.ts` | engine | `publish`/`publishAsync`/`publishSync` with structured diagnostics via the reused logger. |
| `EventBus.ts` | orchestrator | Public API + 12 convenience publishers + integration bridges. |
| `index.ts` | barrel | Re-exports the public surface. |

---

## 3. Supported Event Types (12)

`PlatformStarting`, `PlatformStarted`, `PlatformStopping`, `PlatformStopped`,
`ServiceRegistered`, `ServiceRemoved`, `CapabilityRegistered`,
`CapabilityResolved`, `BootstrapStageStarted`, `BootstrapStageCompleted`,
`BootstrapStageFailed`, `ConfigurationLoaded`.

---

## 4. Publishing & Subscription

- **Publishing:** `publish()` (async, awaits handlers), `publishAsync()` (alias),
  `publishSync()` (synchronous; async handlers started but not awaited).
- **Subscription:** `subscribe()`, `subscribeOnce()`, `unsubscribe()`, `clear()`.
- **Dispatch features:** priority (desc) + ordered (tie-break asc), error
  isolation, cancellation (`ctx.cancel()`), per-handler timeout, filtered
  handlers, sync/async/multiple handlers.

---

## 5. Integration (required by spec)

| Subsystem | Mechanism |
|---|---|
| `PlatformBuilder` | `attachBuilder(BuilderIntegrationSource)` → `isBuilderAware()`. |
| `BootstrapPipeline` | `bridgeBootstrapPipeline(pipeline)` maps `StageStarted`/`StageCompleted`/`StageFailed` diagnostics → platform events. |
| `ServiceRegistry` | `bridgeServiceEventBus(ServiceEventBus)` forwards `ServiceRegistered`/`ServiceRemoved`. |
| `DependencyInjection` | Events carry `correlationId` and share the kernel's `IPlatformLogger`; no separate DI coupling needed. |
| `CapabilityRuntime` | `bridgeCapabilityRuntime(CapabilityEventSource)` forwards capability registered/resolved events via a structural seam (no modification of PI-009). |

**Existing code reused (no duplication):** `IPlatformLogger` / `DefaultPlatformLogger`
(bootstrap), the typed `ServiceEventBus` and its `ServiceEventMap` payloads
(service-registry), `BootstrapPipeline.addListener` diagnostics, and the
`CapabilityError`-style structured-error pattern. The pre-existing generic
`packages/core/event-bus/` `EventBus` is left untouched.

---

## 6. Testing

Test file: `packages/core/__tests__/event-bus.test.ts` (15 tests).

| Area | Cases |
|---|---|
| Publish & subscribe | delivery with full context, multiple subscribers, wildcard |
| Priority & ordering | priority desc, `order` tie-break (via `publishSync` for determinism) |
| Async | `await publish` completes after async handler |
| Cancellation | `ctx.cancel()` stops remaining handlers |
| Error isolation | throwing handler doesn't stop others; `failed`/`succeeded` reported; timeout enforced |
| Filtered & once | filter skip; `subscribeOnce` removed after first run |
| Subscription lifecycle | `unsubscribe()` via returned token |
| Regression | `bridgeServiceEventBus` forwards `ServiceRegistered`; `bridgeBootstrapPipeline` maps stage diagnostics; `bridgeCapabilityRuntime` forwards capability events |

Result: **15 passed / 15**.

---

## 7. Validation & Conformance

- `npx vitest run packages/core/__tests__/event-bus.test.ts` → 15/15 ✅
- Combined kernel suites (PI-008 + PI-009 + PI-010) → 47/47 ✅
- `npx tsc --noEmit` → **0 errors** in `packages/core/event-bus-runtime/**` and
  `packages/core/__tests__/event-bus.test.ts`. The only remaining `tsc` errors in
  the repo are pre-existing, unrelated scaffold fixtures
  (`packages/plugin-sdk/scaffold/...`, `packages/core/esm-loader/__tests__/fixtures/syntax-error.js`).

---

## 8. Deviations & Notes

- The module lives at `packages/core/event-bus-runtime/` (not `packages/core/event-bus/`)
  to avoid clobbering the pre-existing generic `EventBus` and to keep the two
  concerns distinct.
- `CapabilityRuntime` (PI-009) has no built-in emitter, so integration uses a
  structural `CapabilityEventSource` seam rather than modifying PI-009. The
  kernel connects the two by passing a source that calls the bus's convenience
  publishers, or by extending `CapabilityRuntime` with an emitter in a later
  increment.
- `EventResult` is exported as a type (data shape), consistent with PI-007/PI-009
  report/validation types.
