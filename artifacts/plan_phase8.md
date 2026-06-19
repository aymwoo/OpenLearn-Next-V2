# Plan: Phase 8 — Existing Plugins Migration

## 08-01: System Core Built-in Plugins Migration (Completed)
- Already implemented in the previous iteration.

## 08-02: Business Built-in Plugins Migration (Code complete, needs status update in ROADMAP.md)
- Verify `ManagementPlugin` and `BuiltinPlugin` are fully refactored and integrated.
- Update status in `ROADMAP.md` to show that 08-02 is completed.

## 08-03: AI Plugins Migration & Legacy Cleanup
- **Task 1: IPluginHostToken and PluginHost.togglePlugin()**
  - Declare `IPluginHostToken` in `packages/core/di/interfaces.ts`.
  - Implement `togglePlugin(pluginId)` on `PluginHost` in `packages/core/plugin-host/index.ts`.
  - Register `IPluginHostToken` in `packages/core/kernel/index.ts`.
- **Task 2: Refactor AiPlannerPlugin**
  - Rewrite `packages/plugins/ai-planner.ts` to export standard ESM `AiPlannerPlugin` using Token DI.
- **Task 3: Refactor AiSubmitInjectorPlugin**
  - Rewrite `packages/plugins/ai-submit-injector.ts` to export standard ESM `AiSubmitInjectorPlugin` using Token DI, keeping legacy helper functions for compatibility.
- **Task 4: Delete Legacy plugin-runtime and Cleanup Kernel/server.ts**
  - Physically delete `packages/core/plugin-runtime/index.ts`.
  - Remove all references to `PluginRuntime` from `packages/core/kernel/index.ts`, add AI plugins to `bootstrapSystemPlugins()`, and handle soft-fail for them.
  - Clean up `server.ts` to remove `bootstrapAIPlannerPlugins()` and replace `pluginRuntime` usages with `pluginHost`.
- **Task 5: Add Tests & Verify**
  - Create `packages/plugins/__tests__/ai-planner.test.ts`.
  - Create `packages/plugins/__tests__/ai-submit-injector.test.ts`.
  - Create `packages/core/__tests__/legacy-cleanup.test.ts`.
  - Run `vitest` to verify.

## 08-04: Third-Party Plugins Packaging & Worker Sandbox Testing
- **Task 1: Create TS Source and Manifests for Quiz & Rollcall**
  - Create `packages/plugins/quiz/manifest.json` and `packages/plugins/quiz/index.ts`.
  - Create `packages/plugins/rollcall/manifest.json` and `packages/plugins/rollcall/index.ts`.
- **Task 2: Build Script `scripts/build-plugins.mjs`**
  - Package plugins to ZIP format under `dist/plugins/`.
  - Integrate into `package.json`'s build task.
  - Add `dist/plugins/` to `.gitignore`.
- **Task 3: Seeding and Worker Integration**
  - Update `packages/core/kernel/index.ts` to auto-seed zip plugins, setting `execution_mode = 'worker'` and `status = 'active'`.
- **Task 4: Add Tests & Verify**
  - Create `packages/plugins/__tests__/quiz.test.ts`.
  - Create `packages/core/__tests__/worker-rpc.test.ts`.
  - Run all tests.
