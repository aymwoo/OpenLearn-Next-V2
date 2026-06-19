---
phase: 08-migration
plan: 03
subsystem: kernel
tags: [plugin-migration, di, ai, legacy-cleanup, plugin-host]
completed: 2026-06-19T06:48:03Z
duration: "0m 55s"
commits:
  - hash: 235ffc2
    message: "feat(08-migration): declare IPluginHostToken and implement PluginHost.togglePlugin()"
  - hash: e724964
    message: "feat(08-migration): refactor AiPlannerPlugin as ESM+Token DI plugin"
  - hash: e74acd5
    message: "feat(08-migration): refactor AiSubmitInjectorPlugin as ESM+Token DI plugin"
  - hash: 3e50a18
    message: "feat(08-migration): delete legacy plugin-runtime and cleanup kernel/server"
tasks: { total: 4, completed: 4 }
key-files:
  created:
    - packages/plugins/__tests__/ai-planner.test.ts
    - packages/plugins/__tests__/ai-submit-injector.test.ts
    - packages/core/__tests__/legacy-cleanup.test.ts
  deleted:
    - packages/core/plugin-runtime/index.ts
  modified:
    - packages/core/di/interfaces.ts
    - packages/core/di/index.ts
    - packages/core/plugin-host/index.ts
    - packages/core/kernel/index.ts
    - packages/plugins/ai-planner.ts
    - packages/plugins/ai-submit-injector.ts
    - server.ts
key-decisions:
  - "D-04: AI Planner and AI Submit Injector activation failures are Soft fail (log and bypass)"
  - "D-13: Wave 3 - AI helper plugins migration and physical deletion of plugin-runtime VM sandbox"
tech-stack:
  added: []
  patterns:
    - Soft fail strategy for application-level AI plugins
    - Token DI resolution of PluginHost inside plugin context
    - Physical deletion of legacy vm-based sandboxing environment
---

# Phase 08 Plan 03: AI Plugins Migration & Legacy Cleanup

**Objective:** Refactor AI Planner and AI Submit Injector plugins to ESM+Token DI, implement `PluginHost.togglePlugin()`, register `IPluginHostToken` in ServiceRegistry, and physically delete the legacy `plugin-runtime` VM sandbox.

## Task Completion

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | Declare IPluginHostToken and implement togglePlugin() | interfaces.ts, di/index.ts, plugin-host/index.ts | 235ffc2 |
| 2 | Refactor AiPlannerPlugin as ESM+Token DI | ai-planner.ts, __tests__/ai-planner.test.ts | e724964 |
| 3 | Refactor AiSubmitInjectorPlugin as ESM+Token DI | ai-submit-injector.ts, __tests__/ai-submit-injector.test.ts | e74acd5 |
| 4 | Delete legacy plugin-runtime and cleanup kernel/server | kernel/index.ts, server.ts, plugin-runtime/, __tests__/legacy-cleanup.test.ts | 3e50a18 |

## What Was Built

### Task 1 — IPluginHostToken + togglePlugin()

- **`IPluginHostToken`** declared in `interfaces.ts` with identifier `@openlearn/core:IPluginHost`, re-exported from `di/index.ts`
- **`PluginHost.togglePlugin(pluginId)`** implemented: reads current `status` from DB, delegates to `activatePlugin()` or `deactivatePlugin()`, updates DB to `active` or `disabled`. Supports both inline and worker-mode plugins transparently.
- Registered in Kernel constructor: `serviceRegistry.register(IPluginHostToken, this.pluginHost)`

### Task 2 — AiPlannerPlugin Refactored

- Converted from legacy `bootstrapAIPlannerPlugins()` function to `AiPlannerPlugin` config object with `manifest` and `activate(ctx)`/`deactivate()`
- Dependencies resolved via `ctx.resolve(IDatabaseToken)` and `ctx.services` (ServiceRegistry)
- Registers:
  - Process handler for `ai_planner_task` (background generation with kill support)
  - Action + handler for `ai.start_generation` (spawn AI planning process)
  - Action + handler for `ai.apply_recommendation` (high-risk, applies lesson/quiz/schedule)
  - Action + handler for `ai.apply_grade` (high-risk, grade assignments via AI)
- Test verifies action registration and command execution flow

### Task 3 — AiSubmitInjectorPlugin Refactored

- Added `AiSubmitInjectorPlugin` config object alongside existing helper exports (`hasDataSubmission`, `hasScoreDisplay`, `injectScoreSubmissionUsingAI`, `cleanHtmlOutput`)
- Subscribe to `courseware.uploaded` event; when HTML has score display but no submission logic, calls `aiService.generateText()` to inject LMS submit code
- Creates `[自动提交版]` courseware copies
- Test verifies end-to-end event-driven injection flow

### Task 4 — Legacy PluginRuntime Deleted

- **Physically deleted** `packages/core/plugin-runtime/index.ts` (666-line VM sandbox with API wrappers, timeout protection, prototype freezing)
- **Kernel cleaned up:**
  - `PluginRuntime` import removed
  - `public readonly pluginRuntime` property removed
  - Constructor instantiation removed
  - `bootstrapSystemPlugins()` expanded to register all 6 core plugins: VFS, Process, Management, Builtin, AI Planner, AI Submit Injector
  - Non-critical AI plugins use soft-fail (`try/catch` with `console.warn`)
  - External ZIP plugin seeding from `dist/plugins/` retained (Wave 4)
- **Server.ts cleaned up:**
  - Five `bootstrap*()` import lines removed
  - Five bootstrap function call invocations removed
  - `kernelContainer.pluginRuntime.loadFromDB()` + default Quiz plugin fallback removed (Kernel now handles bootstrap via `await kernelContainer.ready`)
- **Legacy cleanup test** validates: directory deleted, no `pluginRuntime` on Kernel, all 6 system plugins active

## Verification Results

| Criterion | Status |
|-----------|--------|
| `packages/core/plugin-runtime/` directory physically deleted | Passed |
| Kernel has no `pluginRuntime` reference | Passed |
| Kernel auto-loads 6 core plugins on startup | Passed |
| `IPluginHostToken` registered in ServiceRegistry | Passed |
| `togglePlugin()` toggles active/disabled correctly | Passed |
| `AiPlannerPlugin` action registration works | Passed (test) |
| `AiSubmitInjectorPlugin` event subscription works | Passed (test) |
| AI plugin soft-fail on activation error | Passed (code path) |
| All test files pass | Passed (5/5 tests) |

## Deviations from Plan

**None.** The plan was executed exactly as written. All 4 tasks were implemented, verified, and committed atomically.

## Known Stubs

None identified.

## Threat Flags

None identified — all network endpoints and auth paths are pre-existing.

## Self-Check: PASSED

- [x] `packages/core/di/interfaces.ts` — contains `IPluginHostToken`
- [x] `packages/core/plugin-host/index.ts` — contains `togglePlugin()`
- [x] `packages/plugins/ai-planner.ts` — exports `AiPlannerPlugin`
- [x] `packages/plugins/ai-submit-injector.ts` — exports `AiSubmitInjectorPlugin` + helper functions
- [x] `packages/core/plugin-runtime/` — directory removed
- [x] `packages/core/kernel/index.ts` — no `pluginRuntime` references
- [x] `server.ts` — no `pluginRuntime` or bootstrap function calls
- [x] Commit `235ffc2` exists
- [x] Commit `e724964` exists
- [x] Commit `e74acd5` exists
- [x] Commit `3e50a18` exists
