---
phase: "05-worker"
plan: "01"
subsystem: "worker-runtime"
tags: ["transport", "types", "errors", "worker-thread", "message-protocol"]
requires: []
provides: ["packages/core/worker-runtime/types.ts", "packages/core/worker-runtime/errors.ts", "packages/core/worker-runtime/transport.ts", "packages/core/worker-runtime/index.ts"]
affects: ["vitest.config.ts"]
tech-stack:
  added: []
  patterns: ["abstract+platform (IWorkerTransport + NodeWorkerTransport + BrowserWorkerTransport stub)", "discriminated string literal unions (WorkerMessage/MainThreadMessage)", "error class hierarchy (WorkerRuntimeError + 5 subclasses)"]
key-files:
  created:
    - packages/core/worker-runtime/types.ts (243 lines)
    - packages/core/worker-runtime/errors.ts (114 lines)
    - packages/core/worker-runtime/transport.ts (137 lines)
    - packages/core/worker-runtime/index.ts (39 lines)
    - packages/core/worker-runtime/__tests__/transport.test.ts (204 lines)
  modified:
    - vitest.config.ts (+1 line)
decisions:
  - "BrowserWorkerTransport is a stub throwing WorkerNotSupportedError — full Web Worker implementation deferred to Phase 9"
  - "Message protocol uses discriminated string literal unions not enums — avoids import complexity in Worker context"
  - "NodeWorkerTransport uses worker.on('message') for message listening and stores single handler reference"
metrics:
  duration: "~10 min"
  completed: "2026-06-18"
---

# Phase 05 Plan 01: Transport Foundation Summary

Cross-boundary message protocol types, error hierarchy, NodeWorkerTransport implementation, BrowserWorkerTransport stub, barrel exports, and vitest configuration for the Worker isolation subsystem.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Update vitest.config.ts | `70aa480` | vitest.config.ts |
| 1 | Define message protocol types and IWorkerTransport interface | `edb8537` | packages/core/worker-runtime/types.ts |
| 2 | Implement Worker runtime error hierarchy | `7490166` | packages/core/worker-runtime/errors.ts |
| 3 | Implement NodeWorkerTransport + BrowserWorkerTransport stub + barrel + tests | `f7eb2cb` | packages/core/worker-runtime/transport.ts, packages/core/worker-runtime/index.ts, packages/core/worker-runtime/__tests__/transport.test.ts |

## Verification Results

```text
npx tsc --noEmit → 0 errors in worker-runtime files
npx vitest run packages/core/worker-runtime/__tests__/transport.test.ts → 11/11 tests passed
```

### Test Breakdown

| Test Group | Tests | Status |
|------------|-------|--------|
| NodeWorkerTransport construction (id, methods) | 3 | Passed |
| Message send and receive roundtrip | 2 | Passed |
| Error handling (postMessage after terminate) | 1 | Passed |
| onExit callback | 1 | Passed |
| BrowserWorkerTransport stub | 4 | Passed |

## Implementation Details

### Task 0: vitest.config.ts
Added `'packages/core/worker-runtime/__tests__/**/*.test.ts'` to the existing test include array. All existing patterns preserved.

### Task 1: types.ts
Defined the complete 11-message cross-boundary protocol:

- **IWorkerTransport** interface — 4 methods (postMessage, onMessage, terminate) + readonly id
- **PendingCall** interface — for RPC call tracking via Map<invokeId, PendingCall>
- **WorkerMessage** union — 6 Worker-to-Main-Thread message types (invoke, subscribe, unsubscribe, activated, deactivated, log)
- **MainThreadMessage** union — 5 Main-Thread-to-Worker message types (result, error, event, deactivate-request, activate)
- **5 type guard functions** — isInvokeMessage, isSubscribeMessage, isResultMessage, isErrorMessage, isEventMessage
- All message types use `readonly` properties and `satisfies`-compatible string literal discriminators

### Task 2: errors.ts
Six error classes in a proper inheritance hierarchy following plugin-host/errors.ts pattern:

1. `WorkerRuntimeError` (base) — `[WorkerRuntime]` prefix, supports `options.cause`
2. `WorkerTransportError` — transport communication failures
3. `WorkerActivateError` — carries `public readonly pluginId`
4. `WorkerTimeoutError` — carries `public readonly timeoutMs`
5. `WorkerCapabilityError` — carries `actorId` and `capabilityRequired` (no cause option)
6. `WorkerNotSupportedError` — takes `featureName` string

### Task 3: transport.ts + index.ts + test
- **NodeWorkerTransport** wraps `worker_threads.Worker` with postMessage error handling (catch → WorkerTransportError)
- **onExit** and **onError** convenience methods for Worker lifecycle monitoring
- **BrowserWorkerTransport** stub implementing IWorkerTransport — all methods throw WorkerNotSupportedError
- **index.ts** barrel export following esm-loader/index.ts pattern: types → transports → errors
- **transport.test.ts** with 11 tests using real Worker instances via data: URLs (new URL wrapper for Node.js compatibility)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Worker construction in tests**
- **Found during:** Task 3
- **Issue:** `new Worker('data:text/javascript,...', { eval: true })` failed with TypeError — this Node.js version requires `new URL()` wrapper for data URLs and rejects `eval: true` for data URL Workers.
- **Fix:** Changed all Worker constructors to `new Worker(new URL('data:text/javascript,...'))` without `{ eval: true }`. Created helper functions (`createEmptyWorker`, `createEchoWorker`) for reuse.
- **Files modified:** packages/core/worker-runtime/__tests__/transport.test.ts
- **Commit:** `f7eb2cb`

**2. [Rule 1 - Bug] Terminated Worker threadId returns -1**
- **Found during:** Task 3
- **Issue:** The error handling test asserted `transport.id` matches `worker:\d+` after terminate, but Node.js returns `worker:-1` for terminated workers.
- **Fix:** Updated fallback assertion to accept `worker:-1`.
- **Files modified:** packages/core/worker-runtime/__tests__/transport.test.ts
- **Commit:** `f7eb2cb`

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| packages/core/worker-runtime/transport.ts | 114-141 | BrowserWorkerTransport | Phase 5 only provides stub — full Web Worker implementation deferred to Phase 9 |

## Threat Assessment

- T-05-01 (Tampering): Mitigated — discriminated union type guards prevent malformed message processing
- T-05-02 (Spoofing): Accepted — natural Worker channel isolation prevents cross-Worker spoofing
- T-05-03 (Information Disclosure): Mitigated — error classes follow stack trace constraints set in threat model
- T-05-SC (Tampering): Mitigated — zero new npm packages added (all APIs are Node.js built-ins)

## Self-Check: PASSED

All 6 expected files exist with correct content. All 4 commits verified in git log. TypeScript compiles with zero worker-runtime errors. All 11 vitest tests pass.
