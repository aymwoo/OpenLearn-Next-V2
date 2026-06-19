---
phase: 08-migration
plan: 04
subsystem: worker-runtime
tags: [plugin-migration, build-script, third-party, worker-sandbox, rpc, worker-activation]
key-decisions:
  - "D-09: packages/plugins/ 下为 Quiz (quiz/) 和 Rollcall (rollcall/) 建立独立的 TS 源码和目录"
  - "D-10: 打包输出 .zip 到 dist/plugins/ 并忽略进 Git"
  - "D-11: 两个第三方插件以 'worker' 模式运行在独立 Worker Thread，所有的服务访问均通过 ServiceProxy RPC 代理进行"
  - "D-12: 利用 jszip 编写 scripts/build-plugins.mjs 脚本，整合到 npm build 流程"
  - "D-13 (new): PluginHost.activateWorker 需授予 manifest.capabilitiesProposed 能力（与 inline 模式一致）"
  - "D-14 (new): PluginHost.activateWorker 需传递 EventBus 引用以启用 Worker 事件转发"
metrics:
  duration_minutes: 25
  files_created: 8
  files_modified: 2
  tests_passed: 251
  commits: 3
completed_at: "2026-06-19T06:52:00Z"
---

# Phase 08 Plan 04: Third-Party Plugins Packaging & Worker Sandbox Testing

**One-liner:** Build the Quiz and Roll Call third-party plugins in standard ESM format with esbuild+jszip packaging, seed them in Kernel as worker-mode isolated plugins, and add integration tests covering worker RPC, event forwarding, and capability guard enforcement.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Quiz and Roll Call plugin TS source + manifest | `2ba1f7a` | packages/plugins/quiz/index.ts, manifest.json; packages/plugins/rollcall/index.ts, manifest.json |
| 2 | build-plugins.mjs script + package.json build pipeline | `ced53e3` | scripts/build-plugins.mjs; package.json |
| 3 | Integration tests + Kernel worker-mode activation fixes | `abd5bd7` | packages/core/plugin-host/index.ts; packages/plugins/__tests__/quiz.test.ts; packages/core/__tests__/worker-rpc.test.ts |

## Key Features

- **Quiz Plugin** (`ext-quiz-generator`): Registers `quiz.create` command that creates a multiple-choice quiz on the whiteboard via `whiteboard.draw`.
- **Roll Call Plugin** (`ext-roll-call`): Registers `rollcall.pick` command that randomly selects a student from a class and optionally displays on the whiteboard.
- **Build Script** (`scripts/build-plugins.mjs`): Uses `esbuild` to bundle each plugin entry point into a single JS file, then uses `jszip` to package it with `manifest.json` into a ZIP archive at `dist/plugins/`.
- **Package.json**: `build` script now runs `node scripts/build-plugins.mjs` before `vite build` and `esbuild server.ts`, ensuring plugins are packaged on every build.
- **Kernel Auto-Seeding**: Kernel bootstrap detects `dist/plugins/` ZIP files, installs them via `PluginHost.installPluginFromZip()`, sets `execution_mode='worker'`, and activates them.
- **Worker Activation Fix**: `PluginHost.activateWorker()` now grants capabilities from `manifest.capabilitiesProposed` and passes the EventBus reference for event forwarding.

## Test Coverage

- **Quiz Plugin E2E Test** (`packages/plugins/__tests__/quiz.test.ts`): Creates Kernel, waits for auto-seeding, verifies quiz plugin is active, executes `quiz.create` command, verifies whiteboard element in DB.
- **Worker RPC Integration Test** (`packages/core/__tests__/worker-rpc.test.ts`): Creates a mock worker plugin in memory, activates it in worker mode, publishes events from main thread, verifies the worker can make RPC database calls and command executions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PluginHost.activateWorker does not grant capabilities**
- **Found during:** Task 3 (test execution)
- **Issue:** The worker-mode activation path (`activateWorker`) was missing capability granting for `manifest.capabilitiesProposed`, causing kernel interceptor to deny all commands sent from the worker on behalf of the plugin actor. This is inconsistent with the inline-mode activation which grants capabilities.
- **Fix:** Added capability granting loop in `activateWorker` before worker creation, matching the inline mode flow in `activatePlugin`.
- **Files modified:** `packages/core/plugin-host/index.ts`
- **Commit:** `abd5bd7`

**2. [Rule 1 - Bug] PluginHost.activateWorker does not pass EventBus for event forwarding**
- **Found during:** Task 3 (test execution)
- **Issue:** The worker-mode activation path did not pass the `EventBus` instance to `WorkerManager.createWorker()`, making the `eventBus` parameter `undefined` in the ServiceHost constructor. The EventForwarder was never created, so main-thread events were never forwarded to workers.
- **Fix:** Added resolution of `IEventBusServiceToken` from the ServiceRegistry and passed the EventBus reference to `createWorker()`.
- **Files modified:** `packages/core/plugin-host/index.ts`
- **Commit:** `abd5bd7`

**3. [Rule 1 - Bug] Quiz test filter uses wrong ID field**
- **Found during:** Task 3 (test execution)
- **Issue:** `listPlugins()` returns `plugins.id` (a UUID) as the `id` field, not the manifest ID. The test was filtering with `p.id.startsWith('ext-')`, which always failed because DB-generated UUIDs don't start with 'ext'.
- **Fix:** Changed filter to `p.name.includes('Quiz')` which matches the manifest's `name` field.
- **Files modified:** `packages/plugins/__tests__/quiz.test.ts`
- **Commit:** `abd5bd7`

### Deliberate Deviations

- **Quiz test startup**: The original test design tried to clear plugins then re-seed, but `kernel.ready` is a one-shot promise. Changed to rely on Kernel's auto-seeding during construction instead.

## Verification

- [x] `node scripts/build-plugins.mjs` runs successfully, generates `dist/plugins/ext-quiz-generator.zip` and `dist/plugins/ext-roll-call.zip`
- [x] ZIP files contain valid `manifest.json` and bundled `index.js`
- [x] All 251 tests pass (31 test files)
- [x] Quiz plugin test passes — worker-mode activation, command execution, DB verification
- [x] Worker RPC test passes — event forwarding, DB RPC access, command RPC execution

## Self-Check: PASSED

- All 8 created files exist
- All 3 commits found in git history
- Build script runs successfully, generates valid ZIPs
- Full test suite: 31 test files, 251 tests, all passing
