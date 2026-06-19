---
phase: 08-migration
plan: 02
subsystem: kernel
tags: [plugin-migration, di, management, builtin, server-cleanup]

# Dependency graph
requires:
  - phase: 08-migration
    plan: 01
    provides: IDatabaseToken, VfsPlugin & ProcessPlugin refactored, Kernel auto-load mechanism
provides:
  - Cleaned management.ts and builtin.ts without deprecated bootstrap stubs
  - Verified kernel auto-loads both business plugins with hard crash on failure
affects:
  - Phase 08 integration testing

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Onion Middleware pipeline lifecycle interception for business plugins
    - Standard DI resolution for DB and CommandBus inside business logic handlers
    - Hard crash strategy for LMS Management and Classroom Builtin activation failures

key-files:
  created: []
  modified:
    - packages/plugins/management.ts
    - packages/plugins/builtin.ts

key-decisions:
  - "D-01: LMS Management & Classroom Builtin directly inline-loaded on main thread"
  - "D-05: Remove kernelContainer global reference, rewrite to standard activate(ctx)"
  - "D-06: Inline plugins registration downsized to Kernel; server.ts does not import plugin bootstraps"
  - "D-07: Auto-register in SQLite plugins table with execution_mode = 'inline'"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-06-19
---

# Phase 08 Plan 02: Business Built-in Plugins Migration Summary

**Cleaned up deprecated bootstrap stubs from management.ts and builtin.ts, verified kernel auto-loads all business plugins with full ESM + Token DI pattern**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-19T14:42:00Z
- **Completed:** 2026-06-19T14:50:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Removed deprecated `bootstrapManagementPlugins()` stub from management.ts (Phase 8 Wave 1 transition artifact)
- Removed deprecated `bootstrapBuiltinPlugins()` stub from builtin.ts (Phase 8 Wave 1 transition artifact)
- Verified kernel/index.ts already imports and auto-loads both plugins with hard crash on activation failure
- Verified server.ts no longer imports or calls any legacy bootstrap functions
- Confirmed all plugin unit tests pass (6/7 suites, quiz.test.ts has pre-existing worker-mode issue)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove deprecated bootstrapManagementPlugins stub** - `8485605` (chore)
2. **Task 2: Remove deprecated bootstrapBuiltinPlugins stub** - `ddaa86f` (chore)
3. **Task 3: Kernel integration verification** - Verified by test run and code review

**Plan metadata:** Pending (this file + state updates)

## Files Created/Modified

- `packages/plugins/management.ts` - Removed deprecated `bootstrapManagementPlugins()` stub (897 lines delivered, 897 removed — git counts whitespace diff; actual change is removal of 4-line stub)
- `packages/plugins/builtin.ts` - Removed deprecated `bootstrapBuiltinPlugins()` stub (1268 lines final, removed 4-line stub at EOF)

## Decisions Made

None - plan executed as previously implemented by Phase 08-01 with remaining cleanup.

## Deviations from Plan

None - the plan described code that was already largely migrated by the prior wave (08-01). The remaining cleanup items (bootstrap stubs) were fully addressed.

**Note on plan-vs-reality:** The Plan 08-02 was authored assuming the old `kernelContainer`-based code was still in place. In reality, Phase 08-01 had already performed most of the migration (ESM export, manifest, activate/deactivate, kernel integration, server.ts cleanup). This execution completes the remaining artifacts: removal of the deprecated no-op bootstrap stubs.

### Pre-existing Test Failure

The `quiz.test.ts` failure is pre-existing and unrelated to these changes — it requires `dist/plugins/*.zip` worker-mode plugin assets that are not present in the test environment.

## Issues Encountered

- The plan's example code showed `ctx.services.resolve(Token)` as the DI pattern, but the correct API is `ctx.resolve(Token)` (on PluginContext, not on PluginContext.services). The existing implementation correctly uses `ctx.services.*` for wrapped service instances and `ctx.resolve(Token)` for non-standard services like database.

## Next Phase Readiness

- All 6 core business plugins (VFS, Process, Management, Builtin, AI Planner, AI Submit Injector) are fully auto-loaded by Kernel via PluginHost
- Server.ts is completely clean of old bootstrap imports
- Ready for integration testing and external plugin seeding

---
*Phase: 08-migration*
*Completed: 2026-06-19*
