---
phase: 07-hotreload-middleware
plan: 07-01
subsystem: plugin-host
tags: [hot-reload, file-watcher, chokidar]
---

# Plan 07-01: File Watcher + Hot Reload Infrastructure Summary

## Accomplishments
- Integrated **chokidar** as the cross-platform file watcher.
- Created `FileWatcher` wrapper to track pluginId to filePath mappings.
- Implemented `HotReloadController` with 300ms debounce and dev-mode gating (NODE_ENV=development).
- Added `reloadPlugin` skeleton and integrated it with the Kernel.

## Files
- Created `packages/core/plugin-host/hot-reload.ts`
- Modified `packages/core/plugin-host/index.ts`
- Modified `packages/core/plugin-host/types.ts`
- Modified `packages/core/plugin-host/errors.ts`
- Modified `packages/core/kernel/index.ts`
- Modified `package.json`
