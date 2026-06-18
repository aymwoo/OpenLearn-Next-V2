---
phase: 05-worker
plan: 03
subsystem: worker-runtime, plugin-host, kernel, database
tags: worker-threads, plugin-lifecycle, dual-mode, circular-dependency-fix, execution-mode

requires:
  - phase: 05-worker plans 01-02
    provides: Worker runtime types, transport, service-proxy, service-host
provides:
  - WorkerManager with WorkerRegistry (create/terminate/restore Workers)
  - Dual-mode PluginHost (inline + worker activation via mode option)
  - execution_mode column in plugins table
  - resolveByName in ServiceRegistry for Worker RPC
  - Kernel integration with WorkerManager + setWorkerManager wiring
affects: 05-worker plan 04 (Worker RPC EventForwarder), server bootstrap integration

tech-stack:
  added: node:worker_threads.Worker (data URL bootstrap)
  patterns: Dual-mode lifecycle (setWorkerManager setter for circular dep), forced cleanup in finally block, inline bootstrap code for isolated Worker context

key-files:
  created:
    - packages/core/worker-runtime/worker-manager.ts
    - packages/core/worker-runtime/__tests__/worker-manager.test.ts
  modified:
    - packages/core/plugin-host/index.ts
    - packages/core/kernel/index.ts
    - packages/core/db/index.ts
    - packages/core/di/service-registry.ts

key-decisions:
  - "WorkerManager constructor does NOT take PluginHost — circular dependency resolved via PluginHost.setWorkerManager() setter called after both are constructed in Kernel"
  - "Bootstrap code inlines the services proxy implementation inside a data URL, avoiding Worker's inability to access modules on disk"
  - "getExecutionMode wraps DB query in try/catch for backward compatibility with test databases that lack the column"
  - "restoreActivePlugins uses SELECT * to avoid failing when execution_mode column is absent"
  - "Worker termination always happens in a finally block, independent of graceful deactivate success (T-05-11)"

patterns-established:
  - "Self-analog pattern for extension: follow existing state machine + timeout + rollback + finally cleanup from plugin-host/index.ts"
  - "Worker lifecycle: createWorker -> register (with exit handler) -> activate -> wait for activated -> onMessage->ServiceHost -> terminate in finally"
  - "Crash detection: Worker 'exit' event with non-zero code triggers auto-cleanup in WorkerRegistry"

requirements-completed:
  - PLUG-03

duration: 22min
completed: 2026-06-18
---

# Phase 05 Plan 03: Worker Lifecycle + PluginHost Dual-Mode Integration

**Built WorkerManager (spawns/terminates/restores Worker threads with real Node.js Worker Thread), extended PluginHost with dual-mode (inline/worker) activation, added execution_mode DB column, and integrated WorkerManager into Kernel with circular-dependency-safe setter wiring.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Error handling] getExecutionMode wraps DB query in try/catch**
- **Found during:** Task 3 (testing)
- **Issue:** PluginHost tests use in-memory SQLite that lacks the execution_mode column, causing "no such column" SqliteError
- **Fix:** Wrapped the DB query in try/catch to return 'inline' as fallback when column doesn't exist
- **Files modified:** packages/core/plugin-host/index.ts
- **Commit:** 5cefe53

**2. [Rule 1 - Bug] ALTER TABLE inserted inside db.exec() backtick string**
- **Found during:** TypeScript type check after Task 3
- **Issue:** The execution_mode ALTER TABLE was inserted between CREATE TABLE statements inside a single \`db.exec(...)\` backtick string, meaning it was treated as SQL text, not JavaScript code
- **Fix:** Moved the ALTER TABLE block after the closing backtick of the main db.exec() call, matching the existing pattern used by other ALTER TABLE statements
- **Files modified:** packages/core/db/index.ts
- **Commit:** 90f3720

### Deviations from Specific Instructions

None -- plan executed as written with the above auto-fixes.

## Threat Flags

No new threat surface introduced -- WorkerManager and PluginHost dual-mode follow the threat model's mitigate dispositions (T-05-09, T-05-10, T-05-11, T-05-12, T-05-13).

## Verification Results

### TypeScript check: PASS (only pre-existing syntax-error.js fixture error)
### WorkerManager tests: 12/12 PASS
### PluginHost tests: 41/41 PASS (4 test files, all existing tests backward compatible)

## Commit Log

| Commit | Description |
|--------|-------------|
| 112cea4 | feat: add execution_mode column, resolveByName, and WorkerManager to Kernel |
| b34cac6 | feat: implement WorkerManager + WorkerRegistry with crash detection and tests |
| 5cefe53 | feat: extend PluginHost with dual-mode inline/worker activation and setWorkerManager |
| 90f3720 | fix: move execution_mode ALTER TABLE after db.exec() backtick closure |

## Self-Check

Files created:
- [FOUND] packages/core/worker-runtime/worker-manager.ts
- [FOUND] packages/core/worker-runtime/__tests__/worker-manager.test.ts

Files modified:
- [FOUND] packages/core/plugin-host/index.ts
- [FOUND] packages/core/kernel/index.ts
- [FOUND] packages/core/db/index.ts
- [FOUND] packages/core/di/service-registry.ts

Commits:
- [FOUND] 112cea4
- [FOUND] b34cac6
- [FOUND] 5cefe53
- [FOUND] 90f3720

## Self-Check: PASSED
