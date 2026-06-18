---
phase: 05-worker
plan: 02
subsystem: worker-runtime
tags:
  - rpc
  - proxy
  - capability-guard
  - di
  - worker-isolation
requires:
  - "05-01 (Transport foundation: types, errors, transports)"
provides:
  - "Worker-side transparent RPC Proxy (createMethodProxy, createServicesProxy)"
  - "Main-thread ServiceHost RPC handler with CapabilityGuard enforcement"
affects:
  - "05-03 (Worker lifecycle + PluginHost dual-mode)"
  - "05-04 (Event forwarding + integration tests)"
tech-stack:
  added:
    - "JavaScript Proxy for transparent RPC"
    - "crypto.randomUUID() for invokeId generation"
    - "structured clone error serialization with stack cap"
  patterns:
    - "Proxy get trap returning async invoke functions"
    - "PendingCall Map for request/response matching"
    - "manifestCapabilities length check as Phase 5 pragmatic capability guard"
    - "resolveByName fallback to Token-based resolve"
key-files:
  created:
    - packages/core/worker-runtime/service-proxy.ts
    - packages/core/worker-runtime/service-host.ts
    - packages/core/worker-runtime/__tests__/service-proxy.test.ts
    - packages/core/worker-runtime/__tests__/service-host.test.ts
decisions:
  - "Capability enforcement: empty manifestCapabilities blocks non-get methods (Phase 5 pragmatic rule)"
  - "Timeout: 30s default per-method call, configurable via createMethodProxy parameter"
  - "Error serialization: stack trace capped at 4096 characters"
  - "Service resolution: resolveByName preferred, fallback to Token construction for backward compatibility"
  - "Services object frozen with Object.freeze() to prevent tampering (context-builder.ts pattern)"
  - "onMessage single-listener: dispose registers no-op to clear"
metrics:
  duration: ~5m
  completed_at: "2026-06-18T22:12:00Z"
---

# Phase 05 Plan 02: Worker-side RPC Proxy + ServiceHost with CapabilityGuard

**One-liner:** Transparent JavaScript Proxy-based RPC layer with CapabilityGuard enforcement for Worker-to-main-thread service calls, enabling Worker-side plugin code to call services as if they were local while the actual execution happens on the main thread.

## Tasks

### Task 1: Worker-side service Proxy (createMethodProxy + createServicesProxy)

**Commit:** `5cdfdd7`

Created `service-proxy.ts` with two factory functions:
- **`createMethodProxy(transport, token, pendingCalls, timeoutMs?)`** — Returns a JavaScript Proxy where any property access returns an async function. When called, the function generates a `crypto.randomUUID()` invokeId, stores resolve/reject in the shared `pendingCalls` Map, and posts an `invoke` message via the transport. Supports configurable per-call timeout (default 30s) that rejects with `WorkerTimeoutError`.
- **`createServicesProxy(transport, serviceTokens)`** — Creates a shared `pendingCalls` Map, registers an `onMessage` handler that dispatches incoming `result`/`error` messages to matching pending calls, builds a frozen `services` object with Proxy-wrapped entries per token, and returns a `dispose` function that rejects all pending calls and clears the handler.

Key design decisions:
- Uses `crypto.randomUUID()` for invokeId generation (built-in, no dependency)
- `services` object frozen with `Object.freeze()` to prevent tampering
- `dispose()` rejects all pending calls with `WorkerTransportError('Transport disposed')`
- Timeout wraps resolve/reject to clear timeout timer on response arrival

**Tests:** 13 tests covering:
- Proxy returns callable functions for any property
- Invoke message structure (type, invokeId, token, method, args)
- Result message resolution
- Error message rejection (with correct error name/message reconstruction)
- Timeout with WorkerTimeoutError
- Zero timeout (timeoutMs=0) disables timeout
- Multi-token services object creation
- Services object freezing
- Dispose rejects all pending calls and clears state
- Concurrent invocation invokeId matching (3 calls, reverse order response)
- Mixed result/error for concurrent calls

### Task 2: ServiceHost RPC handler with CapabilityGuard

**Commit:** `4517333`

Created `service-host.ts` with the `ServiceHost` class:
- **Constructor** receives `ServiceRegistry`, `CapabilityGuard`, `pluginActorId`, `manifestCapabilities`
- **`handleMessage(msg, transport)`** — Dispatches based on `msg.type`: `invoke` routes to `handleInvoke`, `subscribe`/`unsubscribe` log warnings (Plan 4), `activated`/`deactivated` are silently acknowledged, unknown types ignored
- **`handleInvoke(msg, transport)`** — Core RPC handler: (1) capability check via manifestCapabilities length check (empty caps blocks non-get methods); (2) resolve service by token name via `resolveByName` (or Token fallback); (3) get and call method; (4) return result or serialized error
- **`get actorId()`** — Returns the plugin actor ID
- **`setManifestCapabilities(caps)`** — Updates capabilities dynamically

Key design decisions:
- Capability enforcement: empty `manifestCapabilities` blocks all methods except `'get'` (Phase 5 pragmatic rule), denied calls throw `WorkerCapabilityError`
- Error serialization preserves `code`, `message`, `stack` (capped at 4096 chars)
- Non-Error throws (e.g., string) are converted to Error gracefully
- `resolveService` tries `resolveByName` first (Plan 03), falls back to Token construction
- All errors caught with try/catch — handler never crashes the message loop

**Tests:** 14 tests covering:
- Basic invoke: service method called with correct args, result returned
- Method not found: error message with descriptive message
- Empty capabilities deny mutation methods (set)
- Empty capabilities allow get methods
- Non-empty capabilities allow all methods
- Error serialization with code, message, capped stack
- Non-Error throws handled gracefully
- Unknown message types silently ignored
- Activated/deactivated silently acknowledged
- Subscribe/unsubscribe triggers console.warn
- Invoke messages routed through handleInvoke
- actorId getter returns correct value
- setManifestCapabilities does not throw

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- **Type check:** `npx tsc --noEmit` — zero worker-runtime errors (only pre-existing error in esm-loader test fixture)
- **Unit tests:** 27 tests across 2 files, all passing
- **File constraints:** All files exceed minimum line counts and contain required patterns

## Success Criteria

- [x] `service-proxy.ts` exports `createMethodProxy` and `createServicesProxy` functions
- [x] `createServicesProxy` returns frozen services object with Proxy-wrapped entries per token
- [x] `service-host.ts` exports `ServiceHost` class with `handleMessage` dispatch
- [x] `ServiceHost.handleInvoke` resolves service, checks capabilities, executes method, returns result
- [x] CapabilityGuard enforcement is in place for Worker invokes with empty manifestCapabilities
- [x] All errors are serialized with code + message + stack (capped at 4096)
- [x] `service-proxy.test.ts` exists and covers all Proxy trap behaviors (13 tests)
- [x] `service-host.test.ts` exists and covers all ServiceHost behaviors (14 tests)
- [x] `npx tsc --noEmit` passes with zero worker-runtime errors

## Known Stubs

None.

## Threat Flags

None — all security-relevant surface matches the plan's `<threat_model>`.
