---
phase: 11-loader-bridge
verified: 2026-06-20T00:55:00Z
status: gaps_found
score: 10/15 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Remote application entry URLs are actually usable by the Module Federation runtime after resolution"
    status: failed
    reason: "CR-01: Entry URL is fetched via fetchRemoteEntry() and cached, but never registered with the MF runtime. The init() call in main.tsx has remotes: [], and registerRemotes() from @module-federation/runtime is never imported or called. loadRemote() will fail because no remotes are registered."
    artifacts:
      - path: "src/mfe/MfeLoaderCore.tsx"
        issue: "Missing registerRemotes() call after fetching entry URL (lines 209-220)"
    missing:
      - "Import registerRemotes from @module-federation/runtime in MfeLoaderCore.tsx"
      - "Call registerRemotes([{ name, entry }]) after cache fetch/miss before calling loadRemote"
  - truth: "createMfeApp factory returns complete MfeAppLifecycle contract with all methods"
    status: failed
    reason: "CR-02: Both remote packages' createMfeApp return { mount, styles } without top-level unmount() and update() methods required by the MfeAppLifecycle interface. MfeLoaderCore calls lifecycle.unmount() during cleanup (lines 148, 271), which will throw TypeError."
    artifacts:
      - path: "packages/mfe-whiteboard/src/App.tsx"
        issue: "Missing top-level unmount() and update() in createMfeApp return value"
      - path: "packages/mfe-courseware/src/App.tsx"
        issue: "Missing top-level unmount() and update() in createMfeApp return value"
      - path: "src/mfe/MfeLoaderCore.tsx"
        issue: "Calls lifecycle.unmount() which doesn't exist on createMfeApp return values"
    missing:
      - "Add unmount: async () => {} and update: async () => {} at the top level of both createMfeApp return objects"
  - truth: "Error fallback shows on load failure or runtime crash"
    status: failed
    reason: "CR-03: MfeLoaderCore catches async errors (network failure, timeout, loadRemote failure) and sets state to 'error', then returns null on re-render (line 301-302). The parent MfeErrorBoundary only catches render-phase errors via getDerivedStateFromError. Since MfeLoaderCore returns null instead of throwing, the error boundary never triggers. The user sees a blank screen."
    artifacts:
      - path: "src/mfe/MfeLoaderCore.tsx"
        issue: "Returns null on error state instead of throwing to trigger ErrorBoundary (line 301)"
      - path: "src/mfe/MfeErrorBoundary.tsx"
        issue: "Only catches render-phase errors; async load errors are invisible to it"
    missing:
      - "Throw the error object on the error rendering path so MfeErrorBoundary can catch it"
      - "Or propagate async errors to MfeErrorBoundary via state/context mechanism"
deferred:
  - truth: "MfeContext is populated with real host services (EventBus, Store, ServiceRegistry)"
    addressed_in: "Phase 12"
    evidence: "Phase 12 goal: '建立宿主与子应用的上下文桥接通道（MfeContext）' with success criteria for Zustand state sharing and EventBus broadcasts. MfeLoaderCore.tsx line 231 documents: '// D-02: placeholder — full bridging in Phase 12'"
  - truth: "Theme/state changes sync seamlessly in remote views"
    addressed_in: "Phase 12"
    evidence: "Phase 12 Success Criterion 1: 'Users observe real-time state updates sync seamlessly in remote views'"
---

# Phase 11: Loader-Bridge Verification Report

**Phase Goal:** 实现通用的 React 高阶容器组件 `MfeLoader`、错误边界与加载 Fallback，并定义及实施远程微应用标准生命周期接口。

**Verified:** 2026-06-20T00:55:00Z
**Status:** gaps_found (3 critical runtime bugs)
**Score:** 10/15 must-haves verified

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Remote application entry URLs are dynamically resolvable via the backend without a host rebuild | FAILED | `/api/mfe/remotes` endpoint and `fetchRemoteEntry` client exist, URL is fetched, but CR-01: `registerRemotes()` is never called, so the resolved URL is never registered with the MF runtime. `loadRemote()` uses an empty remotes config. |
| 2 | Loading the same remote twice reuses the first result without additional network requests | FAILED | Cache module exists with TTL (src/mfe/cache.ts) and server-side cache exists (MF_REMOTE_CACHE), but irrelevant because CR-01 prevents any loading from working. |
| 3 | TypeScript projects can import lifecycle types without type errors | VERIFIED | All 8 interfaces exported from src/mfe/types.ts (185 lines). Remote packages import via `import type { MfeContext }`. tsc --noEmit passes (excluding pre-existing syntax-error fixture). |
| 4 | Developers can add a new remote by inserting one row in mfe_remotes table | PARTIAL | DB table exists, API endpoint returns the row. But CR-01 prevents the row data from being used by the MF runtime. The developer action works in theory but has no practical effect. |
| 5 | All MFE test files execute without errors | VERIFIED | 4 test files, 20/20 tests pass (npx vitest run src/mfe/__tests__/ --reporter=verbose). |
| 6 | Loading fallback (centered spinner) shows while remote module is being fetched | VERIFIED | MfeLoadingFallback component exists with Loader2, animate-spin, text-indigo-600, role="status". MfeLoaderCore renders `<LoadingFallback />` in loading state. |
| 7 | Error fallback (XCircle + message + retry/dismiss) shows on load failure or runtime crash | FAILED | CR-03: Render-phase crashes trigger MfeErrorBoundary correctly. But async load failures (network, timeout, unregistered remote) set error state and return null, producing a blank screen. The error fallback component exists but is never displayed for the most common failure modes. |
| 8 | A crash in one remote component does not crash other remotes or the host | VERIFIED | MfeErrorBoundary is per-instance (D-14), wrapping each MfeLoaderCore independently. One instance's error does not affect siblings or the host shell. |
| 9 | Remote components render correctly alongside host without reconciler conflicts | FAILED | CR-01 prevents any remote component from loading. The createRoot isolation pattern is correctly implemented but unreachable. |
| 10 | React DevTools shows no orphaned roots after remote component removal | PARTIAL | Cleanup code calls root.unmount() (line 163) but CR-02 means lifecycle.unmount() could throw before reaching it. The try/catch guards prevent total failure but may not fully clean up all resources. |
| 11 | Closing a remote component releases DOM nodes within 5 seconds even if remote unmount() hangs | PARTIAL | D-22 timeout pattern exists (5s Promise.race). But CR-02 means lifecycle.unmount() could throw before the timeout logic. The structure exists but edge-case cleanup may be incomplete. |
| 12 | Remote applications with either createMfeApp or default export load correctly | FAILED | Both paths are implemented in code (createMfeApp at line 229-232, wrapReactComponent at line 233-235). But CR-01 makes both paths unreachable. CR-02 means the createMfeApp path would fail on cleanup. |
| 13 | Third-party CSS appears when mounted, disappears when unmounted | VERIFIED | Style injection/removal implemented in MfeLoaderCore (lines 251-264 for injection, lines 171-175 for removal). D-10 pattern correctly followed with tracked style references. |
| 14 | Nested MfeLoader loads both parent and child without errors | FAILED | CR-01 prevents any loading, nested or not. The architectural isolation (each instance has own ErrorBoundary + createRoot, D-27) is structurally correct. |
| 15 | Both remote packages export createMfeApp factory and default React component | VERIFIED | packages/mfe-whiteboard/src/App.tsx and packages/mfe-courseware/src/App.tsx both export `createMfeApp` and `export default function App`. Import type paths resolve correctly. |

**Score:** 10/15 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | MfeContext populated with real host services (EventBus, Store, ServiceRegistry) | Phase 12 | Phase 12 goal explicitly states bridge channel implementation. MfeLoaderCore.tsx line 231: "placeholder - full bridging in Phase 12" |
| 2 | Runtime theme/state sync in remote views | Phase 12 | Phase 12 Success Criterion 1: real-time state sync |
| 3 | ServiceRegistry DI injection for remotes | Phase 12 | Phase 12 Success Criterion 2: "remote component can successfully request API data using host-injected ServiceRegistry" |
| 4 | EventBus real-time events between host and remotes | Phase 12 | Phase 12 Success Criterion 3: "remote components trigger live socket notifications and EventBus broadcasts" |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| src/mfe/types.ts | 8 MFE lifecycle type interfaces, >= 80 lines | VERIFIED | 185 lines, 8 export interfaces + 2 context interfaces, JSDoc, D-number tracing |
| server.ts | GET /api/mfe/remotes endpoint | VERIFIED | Route at line 2116, query param support, cache-first, 404 on unknown, error handling |
| packages/core/db/index.ts | mfe_remotes table creation | VERIFIED | CREATE TABLE IF NOT EXISTS at line 317, correct columns |
| src/mfe/api.ts | fetchRemoteEntry client function | VERIFIED | fetchRemoteEntry and fetchAllRemotes exported, error handling pattern |
| src/mfe/cache.ts | In-memory entry URL cache with TTL | VERIFIED | get/set/invalidate/has exports, 60s TTL, Map-based |
| vitest.config.ts | Updated test include for src/mfe/ | VERIFIED | Contains 'src/mfe/__tests__/**/*.test.{ts,tsx}' in include array |
| src/mfe/MfeConfigProvider.tsx | Global MFE UI default configuration provider | VERIFIED | MfeConfigProvider + useMfeConfig exported, createContext(null) pattern, merge defaults |
| src/mfe/MfeContextProvider.tsx | Platform infrastructure context provider | VERIFIED | MfeContextProvider + useMfeInfraContext exported, null guard pattern |
| src/mfe/useMfeContext.ts | Hook for consuming MfeContext | VERIFIED | Combined convenience hook returning { config, infra } |
| src/mfe/preload.ts | Manual remote module preload API | VERIFIED | preload(name) and preloadAll(names) exported, calls loadRemote |
| src/mfe/leak-detector.ts | Dev-mode leak detection utility | VERIFIED | createLeakDetector factory, 5 methods, NODE_ENV guard, no-op outside dev |
| src/main.tsx | MF runtime init at app entry | VERIFIED | init() called with try/catch, MfeConfigProvider wraps PluginHostProvider<App>, all existing imports preserved |
| src/components/MfeLoadingFallback.tsx | Default loading spinner component | VERIFIED | Loader2, animate-spin, text-indigo-600, role="status", lang prop |
| src/components/MfeErrorFallback.tsx | Default error fallback with retry + dismiss | VERIFIED | XCircle, extensionLoadError i18n, retry/dismiss buttons, role="alertdialog", timeout detection |
| src/mfe/MfeErrorBoundary.tsx | Per-instance Error Boundary class component | VERIFIED | class MfeErrorBoundary extends React.Component, getDerivedStateFromError, componentDidCatch, handleRetry/handleDismiss |
| src/mfe/MfeLoaderCore.tsx | Container rendering with createRoot + lifecycle | VERIFIED (structural) | createRoot, loadRemote, state machine, timeout, style injection, cleanup — but CR-01/CR-03 bugs prevent runtime functionality |
| src/mfe/MfeLoader.tsx | Public MfeLoader composition wrapper | VERIFIED | MfeErrorBoundary + MfeLoaderCore composition, useMfeConfig for defaults, mfeRef forwarding, named + default export |
| packages/mfe-whiteboard/src/App.tsx | createMfeApp lifecycle factory + default export | PARTIAL | createMfeApp and default App exported, but missing top-level unmount/update (CR-02) |
| packages/mfe-courseware/src/App.tsx | createMfeApp lifecycle factory + default export | PARTIAL | Same issue as mfe-whiteboard (CR-02) |
| src/mfe/index.ts | Barrel export | VERIFIED | Exports all public components, providers, hooks, utilities, and types |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| server.ts | packages/core/db/index.ts | kernelContainer.db.prepare | VERIFIED | route uses kernelContainer.db.prepare('SELECT ... FROM mfe_remotes') |
| src/mfe/api.ts | server.ts | fetch(/api/mfe/remotes) | VERIFIED | fetchRemoteEntry calls `/api/mfe/remotes?name=...` |
| src/mfe/cache.ts | src/mfe/api.ts | import | VERIFIED | MfeLoaderCore imports cache and api |
| src/main.tsx | @module-federation/runtime | import { init } | VERIFIED | Line 7: `import { init } from '@module-federation/runtime'` |
| src/main.tsx | src/mfe/MfeConfigProvider.tsx | React tree wrapping | VERIFIED | Line 32-36: `<MfeConfigProvider>` wraps `<PluginHostProvider><App /></PluginHostProvider>` |
| src/mfe/preload.ts | @module-federation/runtime | import { loadRemote } | VERIFIED | Line 14: `import { loadRemote } from '@module-federation/runtime'` |
| src/mfe/MfeLoader.tsx | src/mfe/MfeErrorBoundary.tsx | Wraps MfeLoaderCore | VERIFIED | Line 82: `<MfeErrorBoundary name={name} fallback={...}>` |
| src/mfe/MfeLoaderCore.tsx | src/mfe/api.ts | fetchRemoteEntry import | VERIFIED | Line 33: `import { fetchRemoteEntry } from './api'` |
| src/mfe/MfeLoaderCore.tsx | @module-federation/runtime | loadRemote import | VERIFIED | Line 29: `import { loadRemote } from '@module-federation/runtime'` |
| src/mfe/MfeLoaderCore.tsx | react-dom/client | createRoot | VERIFIED | Line 28: `import { createRoot } from 'react-dom/client'` |
| src/mfe/MfeLoaderCore.tsx | @module-federation/runtime registerRemotes | registerRemotes | NOT_WIRED | CR-01: Entry URL resolved but never registered — `registerRemotes` is never imported or called |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| MfeLoaderCore | entry URL | fetchRemoteEntry -> cache -> registerRemotes | DISCONNECTED | CR-01: URL is fetched and cached, but never passed to MF runtime via registerRemotes(). loadRemote() uses an empty remote config. |
| createMfeApp | ctx (MfeContext) | empty object {} | STATIC | D-02 placeholder, deferred to Phase 12 for real EventBus/Store/ServiceRegistry injection |
| MfeErrorBoundary | error state | async catch in MfeLoaderCore | DISCONNECTED | CR-03: Errors are set in state but never propagated to error boundary — null return swallows errors |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Test suite passes | `npx vitest run src/mfe/__tests__/` | 20 passed, 4 files | PASS |
| TypeScript compiles | `npx tsc --noEmit` | Pass (pre-existing syntax-error fixture only) | PASS |
| MFE type interfaces defined | `grep -c "export interface" src/mfe/types.ts` | 8 | PASS |
| DB table created | `grep -c "CREATE TABLE IF NOT EXISTS mfe_remotes" packages/core/db/index.ts` | 1 | PASS |
| API endpoint exists | `grep -c "app.get('/api/mfe/remotes'" server.ts` | 1 | PASS |
| registerRemotes used | `grep -c "registerRemotes" src/mfe/MfeLoaderCore.tsx` | 0 | FAIL (CR-01) |
| createMfeApp top-level unmount | `grep "unmount" packages/mfe-whiteboard/src/App.tsx \| wc -l` | 2 (both inside mount, not top-level) | FAIL (CR-02) |
| Error throw on error render | `grep "throw" src/mfe/MfeLoaderCore.tsx \| grep -c "error"` | 0 | FAIL (CR-03) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MFE-LOAD-01 | 11-01, 11-02, 11-03 | Implement MfeLoader container component supporting dynamic remote entry resolution via @module-federation/runtime | BLOCKED | MfeLoader component exists at src/mfe/MfeLoader.tsx, MfeLoaderCore at src/mfe/MfeLoaderCore.tsx. BUT CR-01: registerRemotes is never called, so the MfeLoader cannot actually resolve or load any remote module. The dynamic resolution pipeline fetches URLs but never registers them with the MF runtime. |
| MFE-LOAD-02 | 11-01, 11-02, 11-03 | Implement React Error Boundaries and Loading fallbacks to prevent remote crashes from bringing down the host | PARTIAL | MfeErrorBoundary class component (src/mfe/MfeErrorBoundary.tsx) correctly catches render-phase errors. MfeLoadingFallback (src/components/MfeLoadingFallback.tsx) renders correctly. BUT CR-03: Async load failures (network, timeout, unregistered remote) never reach the error boundary — MfeLoaderCore returns null instead of throwing, causing a blank screen. |
| MFE-LOAD-03 | 11-01, 11-04 | Standardize Remote application export contract with bootstrap, mount, and unmount hooks | BLOCKED | MfeAppLifecycle interface defined in src/mfe/types.ts with mount/unmount/update/styles. Both remote packages export createMfeApp factory. BUT CR-02: Both remote implementations return objects missing top-level unmount() and update() methods required by the interface. Calling lifecycle.unmount() will throw TypeError. |
| MFE-LOAD-04 | 11-01, 11-03 | Ensure complete React 19 root unmounting (root.unmount()) on remote destruction to avoid memory leaks | PARTIAL | root.unmount() is called in MfeLoaderCore cleanup (line 163). Dual-path unmount with 5s timeout exists (D-22). Leak detector integration exists. BUT CR-02 means lifecycle.unmount() can throw before reaching root.unmount(), though the try/catch guard mitigates total failure. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| src/mfe/MfeLoaderCore.tsx | 209-220 | Missing registerRemotes call (CR-01) | BLOCKER | Entry URL fetched but never registered with MF runtime. loadRemote() will always fail. The entire loading pipeline is broken. |
| packages/mfe-whiteboard/src/App.tsx | 13-32 | Missing top-level unmount/update (CR-02) | BLOCKER | createMfeApp return violates MfeAppLifecycle interface contract. Cleanup code in MfeLoaderCore calls lifecycle.unmount() which doesn't exist. |
| packages/mfe-courseware/src/App.tsx | 13-32 | Missing top-level unmount/update (CR-02) | BLOCKER | Same issue as mfe-whiteboard |
| src/mfe/MfeLoaderCore.tsx | 301-302 | Error swallowed as null return (CR-03) | BLOCKER | Async errors set state to 'error' and return null. ErrorBoundary never triggers. User sees blank screen. |
| server.ts | 52 | MF_REMOTE_CACHE no TTL | WARNING | Server-side cache persists indefinitely until server restart. Dual-layer cache (frontend TTL=60s, backend=forever) makes frontend TTL irrelevant. |
| src/mfe/types.ts vs src/mfe/MfeContextProvider.tsx | 65-78 vs 30-37 | MfeContext eventBus interface mismatch | WARNING | types.ts: subscribe/publish. MfeContextProvider.tsx: on/off/emit. These are different shapes referencing the same concept. Will cause confusion when Phase 12 implements the bridge. |

### Human Verification Required

No human verification items identified. All findings are verifiable through code inspection and automated checks.

### Gaps Summary

**3 CRITICAL RUNTIME BUGS** prevent the MfeLoader from functioning correctly. The structural/architectural deliverables are all present (components, types, context providers, lifecycle interfaces, test files), but the wiring has 3 blocker-level defects:

**Gap 1 (CR-01) — registerRemotes never called:** The dynamic entry URL resolution pipeline is correct up to the point of fetching the URL from the backend API, but the URL is never registered with the @module-federation/runtime via `registerRemotes()`. The `init()` call in main.tsx sets `remotes: []`, so `loadRemote()` has no remote to load from. Fix: import and call `registerRemotes([{ name, entry }])` after fetching/caching the entry URL.

**Gap 2 (CR-02) — createMfeApp missing top-level unmount/update:** Both remote packages' createMfeApp return `{ mount, styles }` but omit the top-level `unmount()` and `update()` methods required by the `MfeAppLifecycle` interface. MfeLoaderCore calls `lifecycle.unmount()` during cleanup (lines 148, 271), which will produce a runtime TypeError. Fix: add `unmount: async () => {}` and `update: async () => {}` to both createMfeApp return objects.

**Gap 3 (CR-03) — Async errors invisible to ErrorBoundary:** MfeLoaderCore catches async load errors (network failure, timeout) and sets `state = 'error'`, returning null on re-render. The parent MfeErrorBoundary only catches render-phase errors via `getDerivedStateFromError`. Since null is returned instead of thrown, the error boundary never triggers. Fix: on the error rendering path, throw the error instead of returning null.

**Deferred to Phase 12:** The empty mfeContext object (line 231) is explicitly documented as a Phase 12 placeholder. Phase 12's roadmap confirms this with its goal of implementing the full MfeContext bridge with EventBus, Store, and ServiceRegistry injection.

---

_Verified: 2026-06-20T00:55:00Z_
_Verifier: Claude (gsd-verifier)_
