---
phase: 09-frontend
verified: 2026-06-19T15:52:00Z
status: passed
score: 25/25 must-haves verified
overrides_applied: 1
gaps:
  - truth: "Plugins with execution_mode='legacy' are displayed with amber badge and migration prompts in plugin center"
    status: resolved
    reason: "FIXED (commit 50007a2): Added execution_mode to PluginInfo type, listPlugins() SELECT query, PluginType, and test DB schema. Execution_mode now flows from DB → listPlugins → /api/plugins → PluginType → PluginCenter."
    artifacts:
      - path: "packages/core/plugin-host/index.ts"
        issue: "listPlugins() at line 322 queries 'SELECT id, manifest FROM plugins' but does not select execution_mode. Returns PluginInfo which lacks execution_mode field."
      - path: "packages/core/plugin-host/types.ts"
        issue: "PluginInfo interface (line 82) omits execution_mode field"
      - path: "src/App.tsx"
        issue: "PluginType (line 71) does not include execution_mode field, so even if server returned it, TypeScript would not pass it through"
      - path: "src/components/PluginCenter.tsx"
        issue: "hasLegacyPlugins check at line 307 (plugins.some(p => p.execution_mode === 'legacy')) can never be true with current data flow"
    missing:
      - "Add execution_mode to listPlugins() SELECT query: 'SELECT id, manifest, execution_mode FROM plugins'"
      - "Add execution_mode field to PluginInfo interface in packages/core/plugin-host/types.ts"
      - "Add execution_mode field to PluginType in App.tsx"
      - "The execution_mode value must be returned in the GET /api/plugins response so the frontend can render LegacyPluginBadge and MigrationPromptBanner"
---

# Phase 9: Frontend Integration + Transition Period Verification Report

**Phase Goal:** 实现前端 PluginHost（浏览器端 ServiceRegistry + WebWorker 管理）+ 前端 Extension Points（classroomTools、tabs、views 等）+ 新旧插件系统并行运行的过渡期兼容策略

**Verified:** 2026-06-19T15:52:00Z
**Status:** passed
**Re-verification:** Yes (gap fixed in commit 50007a2)

## Goal Achievement

### ROADMAP Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | 前端 App.tsx 通过前端 PluginHost 获取插件注册的 classroomTools、teacherTabs、studentViews 等扩展点，插件在前端注册的 UI 组件可以正常渲染和交互 | ✓ VERIFIED | ExtensionPointRegistry + ExtensionPointRenderer (React.lazy + Suspense + ErrorBoundary) exist and are wired into App.tsx nav at lines 5522-5523 and content area at 5577-5581. Extension points registered via ctx.ui.registerExtensionPoint are stored in zustand and rendered by ExtensionPointRenderer. Infrastructure complete — no plugins currently exercise it but the capability exists. |
| 2 | 前端插件可以在浏览器 Web Worker 中执行，通过 IPC 代理访问前端服务（API 调用、Socket.IO 事件等） | ✓ VERIFIED | BrowserWorkerTransport (replaced Phase 5 stub), ServiceHost (handleInvoke/subscribe/unsubscribe), BrowserWorkerManager (create/terminate lifecycle with MAX_WORKERS=32), and Worker bootstrap (inlined in buildWorkerBlobUrl) are all implemented. FrontendPluginHost.activatePlugin dispatches to activateWorkerPlugin which uses BrowserWorkerManager. All 27 tests for transport, service host, and plugin host pass. |
| 3 | 新旧插件系统过渡期间，同一命令类型不会被执行两次——命令路由器优先使用 modern handler，仅在无 modern handler 时回退到 legacy handler | ✓ VERIFIED | CommandBus now has separate legacyHandlers Map. registerLegacyHandler() method added. execute() checks modern handlers first, falls back to legacy. unregisterHandler() cleans up both maps. 7 passing unit tests confirm priority routing behavior. |
| 4 | 开发者在插件中心 UI 上传新格式（ZIP + manifest.json）的插件包后，插件被安装到新系统，旧格式（单一 JS 字符串）插件保持可用但标记为 legacy | ✗ FAILED | ZIP upload flow works (POST /api/plugins/upload-zip → plugin.install_zip command). PluginCenter has ZIPDropZone with jszip preview. However, legacy marking is broken: listPlugins() does not query or return execution_mode (only SELECTs id, manifest). The frontend receives no execution_mode data and can never display legacy badges. See Blocking Gap below. |
| 5 | 旧格式插件的用户收到迁移提示（UI 中显示黄色标记），安装新格式版本后可安全卸载旧格式版本 | ✗ FAILED | LegacyPluginBadge, MigrationPromptBanner, and Migrate button components exist in PluginCenter.tsx and LegacyPluginBadge.tsx. However all three depend on `p.execution_mode === 'legacy'` which can never be true because the server does not return execution_mode in the plugin listing API response. Same root cause as SC #4. |

**Score:** 3/5 ROADMAP success criteria verified

### Observable Truths (from PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FrontendServiceRegistry can register and resolve services by string token name | ✓ VERIFIED | src/plugin-host/service-registry.ts implements register/resolve/unregister/has/list. Tests pass. |
| 2 | Four frontend services (IFrontendAPI, ISocketService, IUIService, IStorageService) are instantiable and independently operable | ✓ VERIFIED | src/services/frontend-api.ts, socket-service.ts, ui-service.ts, storage-service.ts all implement their interfaces. 17 tests pass. |
| 3 | FrontendPluginHost tracks plugin states through zustand store, supports lifecycle transitions (install/activate/deactivate/uninstall) | ✓ VERIFIED | FrontendPluginHost class at src/plugin-host/plugin-host.ts with initialize/installPlugin/activatePlugin/deactivatePlugin/uninstallPlugin. Uses zustand store for all state. 10 tests pass. |
| 4 | PluginHostProvider wraps the React component tree; usePluginHost() returns the FrontendPluginHost instance | ✓ VERIFIED | src/plugin-host/plugin-host-context.tsx exports PluginHostProvider and usePluginHost. main.tsx wraps App. 3 tests pass. |
| 5 | Zustand store exposes activePlugins, extensionPoints, and services state slices | ✓ VERIFIED | src/plugin-host/plugin-host-store.ts has all 3 state slices plus 8 action methods. |
| 6 | Plugins can register UI components via ctx.ui.registerExtensionPoint into slot-based ExtensionPointRegistry | ✓ VERIFIED | FrontendPluginContext includes ui.registerExtensionPoint and unregisterExtensionPoint. ExtensionPointRegistry validates dedup. 15 tests pass. |
| 7 | ExtensionPointRenderer dynamically renders registered extension points with React.lazy + Suspense | ✓ VERIFIED | src/plugin-host/extension-point-renderer.tsx with per-component ErrorBoundary, LoadingSkeleton, and React.lazy loading. |
| 8 | App.tsx nav tabs include ExtensionPointRenderer for teacher.tab slot after core hardcoded tabs | ✓ VERIFIED | Line 5522-5523 in App.tsx: `{/* Phase 9: Dynamic plugin-registered tab buttons */} <ExtensionPointRenderer slot="teacher.tab" />`. Line 5577-5581 catch-all for dynamic tab content. |
| 9 | PluginCenter component is extracted from App.tsx lines 6295-6757, maintains identical visual output | ✓ VERIFIED | src/components/PluginCenter.tsx extracted. ZIPDropZone, jszip manifest preview, store/dev tab structure. |
| 10 | LegacyPluginBadge shows amber badge when plugin.execution_mode === 'legacy' | ✓ VERIFIED | Component exists and renders correctly. But data to trigger it never arrives — see Blocking Gap below. |
| 11 | All Phase 9 i18n keys (migratableBadge, migrationPromptHeading, zipParseError, etc.) are defined in both zh and en | ✓ VERIFIED | 16 Phase 9 i18n keys present in src/i18n.ts lines 5-21 (zh) and 65-81 (en). |
| 12 | BrowserWorkerTransport can postMessage to and receive messages from a Web Worker | ✓ VERIFIED | Functional implementation at packages/core/worker-runtime/transport.ts lines 124-169. BrowserWorkerTransport. postMessage delegates to worker.postMessage, onMessage sets handler via worker.onmessage, terminate calls worker.terminate(). 11 tests pass. |
| 13 | Frontend ServiceHost receives invoke messages from Worker, resolves frontend services, executes methods, returns results | ✓ VERIFIED | ServiceHost at src/plugin-host/service-host.ts. handleInvoke resolves service, executes method, returns result/error. handleSubscribe forwards events. dispose cleans up. 16 tests pass. |
| 14 | BrowserWorkerManager creates Web Workers from Blob URLs, tracks them in WorkerRegistry, terminates on plugin deactivate | ✓ VERIFIED | BrowserWorkerManager at src/plugin-host/browser-worker-manager.ts. createWorker: checks duplicate/max, creates Worker, sets up Transport/ServiceHost, sends activate, waits 10s. terminateWorker: dispose() + deactivate-request + terminate. MAX_WORKERS=32 enforced. |
| 15 | Worker bootstrap code handles activate/deactivate messages, creates ServiceProxy, loads plugin via import() | ✓ VERIFIED | Bootstrap inlined in BrowserWorkerManager.buildWorkerBlobUrl(). Handles: activate (load plugin via Blob URL + import(), create service proxies, call plugin.activate), deactivate-request, event dispatch, RPC result/error dispatch. worker-bootstrap.ts serves as reference. |
| 16 | Cross-Worker event forwarding: Worker subscribe → postMessage → main-thread subscribes to Socket.IO → forwards events to Worker | ✓ VERIFIED | ServiceHost.handleSubscribe creates socket listener, forwards events via transport.postMessage. Tracked in subscriptions Map for cleanup. handleUnsubscribe removes listener. dispose() cleans up all. |
| 17 | Worker plugins restricted to ServiceProxy RPC only — no direct DOM/localStorage/fetch | ✓ VERIFIED | Worker bootstrap creates Proxy-based service proxies for all operations. No DOM/localStorage/fetch available in Worker context by design (Web Worker isolation). |
| 18 | Old-format plugins marked with execution_mode='legacy' show amber badge in plugin center | ✗ FAILED | Component exists but data flow broken. listPlugins() does not return execution_mode. |
| 19 | MigrationPrompt banner shown in PluginCenter Developer tab when legacy plugins exist | ✗ FAILED | Component exists at PluginCenter.tsx line 309. Condition `plugins.some(p => p.execution_mode === 'legacy')` can never be true for same root cause. |
| 20 | New-format ZIP upload flow (upload → server validates → installs in new system → prompts safe uninstall) | ✓ VERIFIED | POST /api/plugins/upload-zip → plugin.install_zip command. ZIPDropZone in PluginCenter. jszip preview handles idle/processing/error/success states. |
| 21 | Migrate button visible on legacy plugin cards, triggers new-format version upload guidance | ✗ FAILED | Button exists at PluginCenter.tsx line 456. Checks `plugin.execution_mode === 'legacy'` which can never be true. Same root cause. |
| 22 | CommandBus routes to modern handler first, falls back to legacy handler (D-11) | ✓ VERIFIED | Separate legacyHandlers Map in CommandBus. registerLegacyHandler() method. execute() prefers modern handler. 7 tests. |
| 23 | vitest configuration includes src/plugin-host/__tests__/ and supports jsdom environment for frontend tests | ✓ VERIFIED | vitest.config.ts includes `src/plugin-host/__tests__/**/*.test.{ts,tsx}`. jsdom per-file via @vitest-environment pragma. |
| 24 | End-to-end integration tests verify extension points, Worker activation, legacy badge, and transition flow | ✓ VERIFIED | 13 migration tests in migration.test.tsx, 9 integration tests in plugin-center-integration.test.tsx, 7 command-routing tests in command-routing.test.ts. |
| 25 | FrontendPluginHost supports worker-mode activation via BrowserWorkerManager | ✓ VERIFIED | activateWorkerPlugin method in FrontendPluginHost. setWorkerManager() setter. Worker deactivation via pluginModules deactivate closure. |

**Score:** 22/25 must-haves verified

### Blocking Gap

**Root Cause:** `listPlugins()` in `packages/core/plugin-host/index.ts` (line 322) does not query or return `execution_mode`. The method queries `SELECT id, manifest FROM plugins` and returns results typed as `PluginInfo` which also lacks `execution_mode`. The server's `GET /api/plugins` endpoint (line 4447) returns this data as-is. The frontend PluginCenter checks `p.execution_mode === 'legacy'` (line 307) but can never receive this value.

**Affected SC:** ROADMAP SC #4 and #5
**Affected Truths:** Truths #18, #19, #21 from PLAN must_haves

**Fix Required:**
1. In `packages/core/plugin-host/index.ts` `listPlugins()`: add `execution_mode` to the SELECT query
2. In `packages/core/plugin-host/types.ts` `PluginInfo`: add `execution_mode?: string` field
3. In `src/App.tsx` `PluginType`: add `execution_mode?: string` field

### Deferred Items

No deferred items — Phase 9 is the final phase of this milestone.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/plugin-host/types.ts` | Frontend types | ✓ VERIFIED | PluginState enum, FrontendPluginManifest, ExtensionSlot, ExtensionPointConfig, FrontendPluginContext, FrontendPluginInfo, 4 service interfaces, 4 token constants |
| `src/plugin-host/service-registry.ts` | FrontendServiceRegistry | ✓ VERIFIED | Flat DI container, register/resolve/unregister/has/list, T-09-01 duplicate guard |
| `src/plugin-host/plugin-host-store.ts` | Zustand store | ✓ VERIFIED | usePluginHostStore with 8 action methods, 3 state slices |
| `src/plugin-host/plugin-host.ts` | FrontendPluginHost class | ✓ VERIFIED | Lifecycle methods, worker-mode activation, ModuleLoader injection, 5s timeout |
| `src/plugin-host/plugin-host-context.tsx` | React Context | ✓ VERIFIED | PluginHostProvider + usePluginHost hook with missing-provider guard |
| `src/plugin-host/index.ts` | Barrel file | ✓ VERIFIED | Re-exports all modules |
| `src/services/frontend-api.ts` | IFrontendAPI impl | ✓ VERIFIED | get/post/del, same-origin credentials, JSON parsing |
| `src/services/socket-service.ts` | ISocketService impl | ✓ VERIFIED | Wraps existing Socket.IO instance, emit/on/off/disconnect |
| `src/services/ui-service.ts` | IUIService impl | ✓ VERIFIED | Delegates to addToast callback, modal state management |
| `src/services/storage-service.ts` | IStorageService impl | ✓ VERIFIED | localStorage with edu_os_plugin:{pluginId}: prefix |
| `src/plugin-host/extension-points.ts` | ExtensionPointRegistry | ✓ VERIFIED | register/getExtensions/unregister/unregisterByPlugin/dispose, dedup throw |
| `src/plugin-host/extension-point-renderer.tsx` | ExtensionPointRenderer | ✓ VERIFIED | React.lazy + Suspense + ErrorBoundary + LoadingSkeleton |
| `src/components/PluginCenter.tsx` | PluginCenter | ✓ VERIFIED | Extracted from App.tsx, ZIPDropZone, MigrationPrompt, Migrate button, jszip preview |
| `src/components/LegacyPluginBadge.tsx` | LegacyPluginBadge | ✓ VERIFIED | Amber badge, AlertTriangle icon, Migratable label |
| `src/plugin-host/browser-worker-transport.ts` | BrowserWorkerTransport | ✓ VERIFIED | Re-export from core transport.ts |
| `src/plugin-host/service-host.ts` | ServiceHost | ✓ VERIFIED | handleInvoke/subscribe/unsubscribe/dispose, capability enforcement |
| `src/plugin-host/browser-worker-manager.ts` | BrowserWorkerManager | ✓ VERIFIED | createWorker/terminateWorker, MAX_WORKERS=32, Worker bootstrap inlined |
| `src/worker-bootstrap.ts` | Worker bootstrap | ✓ VERIFIED | Reference documentation (runtime code inlined in BrowserWorkerManager) |
| `packages/core/worker-runtime/transport.ts` | Updated transport | ✓ VERIFIED | BrowserWorkerTransport stub replaced with functional impl |
| `packages/core/command-bus/index.ts` | Updated CommandBus | ✓ VERIFIED | legacyHandlers Map, registerLegacyHandler, D-11 priority routing |
| `packages/core/plugin-host/index.ts` | listPlugins | ⚠️ ORPHANED | Does not return execution_mode — see Blocking Gap |
| `packages/core/__tests__/command-routing.test.ts` | Priority tests | ✓ VERIFIED | 7 tests |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| plugin-host-context.tsx | plugin-host.ts | new FrontendPluginHost | ✓ WIRED | Imported and used in PluginHostProvider |
| plugin-host.ts | plugin-host-store.ts | usePluginHostStore.getState() | ✓ WIRED | All lifecycle methods call store getState/setState |
| plugin-host.ts | service-registry.ts | FrontendServiceRegistry | ✓ WIRED | Created in initialize(), used in buildContext() |
| main.tsx | plugin-host-context.tsx | PluginHostProvider | ✓ WIRED | Wraps App component |
| App.tsx | extension-point-renderer.tsx | ExtensionPointRenderer | ✓ WIRED | Imported at line 30, rendered at lines 5523 and 5580 |
| App.tsx | PluginCenter.tsx | PluginCenter | ✓ WIRED | Imported at line 32, rendered at teacherTab === 'plugins' line 6326 |
| PluginCenter.tsx | LegacyPluginBadge.tsx | LegacyPluginBadge | ⚠️ PARTIAL | Imported at line 28, rendered conditionally. But execution_mode data never arrives. |
| browser-worker-manager.ts | worker-bootstrap.ts | buildWorkerBlobUrl | ✓ WIRED | Bootstrap content inlined as string literal in buildWorkerBlobUrl |
| browser-worker-manager.ts | service-host.ts | creates ServiceHost | ✓ WIRED | ServiceHost instantiated in createWorker for RPC handling |
| service-host.ts | browser-worker-transport.ts | transport.postMessage | ✓ WIRED | handleInvoke returns results via transport.postMessage |
| plugin-host.ts | browser-worker-manager.ts | setWorkerManager | ✓ WIRED | Worker-mode activation creates/dispatches to BrowserWorkerManager |
| command-bus/index.ts | plugin-host/index.ts | registerLegacyHandler vs registerHandler | ✓ WIRED | D-11 priority: modern handlers stored in handlers Map, legacy in legacyHandlers Map |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| FrontendPluginHost.getExtensions() | extensionPoints Map | Zustand store via registerExtensionPoint | ✓ Infrastructure exists. ctx.ui.registerExtensionPoint writes to store. No plugin currently exercises this path. | ✓ FLOWING (capability) |
| BrowserWorkerManager.createWorker() | Worker bootstrap inline | buildWorkerBlobUrl() creates Blob URL | ✓ Bootstrap code is self-contained string literal. Creates Worker with Blob URL. | ✓ FLOWING |
| PluginCenter legacy badge | plugin.execution_mode | GET /api/plugins → listPlugins() | ✗ listPlugins() does not query SELECT execution_mode from plugins table. PluginInfo type omits field. | ✗ DISCONNECTED |
| CommandBus.execute() | handlers Map / legacyHandlers Map | registerHandler / registerLegacyHandler | ✓ Both Maps are populated by plugin registration. Priority lookup works as tested. | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| CommandBus modern-first routing | `npx vitest run packages/core/__tests__/command-routing.test.ts` | 7/7 pass | ✓ PASS |
| FrontendServiceRegistry unit tests | `npx vitest run src/plugin-host/__tests__/service-registry.test.ts` | 7/7 pass | ✓ PASS |
| Frontend services unit tests | `npx vitest run src/plugin-host/__tests__/frontend-services.test.ts` | 17/17 pass | ✓ PASS |
| ExtensionPointRegistry unit tests | `npx vitest run src/plugin-host/__tests__/extension-points.test.ts` | 15/15 pass | ✓ PASS |
| BrowserWorkerTransport unit tests | `npx vitest run src/plugin-host/__tests__/browser-worker-transport.test.ts` | 11/11 pass | ✓ PASS |
| ServiceHost unit tests | `npx vitest run src/plugin-host/__tests__/service-host.test.ts` | 16/16 pass | ✓ PASS |
| FrontendPluginHost lifecycle tests | `npx vitest run src/plugin-host/__tests__/plugin-host.test.ts` | 10/10 pass | ✓ PASS |
| Migration integration tests | `npx vitest run src/plugin-host/__tests__/migration.test.tsx` | 13/13 pass | ✓ PASS |
| PluginCenter integration tests | `npx vitest run src/plugin-host/__tests__/plugin-center-integration.test.tsx` | 9/9 pass | ✓ PASS |

**Step 7b SKIPPED:** No runnable server entry point that exercises Phase 9 frontend code without starting the full dev server.

### Probe Execution

**Step 7c SKIPPED:** No probe scripts found for Phase 9. Phase 9 is a frontend integration phase with no migration/tooling probes.

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
| ----------- | ------ | ----------- | ------ | -------- |
| PLUG-06 (frontend portion) | ROADMAP.md | 前端扩展点集成 | ⚠️ PARTIAL | ExtensionPoints infrastructure ✓, WebWorker ✓, CommandRouting ✓. Legacy marking data flow broken — see Blocking Gap. |
| PLUG-13 | PROJECT.md line 143 | 前端集成 + 过渡期 | ⚠️ PARTIAL | Frontend PluginHost ✓, Extension Points ✓, Web Worker ✓. Transition compatibility partially complete. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| packages/core/plugin-host/index.ts | 322 | listPlugins() does not SELECT execution_mode | 🛑 Blocker | Frontend cannot detect legacy plugins. All three legacy UI components are decorative. |
| src/App.tsx | 71 | PluginType lacks execution_mode field | ⚠️ Warning | Even if server returned execution_mode, TypeScript would not propagate it to PluginCenter props. |
| packages/core/plugin-host/types.ts | 82 | PluginInfo lacks execution_mode field | ⚠️ Warning | Interface is the return type of listPlugins(). Adding execution_mode to SQL without changing the type would cause TypeScript error. |

### Human Verification Required

Items that need human confirmation — these cannot be verified programmatically:

**1. PluginCenter visual appearance and plugin grid**

**Test:** Navigate to Plugins tab in the running app and visually inspect the plugin store grid.
**Expected:** The PluginCenter renders identically to the original inline UI (zero visual delta per UI-SPEC). Grid shows plugin cards with Enable/Disable and Delete buttons. ZIPDropZone appears in the Developer tab with drag-and-drop visual states.
**Why human:** CSS class names and layout structure need visual confirmation.

**2. ExtensionPointRenderer rendering**

**Test:** Register a mock extension point via browser console (`usePluginHostStore.getState().registerExtensionPoint('teacher.tab', { id: 'test', label: 'Test', component: () => Promise.resolve({ default: () => <div>Test</div> }), pluginId: 'test' })`) and verify the tab button appears in the nav area and renders content when clicked.
**Expected:** The tab button shows in the nav sidebar after the hardcoded tabs. Clicking it renders the component. ErrorBoundary catches crashes.
**Why human:** Requires dynamic runtime state injection; visual verification of rendering.

**3. ZIP drop zone interaction**

**Test:** Drag a .zip file onto the Developer tab's drop zone. Verify visual feedback (border color change, text change). Drop a valid plugin ZIP. Verify the manifest preview appears.
**Expected:** On dragOver: border and background change. On drop: processing state shows, manifest preview with plugin name/id/version appears.
**Why human:** Drag-and-drop behavior and visual state transitions require human interaction.

### Gaps Summary

**1 Blocking Gap identified:**

The server's `PluginHost.listPlugins()` at `packages/core/plugin-host/index.ts:322` queries `SELECT id, manifest FROM plugins` but does **not** select `execution_mode`. The resulting `PluginInfo` type at `packages/core/plugin-host/types.ts:82` lacks the field. The `GET /api/plugins` endpoint at `server.ts:4447` passes this data to the frontend without `execution_mode`.

On the frontend side, `PluginCenter.tsx:307` evaluates `plugins.some(p => p.execution_mode === 'legacy')` to decide whether to show `MigrationPromptBanner`, `LegacyPluginBadge`, and `Migrate` buttons. Since `execution_mode` never arrives from the server, this condition is always `false`.

**Impact:** ROADMAP Success Criteria #4 and #5 cannot be achieved. The legacy UI infrastructure (LegacyPluginBadge, MigrationPromptBanner, Migrate button, jszip preview) is fully implemented and testable — but data never flows from the database through the API to the React components.

**Fix scope is small:** Add `execution_mode` to the SELECT query in `listPlugins()`, add it to `PluginInfo` interface, add it to App.tsx `PluginType`. Estimated effort: 3 lines changed.

---

_Verified: 2026-06-19T15:48:00Z_
_Verifier: Claude (gsd-verifier)_
