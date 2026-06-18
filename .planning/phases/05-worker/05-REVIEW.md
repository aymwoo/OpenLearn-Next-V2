---
phase: 05-worker
reviewed: 2026-06-18T08:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - packages/core/worker-runtime/types.ts
  - packages/core/worker-runtime/errors.ts
  - packages/core/worker-runtime/transport.ts
  - packages/core/worker-runtime/service-proxy.ts
  - packages/core/worker-runtime/service-host.ts
  - packages/core/worker-runtime/worker-manager.ts
  - packages/core/worker-runtime/event-forwarder.ts
  - packages/core/worker-runtime/index.ts
  - packages/core/plugin-host/index.ts
  - packages/core/kernel/index.ts
  - packages/core/db/index.ts
  - packages/core/di/service-registry.ts
  - packages/core/worker-runtime/__tests__/transport.test.ts
  - packages/core/worker-runtime/__tests__/service-proxy.test.ts
  - packages/core/worker-runtime/__tests__/service-host.test.ts
  - packages/core/worker-runtime/__tests__/worker-manager.test.ts
  - packages/core/worker-runtime/__tests__/event-forwarder.test.ts
  - packages/core/worker-runtime/__tests__/integration.test.ts
findings:
  critical: 2
  warning: 4
  info: 5
  total: 11
status: issues_found
---

# Phase 5: Worker Runtime Code Review Report

**Reviewed:** 2026-06-18T08:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

This review covers the Worker Runtime subsystem: transport layer (NodeWorkerTransport/BrowserWorkerTransport), Worker-side RPC proxy (createMethodProxy/createServicesProxy/EventBusProxy), main-thread RPC handler (ServiceHost), event forwarding (EventForwarder), Worker lifecycle management (WorkerManager/WorkerRegistry), and PluginHost dual-mode activation integration.

Two critical bugs were found: the transport onMessage handler is overwritten during Worker activation, permanently breaking all post-activation RPC calls; and the EventBusProxy.unsubscribe method disregards the eventType parameter, causing incorrect handler removal for same-function multi-subscriptions. Four warnings and five info items are also reported.

## Critical Issues

### CR-01: Transport onMessage handler permanently overwritten during createWorker activation — all post-activation RPC messages silently dropped

**File:** `packages/core/worker-runtime/worker-manager.ts:552-582`

**Issue:**
In `WorkerManager.createWorker()`, the following sequence occurs:

1. Line 552: A message handler is registered via `transport.onMessage()` that routes ALL incoming messages to `serviceHost.handleMessage()`. This is the permanent RPC dispatch handler.
2. Line 557: `transport.postMessage({ type: 'activate', ... })` sends the activation signal to the Worker.
3. Lines 569-582: A **new** handler is registered via `transport.onMessage(onMsg)` to wait for the `'activated'` or `'error'` response. This **overwrites** the ServiceHost routing handler from step 1.
4. Lines 591-603: After the activation promise resolves, execution proceeds to `return { transport, serviceHost }` — but the handler set in step 3 is still active.
5. The activation-aware handler from step 3 only recognizes `'activated'` and `'error'` message types. Any subsequent `'invoke'`, `'subscribe'`, or `'unsubscribe'` messages from the Worker fall through all conditions and are **silently dropped**.

The RPC mechanism is rendered completely non-functional: the Worker can call service methods, but the responses (or any error results) are discarded by the wrong handler. The ServiceHost routing was permanently overwritten.

**Fix:**
Re-register the ServiceHost routing handler after the activation wait completes. There are two viable approaches:

**Approach A (restore after activation):**
```typescript
// After the activation wait (line 590), re-register the ServiceHost handler:
transport.onMessage((msg: unknown) => {
  serviceHost.handleMessage(msg, transport);
});
```
Insert this right before line 602 (`return { transport, serviceHost }`), after the activation promise resolves.

**Approach B (unified handler — preferred):**
Register a single handler upfront that both handles activation responses AND routes all messages to ServiceHost:
```typescript
// Replace lines 552-554 AND 569-582 with:
const activationPromise = new Promise<void>((resolve, reject) => {
  transport.onMessage((msg: unknown) => {
    const typed = msg as { type?: string };
    // Activation response handling
    if (typed.type === 'activated') {
      resolve();
      return;
    }
    if (typed.type === 'error') {
      reject(new WorkerActivateError(
        pluginId,
        (msg as { message?: string }).message ?? 'Unknown error',
      ));
      return;
    }
    // Route everything else to ServiceHost
    serviceHost.handleMessage(msg, transport);
  });
});
```

### CR-02: EventBusProxy.unsubscribe() ignores eventType parameter — incorrect handler removal for same-function multi-subscriptions

**File:** `packages/core/worker-runtime/service-proxy.ts:174-189`

**Issue:**
The `unsubscribe` method accepts `eventType` as a parameter but never uses it for filtering. It iterates ALL subscription entries in order and removes the first match by handler reference equality.

When the same handler function is registered for multiple event types (e.g., `eventBus.subscribe('lesson.created', handler)` and `eventBus.subscribe('lesson.updated', handler)`), calling `unsubscribe('lesson.created', handler)` may remove the `lesson.updated` entry instead of the `lesson.created` entry, depending on Map iteration order.

Additionally, the `eventType` parameter creates a misleading API contract — callers expect it to scope the unsubscription, but it is silently ignored.

**Fix:**
Track the mapping from event type to subId. Either store the event type alongside the handler in the subscription map, or maintain a reverse index:

```typescript
// Option: Store event type in the map value
private subscriptions = new Map<string, {
  eventType: string;
  handlers: Array<(event: any) => void>;
}>();

subscribe(eventType: string, handler: (event: any) => void): string {
  const subId = crypto.randomUUID();
  this.subscriptions.set(subId, { eventType, handlers: [handler] });
  this.transport.postMessage({ type: 'subscribe', subId, eventType });
  return subId;
}

unsubscribe(eventType: string, handler: (event: any) => void): void {
  for (const [subId, entry] of this.subscriptions) {
    if (entry.eventType !== eventType) continue;
    const idx = entry.handlers.indexOf(handler);
    if (idx !== -1) {
      entry.handlers.splice(idx, 1);
      if (entry.handlers.length === 0) {
        this.subscriptions.delete(subId);
        this.transport.postMessage({ type: 'unsubscribe', subId });
      }
      break;
    }
  }
}
```

## Warnings

### WR-01: Empty manifestCapabilities only blocks 'get' methods — non-empty capabilities grant unrestricted access to all service methods

**File:** `packages/core/worker-runtime/service-host.ts:236-246`

**Issue:**
The Phase 5 capability guard is an all-or-nothing check:
- Empty `manifestCapabilities` array: only `'get'` methods are allowed.
- Non-empty `manifestCapabilities` array: ALL methods on ALL services are permitted, including destructive operations (`delete`, `spawn`, `register`, `set`, etc.).

A plugin that declares even a single read capability (e.g., `lesson:read`) gains full write access to every registered service. This creates a false sense of security: the capability system appears to enforce restrictions but any declared capability trivially bypasses the only gate.

While the comment acknowledges "Full per-method capability mapping is deferred to a separate concern (Plan 6+)", the current state creates a security exposure where a minimally-capable plugin can call arbitrary service methods. This should be documented in a visible security note or gated behind an integration test that fails when the minimum capability set is violated.

**Fix:**
Either (a) implement per-method capability mapping now instead of deferring, or (b) explicitly document the limitation in the ServiceHost JSDoc and add an integration test that verifies the restriction behavior:

```typescript
/**
 * SECURITY NOTE (Phase 5): The current capability guard is coarse-grained.
 * An empty manifestCapabilities array blocks all non-get methods.
 * A non-empty array permits ALL methods on ALL registered services.
 * Per-method capability mapping is tracked in Plan 6.
 * Do not rely on this for production security boundaries.
 */
```

### WR-02: Race condition — 'deactivate-request' message silently dropped if received during activation

**File:** `packages/core/worker-runtime/worker-manager.ts:389-406`

**Issue:**
The generated bootstrap code registers the `deactivate-request` handler at line 389, which is INSIDE the `if (msg.type === 'activate')` block, after the plugin's `activate()` function has already been called. The primary message handler (line 331) does not handle `'deactivate-request'` messages — it only checks for `'event'`, invokeId matches, and `'activate'`.

If a `'deactivate-request'` message arrives between the time `'activate'` is sent and the time the nested handler is registered (a window that includes the full plugin activation duration including data URL import and `activate()` execution), the message falls through all conditions in the primary handler and is silently dropped.

In the current `WorkerManager` flow, `terminateWorker()` is never called before `createWorker()` completes, so this race is unlikely in normal operation. However, it creates a fragile design where a future caller could trigger it.

**Fix:**
Move the `deactivate-request` check into the primary message handler (line 331) rather than registering a nested listener:

```javascript
parentPort.on('message', async function(msg) {
  // 1. Forwarded events
  // 2. RPC result/error dispatch
  // ... (existing checks) ...

  // 3. Deactivate request — handled regardless of activation state
  if (msg.type === 'deactivate-request') {
    try {
      if (typeof plugin?.deactivate === 'function') {
        await plugin.deactivate();
      }
    } finally {
      pendingCalls.clear();
      if (eventBusProxy) {
        eventBusProxy.disposeAll();
        eventBusProxy = null;
      }
      parentPort.postMessage({ type: 'deactivated' });
    }
    return;
  }

  // 4. Activate message
  if (msg.type === 'activate') {
    // ... (existing activation logic, without nested listener) ...
  }
});
```

### WR-03: uninstallPlugin bypasses deactivatePlugin when worker mode — resourceTracker.disposeAll not called

**File:** `packages/core/plugin-host/index.ts:690-692`

**Issue:**
When `uninstallPlugin` encounters a worker-mode active plugin, it calls `deactivateWorker(pluginId)` directly on line 692 instead of `deactivatePlugin(pluginId)`. The `deactivatePlugin` method (inline mode) calls `this.resourceTracker.disposeAll(pluginId)` in its finally block (line 597), but `deactivateWorker` does not call `disposeAll` at all.

While `activateWorker` may not currently register resources with the ResourceTracker (it primarily relies on WorkerManager for cleanup), the inconsistency means:
1. If future changes register resources in `activateWorker`, `deactivateWorker` will leak them.
2. The error path in `activateWorker` (line 511) DOES call `disposeAll`, suggesting it was intended to be part of the cleanup contract.
3. This creates a maintenance trap where someone modifying `activateWorker` expects `deactivateWorker` to clean up the same resources.

**Fix:**
Add `this.resourceTracker.disposeAll(pluginId)` to `deactivateWorker`'s finally block:

```typescript
// In deactivateWorker, around line 649:
finally {
  this.resourceTracker.disposeAll(pluginId);  // add this
  this.pluginStates.set(pluginId, PluginState.INACTIVE);
  // ... rest of cleanup ...
}
```

### WR-04: DeactivateWorker redundantly performs state transitions already done by caller

**File:** `packages/core/plugin-host/index.ts:637-638`

**Issue:**
Both `deactivatePlugin` and `deactivateWorker` validate the state transition and set the state to `DEACTIVATING`. When called from `deactivatePlugin` (line 563: `return this.deactivateWorker(pluginId)`), the state was already set to `DEACTIVATING` at line 558. The duplicate operations at lines 636-637 in `deactivateWorker` are redundant.

When called from `uninstallPlugin` (line 692: `await this.deactivateWorker(pluginId)`), the state is `ACTIVE` and the transition validation succeeds correctly, but the state was already implicitly set by the guard (uninstallPlugin does not set `DEACTIVATING` — it expects `deactivateWorker` to do it). This inconsistency in call patterns makes the state tracking harder to reason about.

**Fix:**
Refactor so state transitions happen in ONE place. Either:
- Remove state transitions from `deactivateWorker` and ensure all callers handle them before calling, or
- Make `deactivateWorker` a standalone method (not called from `deactivatePlugin`) and keep its own state transitions, while having `deactivatePlugin` delegate to a shared cleanup method that does NOT manage state.

## Info

### IN-01: Incomplete type guard coverage in types.ts

**File:** `packages/core/worker-runtime/types.ts:213-243`

The file defines 11 message types across two unions (`WorkerMessage` with 6 types, `MainThreadMessage` with 5 types), but only provides 5 type guard functions: `isInvokeMessage`, `isSubscribeMessage`, `isResultMessage`, `isErrorMessage`, `isEventMessage`. Missing guards:

- `isUnsubscribeMessage`
- `isActivatedMessage`
- `isDeactivateMessage`
- `isLogMessage`
- `isDeactivateRequestMessage`
- `isActivateMessage`

While these are not currently used in conditional branches, they provide value as documentation and defensive assertions. Consider adding them for completeness.

### IN-02: EventForwarder.subscriptions Map has redundant outer key

**File:** `packages/core/event-forwarder.ts:65-70`

The `subscriptions` field is typed as `Map<string, Map<string, { ... }>>` where the outer key is `transport.id`. However, each `EventForwarder` instance is constructed with a single `IWorkerTransport` (line 76-79), and all operations use `this.transport.id` as the outer key. This means the outer Map always contains exactly one entry. The nested structure adds complexity without value.

Simplify to a flat `Map<string, { handler, unsubscribe }>` keyed directly by `subId`.

### IN-03: Flaky timing-based assertion in transport.test.ts

**File:** `packages/core/worker-runtime/__tests__/transport.test.ts:127`

```typescript
await new Promise((resolve) => setTimeout(resolve, 200));
expect(messages).toHaveLength(2);
```

The test relies on a 200ms timeout to wait for two echoed messages to arrive. On a heavily loaded or slow CI environment, this could be insufficient and produce intermittent failures.

**Fix:** Use a more deterministic waiting mechanism, such as awaiting both messages individually via Promises, or polling with a longer timeout.

### IN-04: WorkerManager.restoreWorkers() duplicates PluginHost.restoreActivePlugins() responsibility

**File:** `packages/core/worker-runtime/worker-manager.ts:628-658`

`WorkerManager.restoreWorkers()` independently queries the DB for `execution_mode = 'worker'` plugins and creates Workers for them. However, `PluginHost.restoreActivePlugins()` already handles this via `activatePlugin({ mode: 'worker' })` which delegates to `activateWorker` -> `WorkerManager.createWorker()`.

If both methods are called during server startup (as appears likely), each worker-mode plugin would have TWO Workers created for it, with the second creation throwing on the duplicate pluginId check. Either `restoreWorkers()` is dead code or there is a double-restoration path waiting to be triggered. Remove one.

### IN-05: WorkerRegistry.terminate accesses private transport field via type cast

**File:** `packages/core/worker-runtime/worker-manager.ts:163-165`

```typescript
const originalHandler = (
  instance.transport as unknown as { messageHandler?: (msg: unknown) => void }
).messageHandler;
```

This accesses a private field (`messageHandler`) on `NodeWorkerTransport` through a double type assertion (`as unknown as { messageHandler: ... }`). The value is never actually used (it is read but then discarded when `onMessage` is overwritten on line 167).

**Fix:** Remove the unused `originalHandler` assignment entirely. It serves no purpose in the current code path.

---

_Reviewed: 2026-06-18T08:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
