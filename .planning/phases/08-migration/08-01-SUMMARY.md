---
phase: 08-migration
plan: 08-01
subsystem: kernel
tags: [plugin-migration, di, vfs, process, kernel-loader]
---

# Plan 08-01: System Core Built-in Plugins Migration Summary

## Accomplishments
- Declared and exported `IDatabaseToken` in `packages/core/di/interfaces.ts`.
- Registered the SQLite database singleton in the DI `ServiceRegistry` within `packages/core/kernel/index.ts`.
- Added a `resolve` helper method to `PluginContext` in `packages/core/plugin-host/context-builder.ts` and updated the `PluginContext` type signature in `packages/core/plugin-host/types.ts`.
- Refactored `VfsPlugin` in `packages/plugins/vfs.ts` and `ProcessPlugin` in `packages/plugins/process.ts` to run as inline ESM modules, resolving standard services from `ctx.services` and the SQLite database via `await ctx.resolve(IDatabaseToken)`.
- Refactored `ProcessManager` in `packages/core/process-manager/index.ts` to use constructor-injected `this.kernel.db` instead of a hardcoded module import, enabling correct database isolation.
- Exposed a public `ready` promise on the `Kernel` class to allow tests and other code to await the asynchronous plugin bootstrapping process.
- Fixed an async return type mismatch in `context-builder.ts` by wrapping `actionRegistry.register` and `unregister` calls with `Promise.resolve`.
- Updated integration tests in `packages/core/__tests__/kernel-plugins.test.ts` to await `kernel.ready`.
- All tests for VFS, Process, and Kernel integration are passing successfully.

## Files
- Modified `packages/core/di/interfaces.ts`
- Modified `packages/core/plugin-host/types.ts`
- Modified `packages/core/plugin-host/context-builder.ts`
- Modified `packages/plugins/vfs.ts`
- Modified `packages/plugins/process.ts`
- Modified `packages/core/process-manager/index.ts`
- Modified `packages/core/kernel/index.ts`
- Modified `packages/core/__tests__/kernel-plugins.test.ts`
- Created `.planning/phases/08-migration/08-01-SUMMARY.md`
