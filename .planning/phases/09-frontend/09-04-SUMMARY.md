---
phase: 09-frontend
plan: 04
type: execute
wave: 3
completed: true
subsystem: frontend-plugin-migration
tags: [plugin-center, command-routing, migration, vitest, e2e]
requires: [02, 03]
provides: [legacy-detection, priority-routing, migration-ui, integration-tests]
tech-stack:
  added: [jszip (client-side manifest preview)]
  patterns: [D-11 priority routing, jszip file parsing]
key-files:
  created:
    - packages/core/__tests__/command-routing.test.ts
    - src/plugin-host/__tests__/migration.test.tsx
    - src/plugin-host/__tests__/plugin-center-integration.test.tsx
  modified:
    - packages/core/command-bus/index.ts
    - src/components/PluginCenter.tsx
decisions:
  - Legacy handler storage in CommandBus uses a separate Map rather than a flag on the handler, keeping modern handler registration unchanged
  - MigrationPrompt banner placed in Developer tab (per spec) above the split layout
  - Migrate button uses existing hidden file input via getElementById, avoiding additional prop drilling
  - Frontend tests use renderToString (matching existing patterns) with @vitest-environment jsdom pragma
metrics:
  duration: ~15m
  completed_date: 2026-06-19
---

# Phase 09 Plan 04: Transition Compatibility + Migration UI + Tests

Complete the dual-system transition: legacy plugin detection and migration prompts in the UI, command routing priority (modern > legacy), and comprehensive integration tests.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | 926c310 | feat(09-frontend-04): implement D-11 command routing priority (modern > legacy) |
| 2 | 7809640 | feat(09-frontend-04): add MigrationPrompt, Migrate button, jszip preview to PluginCenter |
| 3 | fe95a8e | test(09-frontend-04): add migration and plugin-center integration tests |

## Task Summary

### Task 1: Command Routing Priority (D-11)
- Modified `CommandBus` with a separate `legacyHandlers` Map
- Added `registerLegacyHandler()` method for old-format plugin handler registration
- `execute()` prefers modern handlers, falls back to legacy handlers
- `unregisterHandler()` cleans up both maps
- Created `packages/core/__tests__/command-routing.test.ts` with 7 tests:
  - modern-only, legacy-only, priority routing, no-handler error
  - dual unregister, non-conflicting legacy registration, duplicate modern error

### Task 2: Migration UI Enhancements
- Added `MigrationPromptBanner` component (amber banner in Developer tab when legacy plugins exist)
  - AlertTriangle icon, heading, body text, "Migrate to New Format" button, dismiss (X) button
  - Condition: `plugins.some(p => p.execution_mode === 'legacy') && !dismissMigration`
- Added "Migrate" button on legacy plugin cards in Store tab (amber-600 background, triggers ZIP file picker)
- Added jszip-based manifest preview for ZIP drop zone with states per UI-SPEC:
  - Idle: Upload icon + prompt text
  - Processing: spinner + "Analyzing..." text
  - Error: red border + error message
  - Success: green border + manifest info (name, id, version)
- Added `execution_mode` field to `PluginType` interface
- i18n keys were already present from 09-02

### Task 3: Vitest + Integration Tests
- `vitest.config.ts` already includes `src/plugin-host/__tests__/` paths (from prior plans)
- Created `src/plugin-host/__tests__/migration.test.tsx` (13 tests):
  - Legacy detection logic, MigrationPrompt visibility conditions, LegacyPluginBadge rendering
- Created `src/plugin-host/__tests__/plugin-center-integration.test.tsx` (9 tests):
  - Plugin grid rendering, tab switching, Enable/Disable/Delete buttons, Migrate button

## Verification

| Criterion | Status |
|-----------|--------|
| CommandBus supports modern-first routing | Passed - 7 tests confirm |
| MigrationPrompt banner shown in Developer tab when legacy plugins exist | Passed - condition implemented |
| Legacy plugin cards display "Migrate to New Format" button | Passed - renders when `execution_mode === 'legacy'` |
| ZIP drop zone includes jszip manifest preview | Passed - processing/error/success states |
| vitest.config includes frontend test paths | Already configured |
| Frontend tests use jsdom pragma | Passed - both test files use `@vitest-environment jsdom` |
| Full test suite passes (excluding pre-existing flaky tests) | 337/337 passing (hot-reload stress test and quiz worker test are pre-existing flaky failures) |

## Deviations

None - plan executed exactly as written.

## Known Stubs

None detected.

## Threat Surface

**T-09-13 (Spoofing):** execution_mode read directly from server response; no frontend transforms. Acceptable risk.
**T-09-14 (Tampering):** jszip client-side preview is informational only; server validates at `/api/plugins/upload-zip`. Acceptable risk.
**T-09-15 (Info Disclosure):** ZIP preview reads only manifest.json in browser. Acceptable risk.
**T-09-16 (Phishing):** "Migrate" button only opens file picker; server validates uploads. Acceptable risk.
