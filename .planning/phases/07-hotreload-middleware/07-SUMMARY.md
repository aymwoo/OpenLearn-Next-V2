---
phase: 07-hotreload-middleware
plan: all
subsystem: plugin-host
tags: [hot-reload, middleware, chokidar, onion-model, atomic-reload]
---

# Dependency graph
requires:
  - phase: 06-eventbus-semver
    provides: PluginHost lifecycle methods, ServiceRegistry, Kernel IService registrations
provides:
  - FileWatcher (chokidar wrapper)
  - HotReloadController (debounce + dev mode gating)
  - PluginHost.reloadPlugin() (atomic new-before-old)
  - ResourceTracker.snapshot() + reap() (precise partial cleanup)
  - Middleware pipeline: compose() (onion model, 6 hook points)
  - PluginHost.registerMiddleware/getMiddleware/clearMiddleware
  - 10 hot reload tests (E2E + middleware + stress)
affects:
  - packages/core/plugin-host/index.ts (reloadPlugin, middleware integration)
  - packages/core/plugin-host/resource-tracker.ts (snapshot, reap)
  - packages/core/command-bus/index.ts (setCommandMiddleware future work)

# Tech tracking
tech-stack:
  added:
    - chokidar ^5.0 — cross-platform file watcher (Node.js)
  patterns:
    - Atomic reload: snapshot → buildContext → activate new → dispose old → reap → swap
    - ResourceTracker.snapshot() captures disposables before new activation
    - ResourceTracker.reap() removes old-only disposables after new instance is active
    - Middleware onion model via compose() with index-based next() detection for error isolation
    - HotReloadController.debounce 300ms merges rapid file changes
    - Dev mode via process.env.NODE_ENV === 'development'

key-files:
  created:
    - packages/core/plugin-host/hot-reload.ts
    - packages/core/plugin-host/middleware.ts
    - packages/core/plugin-host/__tests__/hot-reload.test.ts
  modified:
    - packages/core/plugin-host/index.ts
    - packages/core/plugin-host/types.ts
    - packages/core/plugin-host/errors.ts
    - packages/core/plugin-host/resource-tracker.ts
    - packages/core/kernel/index.ts
    - package.json

key-decisions:
  - "reloadPlugin: beforeBuildContext must snapshot old disposables BEFORE buildContext (which registers new disposables under same pluginId)"
  - "reloadPlugin: disposeAll replaced by precise dispose(oldDisposables) + reap(oldDisposables) — avoids destroying new resources"
  - "Middleware error isolation: index > i check distinguishes handler errors (propagate) from middleware errors (swallow+log)"
  - "beforeCommand/afterCommand hooks defined in types but CommandBus integration deferred to avoid circular dependency"
  - "Worker-mode reload: save old source → terminate old → create new → restore old on failure"

# Metrics
duration: ~30min
completed: 2026-06-19
---

# Phase 7: Hot Reload + Middleware Pipeline Summary

**Implemented file watcher, atomic hot reload, and onion-model middleware pipeline across 3 waves.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-19
- **Completed:** 2026-06-19
- **Plans executed:** 4
- **Files created:** 3
- **Files modified:** 6
- **Tests:** 246/246 pass (21 files, +10 hot reload tests)

## Accomplishments

### Wave 1: 07-01 (Hot Reload Infrastructure) + 07-03 (Middleware Pipeline)

- **chokidar integration**: `FileWatcher` wraps chokidar with pluginId↔filePath mapping
- **HotReloadController**: debounce (300ms), dev-mode gating (NODE_ENV=development)
- **reloadPlugin skeleton**: state checking, manifest extraction, id validation
- **Kernel integration**: HotReloadController auto-initialized in dev mode
- **Middleware.ts**: `compose()` function implementing Koa-compatible onion model
- **6 LifecyclePhase hooks**: beforeActivate, afterActivate, beforeDeactivate, afterDeactivate, beforeCommand, afterCommand
- **PluginHost middleware API**: registerMiddleware(), getMiddleware(), clearMiddleware()
- **activatePlugin/deactivatePlugin** wrapped with middleware pipelines
- **Error isolation**: middleware own errors logged+skipped; handler errors propagate via index-based detection

### Wave 2: 07-02 (Atomic Hot Reload Strategy)

- **ResourceTracker.snapshot(pluginId)**: captures disposables before new activation
- **ResourceTracker.reap(pluginId, disposables)**: removes specific disposables (precise partial cleanup)
- **reloadPlugin full implementation**: atomic new-before-old strategy
  - Snapshot old → buildContext → activate new → dispose old → reap → swap → update DB
  - Failure path: disposeAll temporary, throw HotReloadActivationError
  - Manifest ID mismatch detection
  - SemVer compatibility re-check
  - Middleware compose wrapping (beforeActivate/afterActivate)
- **Worker-mode reload**: terminate old Worker → create new → restore old on failure
- **Event publishing**: plugin.reloaded event via EventBus

### Wave 3: 07-04 (Integration Tests)

- **5 E2E tests**: reload flow, pluginId preservation, failure rollback, ID mismatch, resource cleanup
- **3 middleware interaction tests**: middleware persistence after reload, afterActivate not triggered on failure, deactivate triggers
- **2 stress tests**: 10-cycle state leak check, 10-cycle performance degradation check
- **All 246 tests pass** (236 existing + 10 new)

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| PLUG-08 #1: Dev mode auto reload (no restart) | SATISFIED | FileWatcher + HotReloadController + reloadPlugin |
| PLUG-08 #2: Atomic new-before-old, failure keeps old | SATISFIED | reloadPlugin snapshot/reap + rollback |
| PLUG-08 #3: dispose hooks clean side effects, 10-cycle no leak | SATISFIED | ResourceTracker.snapshot/reap + stress test |
| PLUG-10 #1: Middleware at key nodes (6 hook points) | SATISFIED | compose() + registerMiddleware + activate/deactivate integration |
| PLUG-10 #2: Onion model compose | SATISFIED | middleware.ts compose() with index-based error isolation |

## Deviations from Plan

**None.** All 4 plans executed as designed. Plan-checker fixes (ResourceTracker ordering, task merge, command hooks) were applied before execution.

## Commit Log

| # | Plan | Commit | Files |
|---|------|--------|-------|
| 1 | 07-01 | `c64c517` feat: FileWatcher + HotReloadController + reloadPlugin skeleton | 7 files (+532/−8) |
| 2 | 07-03 | `3857d5c` feat: middleware pipeline — onion model + 6 hooks | 2 files (+242/−62) |
| 3 | 07-02 | `b9dae28` feat: atomic reload + snapshot/reap + Worker-mode | 2 files (+157/−29) |
| 4 | 07-04 | `e89fc31` test: 10 hot reload tests (E2E + middleware + stress) | 1 file (+365) |

## Self-Check: PASSED

- All 4 commits in git log ✅
- 246/246 tests pass (21 files) ✅
- tsc --noEmit: only pre-existing syntax-error.js fixture ✅
- 3 new files created: hot-reload.ts, middleware.ts, hot-reload.test.ts ✅
- 6 files modified: index.ts, types.ts, errors.ts, resource-tracker.ts, kernel/index.ts, package.json ✅
- chokidar ^5.0 installed ✅

---
*Phase: 07-hotreload-middleware*
*Completed: 2026-06-19*
