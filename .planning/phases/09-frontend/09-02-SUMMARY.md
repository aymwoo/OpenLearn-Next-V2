---
phase: 09-frontend
plan: 02
subsystem: ui
tags: [react, extension-points, react-lazy, zustand, plugin-host, plugin-center, i18n]
requires:
  - phase: 09-frontend
    plan: 01
    provides: FrontendPluginHost, PluginHostProvider, FrontendServiceRegistry, zustand store, types
provides:
  - ExtensionPointRegistry (slot-based register/getExtensions/unregister/unregisterByPlugin/dispose)
  - ExtensionPointRenderer (React.lazy + Suspense + ErrorBoundary + LoadingSkeleton)
  - PluginHostProvider integrated into main.tsx wrapping entire App
  - ExtensionPointRenderer rendering dynamic plugin tab buttons in teacher nav
  - PluginCenter component (extracted from App.tsx plugin management UI)
  - LegacyPluginBadge component (amber badge for legacy-format plugins)
  - All Phase 9 i18n keys (zh + en)
affects: [09-frontend-03, 09-frontend-04]

tech-stack:
  added: []
  patterns:
    - Slot-based extension point registration with dedup throw (T-09-04)
    - React.lazy + Suspense for dynamic plugin component loading
    - Per-component ErrorBoundary isolation for plugin component crashes (T-09-05)
    - React Context distribution via PluginHostProvider (D-03)
    - Frontend service initialization after socket connection

key-files:
  created:
    - src/plugin-host/extension-points.ts
    - src/plugin-host/extension-point-renderer.tsx
    - src/components/PluginCenter.tsx
    - src/components/LegacyPluginBadge.tsx
    - src/plugin-host/__tests__/extension-points.test.ts
    - src/plugin-host/__tests__/plugin-host-context.test.tsx
  modified:
    - src/main.tsx
    - src/App.tsx
    - src/i18n.ts
    - vitest.config.ts

key-decisions:
  - "ExtensionPointRegistry uses internal Map<string, ExtensionPointConfig[]> with dedup throw on duplicate slot+id (Pitfall 3)"
  - "ExtensionPointRenderer wraps each extension in individual ErrorBoundary to isolate crashes (T-09-05)"
  - "PluginCenter re-defines CAPABILITY_INFO and parsePluginSource internally (extracted from App.tsx scope)"
  - "DEFAULT_PLUGIN template duplicated in PluginCenter.tsx for the dev tab 'Reset to default' button"
  - "Frontend services initialized inside socket useEffect using addToastRef (ref pattern for stable closure)"

patterns-established:
  - "Extension slot pattern: components registered for teacher.tab render both tab button and tab content"
  - "catch-all renderer: non-hardcoded teacherTab values fall through to ExtensionPointRenderer"

requirements-completed: [PLUG-06]

duration: 7min
completed: 2026-06-19
---

# Phase 09: Extension Points System + App.tsx Integration Summary

**ExtensionPointRegistry with React.lazy rendering, PluginHostProvider in main.tsx, PluginCenter component extraction, and LegacyPluginBadge**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-19T07:32:00Z
- **Completed:** 2026-06-19T07:38:34Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- ExtensionPointRegistry with slot-based registration, dedup throw, sorting by position, unregister/unregisterByPlugin/dispose
- ExtensionPointRenderer with React.lazy + Suspense + per-component ErrorBoundary + LoadingSkeleton
- main.tsx creates FrontendPluginHost and wraps App with PluginHostProvider (D-03)
- App.tsx renders dynamic extension point tabs after hardcoded nav buttons and catches non-hardcoded tab values in content area
- Frontend services (FrontendAPIService, SocketService, UIService, StorageService) initialized after socket connection
- PluginCenter component extracted from App.tsx lines 6295-6757 with zero visual delta, integrated ZIPDropZone
- LegacyPluginBadge amber badge for legacy-format plugins (AlertTriangle icon + "Migratable" label)
- 15 Phase 9 i18n keys added in both zh and en
- teacherTab type changed from union literal to string for dynamic plugin tab support
- 18 passing unit tests (15 for ExtensionPointRegistry, 3 for PluginHostProvider context)

## Task Commits

Each task was committed atomically:

1. **Task 1: ExtensionPointRegistry + ExtensionPointRenderer** - `2822e2b` (feat)
2. **Task 2: Integrate PluginHostProvider + App.tsx integration** - `eec5a38` (feat)
3. **Task 3: PluginCenter extraction + LegacyPluginBadge + i18n** - `23ecf22` (feat)

## Files Created/Modified
- `src/plugin-host/extension-points.ts` - ExtensionPointRegistry class with slot-based register/getExtensions/unregister/unregisterByPlugin/dispose
- `src/plugin-host/extension-point-renderer.tsx` - ExtensionPointRenderer component with React.lazy + Suspense + ErrorBoundary + LoadingSkeleton
- `src/components/PluginCenter.tsx` - Extracted plugin management UI (Discover + Developer tabs) with ZIPDropZone
- `src/components/LegacyPluginBadge.tsx` - Amber badge for legacy-format plugins with AlertTriangle icon
- `src/main.tsx` - FrontendPluginHost creation + PluginHostProvider wrapping App
- `src/App.tsx` - ExtensionPointRenderer imports, teacherTab type change, host initialization, inline markup replaced with PluginCenter
- `src/i18n.ts` - 15 Phase 9 translation keys in zh and en
- `vitest.config.ts` - Updated include pattern to match .test.tsx files
- `src/plugin-host/__tests__/extension-points.test.ts` - 15 unit tests
- `src/plugin-host/__tests__/plugin-host-context.test.tsx` - 3 context tests

## Decisions Made
- Used `addToastRef` (ref pattern) for capturing addToast callback in the socket useEffect closure, matching existing project patterns (langRef, studentsRef)
- ExtensionPointRegistry throws on duplicate slot+id instead of silently overwriting (Pitfall 3 mitigation, T-09-04)
- PluginCenter re-defines CAPABILITY_INFO and parsePluginSource internally rather than importing from App.tsx to maintain encapsulation
- Checkpoint (Task 3) auto-approved in auto chain mode per objective instructions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- PluginHostProvider context test had to be created with .tsx extension for JSX support; vitest include pattern updated accordingly
- renderToString from react-dom/server works in node environment, making @testing-library/react unnecessary

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Extension Points infrastructure (registry + renderer) ready for Wave 3 (Browser Web Worker)
- PluginCenter component ready for Wave 4 enhancements (migration prompts, transition UI)
- PluginHostProvider and FrontendPluginHost initialized and available to all descendant components

---
*Phase: 09-frontend*
*Completed: 2026-06-19*

## Self-Check: PASSED

All 6 created files verified present. All 3 task commits verified in git log.

