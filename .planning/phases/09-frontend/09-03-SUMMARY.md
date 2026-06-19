---
phase: 09-frontend
plan: 03
type: execute
wave: 2
depends_on: [01]
requirements: [PLUG-06]
tags: [worker-runtime, browser-worker, service-host, rpc, web-worker]
provides:
  - BrowserWorkerTransport (functional replacement for Phase 5 stub)
  - Frontend ServiceHost (RPC handler for Worker plugin invocations)
  - BrowserWorkerManager (Web Worker lifecycle: create/terminate/registry)
  - Worker bootstrap (self-contained ESM bootstrap for Worker context)
affects:
  - packages/core/worker-runtime/transport.ts
  - src/plugin-host/plugin-host.ts
tech-stack:
  added:
    - Browser Web Worker API (postMessage structured clone protocol)
    - ServiceProxy RPC pattern (Worker -> ServiceHost via postMessage)
  patterns:
    - Inline Worker bootstrap string (mirrors backend generateBootstrapCode)
    - Frontend ServiceHost mirrors backend pattern without CapabilityGuard
key-files:
  created:
    - src/plugin-host/browser-worker-transport.ts
    - src/plugin-host/browser-worker-manager.ts
    - src/plugin-host/service-host.ts
    - src/worker-bootstrap.ts
    - src/plugin-host/__tests__/browser-worker-transport.test.ts
    - src/plugin-host/__tests__/service-host.test.ts
  modified:
    - packages/core/worker-runtime/transport.ts
    - src/plugin-host/plugin-host.ts
decisions:
  - "Deactivate worker plugins via pluginModules.deactivate closure rather than branching in deactivatePlugin — keeps deactivation path unified across modes"
  - "Worker bootstrap code inlined as string literal in BrowserWorkerManager.buildWorkerBlobUrl(), mirroring backend's generateBootstrapCode() pattern"
  - "worker-bootstrap.ts exists as documentation reference only; runtime bootstrap is the inlined string"
metrics:
  duration: 3m
  completed: "2026-06-19T07:34:47Z"
---

# Phase 9 Plan 3: Browser Web Worker Complete Implementation Summary

**One-liner:** Replaced BrowserWorkerTransport stub, built frontend ServiceHost (RPC handler), BrowserWorkerManager (Web Worker lifecycle), and Worker bootstrap code with cross-Worker event forwarding.

## Objective

Complete Phase 5's deferred browser Worker support (D-07, D-08, D-09, D-10). Enable plugins to run in isolated Web Workers in the browser, communicating via postMessage ServiceProxy RPC.

## Tasks Completed

| #   | Name                                                  | Commit   | Files                                                                                                                                                                                                 |
| --- | ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Replace BrowserWorkerTransport stub                   | dd2073f  | `packages/core/worker-runtime/transport.ts`, `src/plugin-host/browser-worker-transport.ts`, `src/plugin-host/__tests__/browser-worker-transport.test.ts`                                             |
| 2   | Frontend ServiceHost + BrowserWorkerManager + bootstrap | 4f4b503  | `src/plugin-host/service-host.ts`, `src/plugin-host/browser-worker-manager.ts`, `src/worker-bootstrap.ts`, `src/plugin-host/__tests__/service-host.test.ts`                                         |
| 3   | Wire Worker-mode into FrontendPluginHost              | 9b8b013  | `src/plugin-host/plugin-host.ts`                                                                                                                                                                     |

## Task Details

### Task 1 — Replace BrowserWorkerTransport stub

- Replaced the Phase 5 stub (which threw `WorkerNotSupportedError` on all calls) with a functional implementation
- `postMessage` delegates to `Worker.postMessage()` with `WorkerTransportError` wrapping
- `onMessage` registers single listener via `worker.onmessage`
- `terminate()` calls `worker.terminate()`
- `worker.onerror` logs errors without blocking communication
- Frontend convenience re-export at `src/plugin-host/browser-worker-transport.ts`
- 11 tests passing with MockWorker

### Task 2 — Frontend ServiceHost + BrowserWorkerManager + Worker bootstrap

- **ServiceHost** — Main-thread RPC handler for Worker plugins:
  - `handleInvoke`: Resolves frontend service by token string via FrontendServiceRegistry, executes method, returns result/serialized error
  - Capability enforcement: empty `manifestCapabilities` blocks non-`get` methods
  - `handleSubscribe`: Creates Socket.IO listener via `ISocketService.on()`, forwards events via `transport.postMessage`
  - `handleUnsubscribe`: Removes listener via stored cleanup function
  - `dispose()`: Cleans up all event subscriptions (T-09-10)
- **BrowserWorkerManager** — Web Worker lifecycle manager:
  - `createWorker`: Creates Web Worker from Blob URL with `type: 'module'`, sets up Transport/ServiceHost, sends activate, waits 10s for 'activated' response
  - `terminateWorker`: Sends `deactivate-request`, waits 3s, terminates Worker in finally block
  - `MAX_WORKERS = 32` enforced at create time (T-09-09)
  - Worker bootstrap inlined as string literal (mirrors backend `generateBootstrapCode`)
- **worker-bootstrap.ts** — Reference documentation
- 16 ServiceHost tests passing

### Task 3 — Wire Worker-mode into FrontendPluginHost

- Added `FRONTEND_SERVICE_TOKENS` constant with all 4 frontend service tokens
- Added `private workerManager` field and `setWorkerManager()` setter
- `activatePlugin` now dispatches `'worker'` execution mode to private `activateWorkerPlugin`
- `activateWorkerPlugin`: Resolves ISocketService, calls `workerManager.createWorker()`, stores deactivate closure calling `workerManager.terminateWorker()`
- Existing `deactivatePlugin` remains unified — worker-mode teardown is encapsulated in the `pluginModules.deactivate` closure

## Verification

- [x] `npx vitest run src/plugin-host/__tests__/browser-worker-transport.test.ts` — 11/11 pass
- [x] `npx vitest run src/plugin-host/__tests__/service-host.test.ts` — 16/16 pass
- [x] `npx vitest run src/plugin-host/__tests__/plugin-host.test.ts` — 10/10 pass
- [x] All 5 plugin-host test suites: 61/61 pass

## Success Criteria

1. **BrowserWorkerTransport fully implements IWorkerTransport** — postMessage delegates to worker.postMessage, onMessage sets handler via worker.onmessage, terminate calls worker.terminate()
2. **Frontend ServiceHost handles invoke** — resolves service by token string, executes method, returns result/error; subscribe creates Socket.IO listener; dispose cleans up
3. **BrowserWorkerManager creates Web Workers** — Blob URL with `type: 'module'`, tracked in registry, max 32 Workers enforced
4. **Worker bootstrap code** — Activates plugin in Worker via inline bootstrap string, handles deactivate-request
5. **FrontendPluginHost supports worker-mode** — setWorkerManager setter, activateWorkerPlugin dispatches to BrowserWorkerManager
6. **All unit tests pass** — 61 tests across 5 suites

## Deviations from Plan

### Architectural Decision — Deactivation path unified

**Rule 2 applied:** The plan specified an explicit `if (this.workerManager && executionMode === 'worker')` branch in `deactivatePlugin`. Instead, the worker-mode deactivation is encapsulated via the `deactivate` closure in `pluginModules`:

```typescript
this.pluginModules.set(pluginId, {
  manifest,
  activate: async () => {},
  deactivate: async () => {
    await this.workerManager!.terminateWorker(pluginId);
  },
});
```

This keeps `deactivatePlugin` mode-agnostic — it always calls `instance.deactivate()` regardless of execution mode. The pattern is cleaner and maintains the existing method signature without adding execution-mode branching.

### Architectural Decision — Worker bootstrap inlined rather than loaded via Vite

The plan offered two approaches for loading `worker-bootstrap.ts`:
1. Use Vite's `new Worker(new URL('./worker-bootstrap.ts', import.meta.url))`
2. Inline the bootstrap as a string literal

Option 2 was chosen (matching the backend's `generateBootstrapCode()` pattern) because Vite's Worker URL handling is dev-only and would require separate bundling for production. The inline string approach is self-contained and works identically in dev and production.

## Known Stubs

None.

## Threat Flags

None — all new surface is covered by the plan's threat model:
- T-09-07 (Tampering): ServiceHost validates message.type before dispatch; unknown types silently ignored
- T-09-08 (Elevation): Empty manifestCapabilities blocks non-'get' methods
- T-09-09 (DoS): MAX_WORKERS = 32 enforced at createWorker time
- T-09-10 (Tampering): terminateWorker calls serviceHost.dispose() before Worker termination
- T-09-12 (Leak): Blob URLs cleaned up via try/finally in bootstrap

## Recommendations for Downstream

1. **Plan 09-04** should add integration tests that exercise the full Worker activation/deactivation flow end-to-end in a browser-like environment (jsdom + mock Worker)
2. The `worker-bootstrap.ts` file at `src/worker-bootstrap.ts` serves as documentation — consider removing it in 09-04 if the inlined bootstrap is deemed sufficient
3. `FrontendPluginHost.installPlugin` currently hardcodes `executionMode: 'inline'` — a follow-up should accept executionMode parameter when the CLI/server-side install provides it
4. **Deferred:** `BrowserWorkerManager.buildWorkerBlobUrl()` could be optimized with a cached Blob URL rather than creating a new one per Worker instance

## Self-Check: PASSED

- [x] File `packages/core/worker-runtime/transport.ts` — modified (dd2073f)
- [x] File `src/plugin-host/browser-worker-transport.ts` — created (dd2073f)
- [x] File `src/plugin-host/browser-worker-manager.ts` — created (4f4b503)
- [x] File `src/plugin-host/service-host.ts` — created (4f4b503)
- [x] File `src/worker-bootstrap.ts` — created (4f4b503)
- [x] File `src/plugin-host/__tests__/browser-worker-transport.test.ts` — created (dd2073f)
- [x] File `src/plugin-host/__tests__/service-host.test.ts` — created (4f4b503)
- [x] File `src/plugin-host/plugin-host.ts` — modified (9b8b013)
- [x] Commit dd2073f exists
- [x] Commit 4f4b503 exists
- [x] Commit 9b8b013 exists
- [x] 61 tests pass across 5 test suites
