# Phase 9: Frontend Integration + Transition Period - Research

**Researched:** 2026-06-19
**Domain:** Frontend Plugin System (React, Web Worker, Extension Points, Dual-System Transition)
**Confidence:** HIGH

## Summary

Phase 9 extends the plugin system into the browser: implementing a frontend PluginHost (browser-side ServiceRegistry, Web Worker management), Extension Points (classroomTools, tabs, views as plugin-registered slots), and a dual-system transition strategy for coexisting old-format and new-format plugins.

The project already has 7 completed phases building the backend plugin infrastructure (Token DI, ESM Loader, PluginHost lifecycle, Worker isolation, EventBus, Hot Reload, middleware). Phase 8 just completed migrating all built-in plugins to the new format. The frontend is currently a monolithic `App.tsx` (11,159 lines) with hardcoded tabs, direct Socket.IO setup, and a plugin management UI that reads plugin data via REST API.

**Primary recommendation:** Build the frontend PluginHost in 4 waves following the backend's proven architecture: (1) ServiceRegistry + PluginHost foundation, (2) Extension Points + App.tsx integration, (3) Web Worker complete implementation, (4) Transition strategy + plugin center UI updates.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Frontend PluginHost Architecture
- **D-01:** Frontend PluginHost mirrors backend design — containing browser-side ServiceRegistry, PluginHost lifecycle (install/activate/deactivate/uninstall), and BrowserWorkerManager. Use zustand (already in dependencies) for frontend PluginHost state management, avoid adding more useState to App.tsx.
- **D-02:** Frontend service Token collection — provide: IFrontendAPI (fetch wrapper, calling /api/*), ISocketService (Socket.IO client), IUIService (Toast/Modal system), IStorageService (localStorage wrapper). Each service registers in the frontend ServiceRegistry as a Token.
- **D-03:** PluginHost instance distributed via React Context to the entire component tree, avoiding prop drilling. App.tsx initializes FrontendPluginHost at the top level and provides it via `<PluginHostProvider>`.

#### Extension Points Design
- **D-04:** Slot-based registration pattern. Plugins register UI components via `ctx.ui.registerExtensionPoint(slot, config)` in activate(). Slot types include: `teacher.dashboard.widget`, `teacher.tab`, `student.view`, `student.lesson.tool`, `classroom.tool`.
- **D-05:** Extension Point components render using React.lazy. Plugins provide a `component` factory function (`() => React.ComponentType`), PluginHost lazy-loads on first render.
- **D-06:** App.tsx hardcoded teacher tabs and student views refactored to render dynamically from PluginHost Extension Points, while retaining core tabs (dashboard, courses, classes, settings) as non-removable defaults.

#### Web Worker Implementation
- **D-07:** Complete Phase 5 BrowserWorkerTransport stub. Use `new Worker(blobUrl)` pattern where blob URL is built from plugin ESM bundle. Flow: Blob URL creation → Worker load → import() execution → ServiceProxy RPC established.
- **D-08:** Frontend ServiceHost mirrors backend `packages/core/worker-runtime/service-host.ts` RPC pattern. Worker plugins communicate via postMessage with main-thread ServiceHost. CapabilityGuard checks on main-thread side.
- **D-09:** Frontend EventBus supports cross-Worker event forwarding. Worker `eventBus.subscribe('lesson.created', handler)` → postMessage → main-thread ServiceHost subscribes to Socket.IO events → forwards to Worker handler.
- **D-10:** Web Worker plugins have restricted access — only via ServiceProxy RPC to main-thread services. No direct DOM/localStorage/fetch access. All DOM operations proxied through IUIService.

#### Dual-System Transition Strategy
- **D-11:** Command routing priority: modern handler first, legacy fallback. CommandBus.getHandler(commandType) checks modern (PluginHost registered new-format handlers) first, then legacy (old bootstrap*Plugins registered handlers). Phase 8 migrated all built-in plugins to new format, this route is primarily for third-party plugin transition.
- **D-12:** Old-format plugins marked `execution_mode = 'legacy'` in plugins table, coexisting with new-format (`'inline'` / `'worker'`). Frontend plugin center UI shows yellow "migratable" badge for legacy plugins.
- **D-13:** Developers upload new-format ZIP packages (with manifest.json) to plugin center, plugin enters new system. Existing old-format (plain JS string) plugins remain usable. When new-format version successfully activates, UI prompts to safely uninstall old-format version.

#### Frontend Plugin Management UI
- **D-14:** Extend plugin center UI (teacherTab === 'plugins') to support: ZIP drag-and-drop upload + manifest preview, legacy badge display, migration prompt banner. Use jszip (already in dependencies) for browser-side ZIP parsing to preview manifest.
- **D-15:** Plugin center adds "Migrate" button (visible only when legacy plugin has a corresponding new-format version), guiding developers through the old-to-new format transition.

#### Migration Priority & Waves
- **D-16:** 4 incremental waves by dependency:
  - Wave 1 (Plan 09-01): Frontend ServiceRegistry + PluginHost foundation
  - Wave 2 (Plan 09-02): Extension Points system + App.tsx integration
  - Wave 3 (Plan 09-03): Browser Web Worker complete implementation + ServiceProxy
  - Wave 4 (Plan 09-04): Transition compatibility strategy + frontend plugin management UI updates + end-to-end testing

### Claude's Discretion
- **D-17:** React Context vs zustand specific usage ratio, Extension Point type definition details, Blob URL caching strategy, frontend ServiceRegistry namespace sharing with backend (recommended: share) — all at developer's discretion.
- **D-18:** vitest + jsdom test strategy, Web Worker mock approach, Extension Point rendering test approach — at developer's discretion.

### Deferred Ideas (OUT OF SCOPE)
- Frontend App.tsx split into micro-frontend architecture → independent phase
- Frontend plugin marketplace/store → needs CDN, auditing, payment infrastructure
- Frontend ServiceRegistry sharing Token definitions with backend (isomorphic DI) → attractive but adds complexity without affecting target
- PWA / Service Worker offline support → independent phase
</user_constraints>

## Phase Requirements

### PLUG-06 (Frontend Portion): Frontend Extension Point Integration

| Requirement | Description | Research Support |
|-------------|-------------|------------------|
| Frontend PluginHost | Browser-side ServiceRegistry + PluginHost lifecycle (install/activate/deactivate/uninstall) + BrowserWorkerManager | Backend PluginHost (`packages/core/plugin-host/index.ts`) and ServiceRegistry (`packages/core/di/service-registry.ts`) serve as reference implementations. Frontend PluginHost uses zustand for state management. |
| Frontend Services | IFrontendAPI (fetch), ISocketService (Socket.IO), IUIService (Toast/Modal), IStorageService (localStorage) | Existing Socket.IO client in App.tsx (lines 3356-3528), existing toast system (lines 1724-1730), existing fetch calls throughout App.tsx, existing localStorage references |
| App.tsx tab refactoring | Refactor hardcoded teacherTab conditionals (lines 5553-8583) to dynamic extension points | Core tabs (dashboard, courses, classes, settings) remain hardcoded. Others become dynamic via ExtensionPointRenderer. |
| classroomTools integration | Migrate from manifest.json parsing in LiveClassroomView.tsx (lines 196-208) to formal extension point | Existing classroomTools in rollcall manifest.json (`packages/plugins/rollcall/manifest.json`) |
| Extension Points | Slot-based: teacher.tab, student.view, classroom.tool, teacher.dashboard.widget, student.lesson.tool | Pattern established in CONTEXT.md D-04 through D-06. |
| React.lazy rendering | Extension Point components loaded via React.lazy with Suspense fallback | Standard React pattern, no external library needed |
| React Context distribution | PluginHost instance provided via PluginHostProvider wrapping component tree | Standard React Context pattern |
| Browser Worker isolation | Complete BrowserWorkerTransport stub (currently throws WorkerNotSupportedError) | Existing stub at `packages/core/worker-runtime/transport.ts:119-137` |
| RPC ServiceProxy | Worker plugins access frontend services via IPC proxy mirroring backend pattern | Backend ServiceHost (`packages/core/worker-runtime/service-host.ts`) and ServiceProxy as reference |
| Cross-Worker event forwarding | Worker event subscriptions forwarded via postMessage ↔ main-thread ↔ Socket.IO | Backend EventForwarder (`packages/core/worker-runtime/event-forwarder.ts`) as reference |
| Dual-system transition | Command routing priority (modern > legacy), execution_mode='legacy' flag, migration UI | DB column already exists (`execution_mode TEXT DEFAULT 'inline'` at line 320) |
| Plugin center enhancement | ZIP drag-drop upload, legacy badge, migration button | Existing plugin center at lines 6295-6757, existing ZIP upload at lines 4196-4225 |
| zustand for state | Use existing zustand for frontend PluginHost state (plugins list, active plugins, extension points) | zustand 5.0.14 already in dependencies, unused. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plugin state management | Browser | — | Plugin activation state, extension point registry, service instances live in the browser. Zustand store scoped to frontend. |
| Extension Point registration | Browser | — | Plugins register UI components (tabs, views, tools) in browser memory. The PluginHost manages these registrations. |
| Extension Point rendering | Browser | — | React.lazy + Suspense for dynamic component rendering. Pure browser responsibility. |
| Web Worker lifecycle | Browser | — | Worker creation, message routing, termination — all browser APIs. |
| ServiceProxy RPC | Browser (both sides) | — | Both Worker-side proxy and main-thread ServiceHost live in the browser, communicating via postMessage. |
| Command routing (modern/legacy) | Backend | Browser | The CommandBus is backend-side (registered through the kernel's DI). Priority routing logic applies server-side where both handler types coexist. |
| Plugin ZIP upload & management | Backend API | Browser UI | Existing REST API (`/api/plugins`, `/api/plugins/upload-zip`) handles backend. Frontend only provides UI and client-side ZIP preview. |
| Events (Socket.IO) | Browser | — | Socket.IO client runs in browser. Event forwarding from Worker to main-thread and back is browser-only. |
| Toast/Modal/DOM | Browser | — | IUIService owns all DOM interactions. No Worker should touch DOM directly. |
| data fetching (REST) | Browser (via API) | — | IFrontendAPI provides fetch wrapper calling /api/*. All data persistence goes through backend REST endpoints. |

## Standard Stack

### Core Frontend PluginHost Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.0.14 | Frontend PluginHost global state | Already in dependencies, designed for React without boilerplate, perfect for cross-component plugin state [VERIFIED: npm registry] |
| socket.io-client | 4.8.3 | WebSocket client for real-time events | Already in dependencies, App.tsx already uses it (line 27) [VERIFIED: npm registry] |
| jszip | 3.10.1 | Browser-side ZIP parsing for manifest preview | Already in dependencies, used for plugin package inspection before upload [VERIFIED: npm registry] |
| lucide-react | 0.546.0 | Plugin UI slot icon rendering | Already in dependencies, used for classroomTool DynamicIcon rendering [VERIFIED: npm registry] |

### No New Dependencies Needed

All required libraries (zustand, socket.io-client, jszip) are already in package.json. The frontend PluginHost can be built entirely with these existing dependencies plus native browser APIs (Web Worker, structured clone, Blob URL, postMessage).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| zustand | Redux, Jotai, Valtio | Already in package.json, simpler than Redux, more structured than raw useState (D-01). Avoids adding 160+ useStates that App.tsx already suffers from. |
| Blob URL + import() | data: URL (used in Node.js) | Blob URL is the browser-equivalent of Node.js data: URL. Both implementations already exist in BrowserEsmLoader (`packages/core/esm-loader/browser-loader.ts`). |
| postMessage IPC | comlink library | Backend already uses custom Proxy (D-08 in Phase 5). Keeping consistent with backend pattern avoids adding comlink dependency. |

**No npm install needed** — all dependencies are already present.

## Package Legitimacy Audit

> No new packages required. Phase 9 uses only existing project dependencies (zustand, socket.io-client, jszip all already installed). Skipping slopcheck — no new external packages to audit.

| Package | Registry | Status | Notes |
|---------|----------|--------|-------|
| zustand | npm | Already installed | 5.0.14, 28M+/wk downloads, validated by existing project |
| socket.io-client | npm | Already installed | 4.8.3, validated by existing App.tsx usage |
| jszip | npm | Already installed | 3.10.1, validated by existing project |
| motion | npm | Already installed | 12.23.24, for animation if needed |
| lucide-react | npm | Already installed | 0.546.0, for extension point icons |

**New npm install commands (none needed):** All frontend PluginHost components use native browser APIs (Web Worker, Blob URL, postMessage, structured clone) plus the 5 already-installed dependencies.

## Architecture Patterns

### System Architecture Diagram

```
Browser Main Thread
┌──────────────────────────────────────────────────────────────────┐
│  main.tsx                                                        │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  <PluginHostProvider>                                   │      │
│  │  ┌─────────────────────────────────────────────────┐   │      │
│  │  │  FrontendPluginHost (zustand store)             │   │      │
│  │  │  ├─ FrontendServiceRegistry                     │   │      │
│  │  │  │  ├─ IFrontendAPI (fetch wrapper)             │   │      │
│  │  │  │  ├─ ISocketService (Socket.IO wrapper)       │   │      │
│  │  │  │  ├─ IUIService (Toast/Modal system)          │   │      │
│  │  │  │  └─ IStorageService (localStorage)           │   │      │
│  │  │  ├─ ExtensionPointRegistry                      │   │      │
│  │  │  │  ├─ teacher.tab slots                        │   │      │
│  │  │  │  ├─ student.view slots                       │   │      │
│  │  │  │  ├─ classroom.tool slots                     │   │      │
│  │  │  │  └─ ...                                      │   │      │
│  │  │  └─ BrowserWorkerManager                        │   │      │
│  │  │     └─ WorkerRegistry (Map<pluginId, Worker>)   │   │      │
│  │  └─────────────────────────────────────────────────┘   │      │
│  │                                                         │      │
│  │  App.tsx (refactored)                                   │      │
│  │  ├─ <ExtensionPointRenderer slot="teacher.tab">         │      │
│  │  │   ├─ Core: dashboard (hardcoded)                    │      │
│  │  │   ├─ Core: courses (hardcoded)                      │      │
│  │  │   ├─ Core: classes (hardcoded)                      │      │
│  │  │   ├─ Core: settings (hardcoded)                     │      │
│  │  │   └─ Dynamic: {plugin tabs} (from ExtensionPoint)   │      │
│  │  ├─ <ExtensionPointRenderer slot="student.view">       │      │
│  │  │   ├─ Core: dashboard (hardcoded)                    │      │
│  │  │   ├─ Core: lesson (hardcoded)                       │      │
│  │  │   └─ Dynamic: {plugin views} (from ExtensionPoint)  │      │
│  │  ├─ <ExtensionPointRenderer slot="classroom.tool">     │      │
│  │  └─ PluginCenter (store+dev tabs, legacy badges)       │      │
│  └─────────────────────────────────────────────────────┘      │
│                                                                │
│  Inline Plugins (context-builder wrapped services)             │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  import(blobUrl) → activate(ctx: PluginContext)         │   │
│  │  ctx.services = { commandBus, eventBus, ...backend}     │   │
│  │  ctx.ui = { registerExtensionPoint }                    │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  Web Worker Plugins (IPC isolated)                             │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  new Worker(blobUrl)                                   │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │  Worker Thread                                  │   │   │
│  │  │  ├─ import(pluginCode)                          │   │   │
│  │  │  ├─ activate(ctx)                               │   │   │
│  │  │  ├─ ctx.services = ServiceProxy(IPC proxies)    │   │   │
│  │  │  └─ ctx.ui = UIServiceProxy(IPC to main-thread) │   │   │
│  │  └───────────────┬─────────────────────────────────┘   │   │
│  │                  │ postMessage                          │   │
│  │  ┌───────────────▼──────────────────────────────────┐   │   │
│  │  │  Main-thread ServiceHost                         │   │   │
│  │  │  ├─ RPC: resolves frontend services              │   │   │
│  │  │  ├─ EventForwarder: Socket.IO → Worker events    │   │   │
│  │  │  └─ CapabilityGuard: enforces permissions         │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  Socket.IO Connection (in browser)                             │
│  └──────────┬──────────────────────────────────────────┘      │
│             │ socket.io-client                                 │
│             ▼                                                  │
│  Server (Express + Socket.IO)                                  │
│  ├─ /api/plugins (REST)                                        │
│  ├─ /api/plugins/upload-zip (REST)                             │
│  └─ Socket.IO events (presence-update, student-picked, ...)    │
└──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── main.tsx                           # React entry — wrap with PluginHostProvider
├── App.tsx                            # Refactored: extension points replace some hardcoded render
├── services/                          # NEW: Frontend IService implementations
│   ├── frontend-api.ts                # IFrontendAPI — fetch wrapper with session
│   ├── socket-service.ts              # ISocketService — Socket.IO wrapper
│   ├── ui-service.ts                  # IUIService — Toast/Modal management
│   └── storage-service.ts             # IStorageService — localStorage wrapper
├── plugin-host/                        # NEW: Frontend PluginHost
│   ├── types.ts                       # Frontend-specific types (ExtensionSlot, ExtensionPoint, FrontendPluginContext)
│   ├── service-registry.ts            # Simplified browser ServiceRegistry (mirrors backend but flatter)
│   ├── plugin-host-store.ts           # Zustand store for PluginHost state
│   ├── plugin-host.ts                 # Frontend PluginHost lifecycle manager
│   ├── plugin-host-context.tsx         # React Context + PluginHostProvider
│   ├── extension-point-renderer.tsx    # ExtensionPointRenderer component (React.lazy + Suspense)
│   ├── extension-points.ts            # ExtensionPointRegistry (slot-based registration)
│   ├── browser-worker-transport.ts    # Complete BrowserWorkerTransport implementation
│   ├── browser-worker-manager.ts      # Web Worker lifecycle manager (mirrors backend WorkerManager)
│   └── service-host.ts               # Frontend ServiceHost (RPC handler via postMessage)
├── components/
│   ├── ... (existing 19 components, unchanged)
│   ├── PluginCenter.tsx               # NEW: Extracted from App.tsx lines 6295-6757
│   └── LegacyPluginBadge.tsx          # NEW: Yellow migration badge component
└── worker-bootstrap.ts                # NEW: Web Worker bootstrap code (ESM, import()-based)

packages/core/worker-runtime/
├── transport.ts                       # MODIFY: Complete BrowserWorkerTransport (replace stub)
├── ... (other files unchanged)
```

### Pattern 1: Frontend PluginHost Context Distribution

**What:** Frontend PluginHost distributed via React Context, avoiding prop drilling.

```typescript
// Source: Derived from backend PluginHost pattern + React Context pattern

// plugin-host-store.ts — Zustand store
import { create } from 'zustand';

interface PluginHostState {
  activePlugins: Map<string, FrontendPluginManifest>;
  extensionPoints: Map<string, ExtensionPointRegistration[]>;
  services: FrontendServiceRegistry;
  // ...
}

export const usePluginHostStore = create<PluginHostState>((set) => ({
  activePlugins: new Map(),
  extensionPoints: new Map(),
  services: new FrontendServiceRegistry(),
  // ...
}));

// plugin-host-context.tsx — React Context
import React, { createContext, useContext } from 'react';
import { FrontendPluginHost } from './plugin-host';

const PluginHostContext = createContext<FrontendPluginHost | null>(null);

export function PluginHostProvider({ children }: { children: React.ReactNode }) {
  const [host] = useState(() => new FrontendPluginHost(
    usePluginHostStore.getState().services
  ));
  return (
    <PluginHostContext.Provider value={host}>
      {children}
    </PluginHostContext.Provider>
  );
}

export function usePluginHost(): FrontendPluginHost {
  const ctx = useContext(PluginHostContext);
  if (!ctx) throw new Error('usePluginHost must be used within PluginHostProvider');
  return ctx;
}
```

### Pattern 2: Extension Point Registration + Rendering

**What:** Plugins register UI components via `ctx.ui.registerExtensionPoint(slot, config)`. The ExtensionPointRenderer dynamically renders them using React.lazy.

```typescript
// extension-points.ts — Registry
interface ExtensionPointConfig {
  id: string;
  label: string;
  icon?: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  position?: number; // sort order
}

class ExtensionPointRegistry {
  private slots = new Map<string, ExtensionPointConfig[]>();

  register(slot: string, config: ExtensionPointConfig): void {
    const items = this.slots.get(slot) ?? [];
    items.push(config);
    items.sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
    this.slots.set(slot, items);
  }

  getExtensions(slot: string): ExtensionPointConfig[] {
    return this.slots.get(slot) ?? [];
  }

  unregister(slot: string, id: string): void {
    const items = this.slots.get(slot);
    if (!items) return;
    this.slots.set(slot, items.filter(i => i.id !== id));
  }

  dispose(): void {
    this.slots.clear();
  }
}

// extension-point-renderer.tsx — Dynamic rendering
function ExtensionPointRenderer({ slot, fallback }: {
  slot: string;
  fallback?: React.ReactNode;
}) {
  const host = usePluginHost();
  const extensions = host.getExtensions(slot);

  return (
    <>
      {extensions.map(ext => (
        <React.Suspense key={ext.id} fallback={fallback ?? <LoadingSkeleton />}>
          {React.createElement(React.lazy(ext.component))}
        </React.Suspense>
      ))}
    </>
  );
}
```

### Pattern 3: Web Worker Bootstrap

**What:** Worker bootstrap using Blob URL + import() pattern, reusing BrowserEsmLoader.

```typescript
// worker-bootstrap.ts — Bootstraps in Web Worker context
import { createServiceProxies, createEventBusProxy } from './worker-rpc';

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'activate') {
    const { pluginCode, manifest, serviceTokens } = msg;

    // Create service proxies (IPC to main-thread)
    const services = createServiceProxies(serviceTokens, self);
    const eventBusProxy = createEventBusProxy(self);

    // Load plugin code via import() on Blob URL
    const blob = new Blob([pluginCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const mod = await import(url);
    URL.revokeObjectURL(url);

    const plugin = mod.default ?? mod;

    // Build context with proxy services
    const ctx = {
      services: { ...services, eventBus: eventBusProxy },
      pluginId: manifest.id,
      manifest,
      ui: { /* UI proxy — all proxied to main-thread */ },
      resolve: async (token: string) => { /* proxy resolve */ },
    };

    await plugin.activate(ctx);
    self.postMessage({ type: 'activated' });
  }
};
```

### Anti-Patterns to Avoid

- **Direct DOM manipulation from Worker:** Workers cannot access DOM — all DOM operations MUST go through IUIService proxy (D-10 violation).
- **Complicated dependency injection in frontend ServiceRegistry:** Frontend services have flat dependencies (unlike backend's topological sort). Keep the registry simple with register/resolve only, no topological ordering (per CONTEXT.md specifics).
- **Breaking App.tsx into micro-frontend architecture:** This is explicitly deferred. Phase 9 works within the existing monolithic App.tsx structure, using extension points to render dynamic content without splitting the SPA.
- **Toast/modal state in zustand:** Keep toast state local in App.tsx. The IUIService wraps the existing addToast function, it doesn't replace it with a global state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| React state for plugin lifecycle | Another useState in App.tsx | zustand (already in deps) | App.tsx already has 160+ useStates (D-01). zustand provides structured, cross-component state without adding to the App monolith. |
| Blob URL management | Custom Blob URL lifecycle | URL.createObjectURL + URL.revokeObjectURL | Standard browser API, already used in BrowserEsmLoader. Clean up in finally block to prevent memory leaks. |
| Web Worker communication protocol | Custom transport protocol from scratch | postMessage + structured clone | Same protocol used by backend (NodeWorkerTransport). Frontend BrowserWorkerTransport mirrors the same InvokeMessage/ResultMessage/ErrorMessage types from `packages/core/worker-runtime/types.ts`. |
| Service RPC proxy | comlink or other library | JavaScript Proxy + Reflect (same as backend) | Consistent with backend approach (Phase 5 D-08). Custom Proxy is ~30 lines, avoids adding comlink dependency. |

**Key insight:** The backend has already solved all architectural problems (RPC protocol, PluginHost state machine, ResourceTracker, CapabilityGuard middleware) in Phases 1-8. The frontend mirrors these solutions using browser-native APIs (Web Worker, Blob URL, postMessage, structured clone) rather than Node.js APIs (worker_threads, Buffer, data: URL). The primary difference is that frontend services have flat dependencies (no topological sort needed).

## Common Pitfalls

### Pitfall 1: Blob URL Memory Leaks
**What goes wrong:** Blob URLs created but never revoked, causing browser memory to grow with each plugin activation/reload.
**Why it happens:** URL.createObjectURL() persists until URL.revokeObjectURL() is called or the document is unloaded. In a long-running SPA, unreleased Blob URLs accumulate.
**How to avoid:** Always wrap Blob URL usage in try/finally blocks calling URL.revokeObjectURL(). Follow the existing BrowserEsmLoader pattern (browser-loader.ts lines 41-42).
**Warning signs:** Chrome DevTools → Performance → Memory showing growing "Blob" allocation.

### Pitfall 2: Structured Clone Serialization Errors
**What goes wrong:** postMessage DataCloneError when trying to send unserializable data (functions, Symbols, WeakRefs, DOM nodes) across the Worker boundary.
**Why it happens:** postMessage uses the structured clone algorithm which cannot serialize certain types.
**How to avoid:** Enforce that all RPC call arguments and return values are structured-clone-safe. Follow backend pattern (ServiceHost.ts lines 389-390) with documented constraint.
**Warning signs:** Runtime "DataCloneError: X could not be cloned" errors.

### Pitfall 3: Extension Point Render Conflicts
**What goes wrong:** Multiple plugins register the same extension ID, causing duplicate or competing registrations.
**Why it happens:** No deduplication at ExtensionPointRegistry level.
**How to avoid:** Throw on duplicate registration for the same slot+id combination. Last-registered-wins is acceptable for dynamic scenarios.
**Warning signs:** Two plugins showing in the same tab slot.

### Pitfall 4: Worker Plugin Event Subscription Leaks
**What goes wrong:** Worker plugins subscribe to events but the main-thread EventForwarder subscription is not cleaned up when the Worker terminates or the plugin is deactivated.
**Why it happens:** The EventForwarder is lazily created and must be explicitly disposed via disposeEventForwarder() in the ServiceHost.
**How to avoid:** Follow the backend pattern exactly: BrowserWorkerManager.terminateWorker() MUST call serviceHost.disposeEventForwarder() before Worker termination, exactly as done in backend worker-manager.ts (line 744).
**Warning signs:** After deactivating a Worker plugin, Socket.IO events still trigger Worker-side handlers.

### Pitfall 5: Zustand Store Sharing Between PluginHost and App.tsx State
**What goes wrong:** Creating separate zustand stores for different concerns leads to confusion about where plugin state lives.
**Why it happens:** App.tsx uses raw useState extensively. Adding zustand without coordination creates a fractured state model.
**How to avoid:** Keep PluginHost state (plugins, extension points, services) in a single zustand store. Keep App.tsx's existing business state (lessons, classes, students) in useState. The boundary is clear: PluginHost store = infrastructure, useState = business data.
**Warning signs:** Same data (e.g., plugin list) stored in both zustand and useState.

### Pitfall 6: Command Handler Priority Confusion in Dual-System
**What goes wrong:** During transition, both old and new systems register handlers for the same commandType, causing duplicate execution or double-counting.
**Why it happens:** Phase 8 already migrated built-in plugins, but third-party old plugins still exist. Without explicit routing, both handlers fire.
**How to avoid:** The CommandBus must have a single handler per commandType (not a list). Priority: check new-format handlers first, then legacy. Phase 8 already migrated all built-in plugins, so for built-in commands only the new-format handler exists. For third-party plugins, the old handler only fires when no new-format handler is registered.
**Warning signs:** A command is executed twice (UI shows double effect).

### Pitfall 7: Extension Point Rendering in SSR/Testing Environments
**What goes wrong:** React.lazy + Suspense fail in non-browser environments (vitest with node environment, SSR).
**Why it happens:** React.lazy requires a browser-like environment with Promise support for dynamic imports.
**How to avoid:** Use vitest with jsdom environment for Extension Point component tests (D-18). The vitest.config.ts currently uses `environment: 'node'` — add a separate test config or override for frontend tests.
**Warning signs:** Test runner crashes with "React.lazy is not supported in server environment" or similar.

## Code Examples

### Frontend ServiceRegistry (Simplified)

```typescript
// Source: Derived from packages/core/di/service-registry.ts (flattened for browser)

/**
 * Simplified frontend ServiceRegistry.
 *
 * Unlike the backend ServiceRegistry, this implementation does NOT use
 * topological sort or circular dependency detection — frontend services
 * have flat dependency graphs (D-17).
 *
 * API matches backend: register / resolve / resolveByName for consistency,
 * reducing the learning curve for developers familiar with the backend DI.
 */
class FrontendServiceRegistry {
  private services = new Map<string, unknown>();

  async register<T>(token: string, instance: T): Promise<void> {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.services.set(token, instance);
  }

  async resolve<T>(token: string): Promise<T> {
    const instance = this.services.get(token);
    if (!instance) {
      throw new Error(`No provider registered for token: ${token}`);
    }
    return instance as T;
  }

  async unregister(token: string): Promise<void> {
    this.services.delete(token);
  }

  has(token: string): boolean {
    return this.services.has(token);
  }

  list(): Array<{ name: string; instance: unknown }> {
    return Array.from(this.services.entries()).map(([name, instance]) => ({ name, instance }));
  }
}
```

### Frontend PluginHost Activation (Inline Mode)

```typescript
// Source: Derived from packages/core/plugin-host/index.ts (activatePlugin method)

import { BrowserEsmLoader } from '../core/esm-loader/browser-loader.js';

async activatePlugin(pluginId: string, sourceCode: string): Promise<void> {
  this.setState(pluginId, PluginState.ACTIVATING);

  try {
    // 1. Load plugin via BrowserEsmLoader (Blob URL + import())
    const loader = new BrowserEsmLoader();
    const mod = await loader.load(sourceCode);
    const plugin = mod.default ?? mod;

    if (!plugin.manifest || typeof plugin.activate !== 'function') {
      throw new Error('Invalid plugin: missing manifest or activate function');
    }

    // 2. Register extension points from manifest
    if (plugin.manifest.classroomTools) {
      for (const tool of plugin.manifest.classroomTools) {
        this.extensionPoints.register('classroom.tool', {
          id: tool.id,
          label: tool.name,
          icon: tool.icon,
          commandType: tool.commandType,
          payload: tool.payload,
          description: tool.description,
          pluginId,
        });
      }
    }

    // 3. Build context with frontend services
    const ctx = await this.buildContext(pluginId, plugin.manifest);

    // 4. Call activate with timeout (5s)
    await Promise.race([
      plugin.activate(ctx),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Activation timeout')), 5000)
      ),
    ]);

    // 5. Mark as active
    this.setState(pluginId, PluginState.ACTIVE);
    this.pluginInstances.set(pluginId, plugin);
  } catch (err) {
    this.setState(pluginId, PluginState.ERROR);
    this.extensionPoints.unregisterByPlugin(pluginId);
    throw err;
  }
}
```

### BrowserWorkerTransport Complete Implementation

```typescript
// Source: Derived from packages/core/worker-runtime/transport.ts (NodeWorkerTransport as reference)

import type { IWorkerTransport } from '../worker-runtime/types.js';
import { WorkerTransportError } from '../worker-runtime/errors.js';

export class BrowserWorkerTransport implements IWorkerTransport {
  private messageHandler: ((msg: any) => void) | null = null;
  readonly id: string;

  constructor(private readonly worker: Worker) {
    this.id = `browser-worker:${Date.now()}`;
    this.worker.onmessage = (event: MessageEvent) => {
      if (this.messageHandler) {
        this.messageHandler(event.data);
      }
    };
    this.worker.onerror = (event: ErrorEvent) => {
      console.error(`[BrowserWorkerTransport] Worker error:`, event.error);
    };
  }

  postMessage(msg: unknown): void {
    try {
      this.worker.postMessage(msg);
    } catch (err) {
      throw new WorkerTransportError(
        `Failed to postMessage: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  onMessage(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  async terminate(): Promise<void> {
    this.worker.terminate();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| classroomTools parsed from manifest.json string in LiveClassroomView.tsx | ExtensionPointRegistry formal slot registration | Phase 9 | Plugins register tools via `ctx.ui.registerExtensionPoint('classroom.tool', config)` instead of adding JSON to manifest and manually parsing |
| Plugin center as conditional render in App.tsx (lines 6295-6757) | PluginCenter extracted component | Phase 9 | Better maintainability, can be independently tested |
| App.tsx hardcoded studentViewStatus conditionals (lines 4588-4805) | Dynamic ExtensionPointRenderer for student.view slot | Phase 9 | Third-party plugins can add student views without modifying App.tsx |
| BrowserWorkerTransport throws WorkerNotSupportedError | Fully functional postMessage-based transport | Phase 9 | Worker-mode plugins work in browser, not just Node.js |
| Old format: plain JS string in plugins table | New format: ZIP with manifest.json + ESM bundle | Phase 8-9 (Phase 8 done back-compat) | All new plugins use standard ESM packaging format |
| Plugin install: sourceCode POST to /api/plugins | Plugin install: ZIP upload + manifest validation | Phase 8-9 (both coexist) | ZIP format supports multi-file plugins with assets |

**Deprecated/outdated:**
- `packages/core/plugin-runtime/index.ts`: vm-based execution — removed in Phase 8
- Old CJS format plugin code (`exports.default = { manifest: { ... } }`): no longer the primary format, supported as legacy (execution_mode='legacy')

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Frontend services (IFrontendAPI, ISocketService etc.) have flat dependency graphs — no topological ordering needed | Standard Stack | Adding topological sort adds ~10-20% more code but doesn't break anything; the code would just be more complex than needed |
| A2 | zustand 5.0.14 API is stable for PluginHost state | Standard Stack | zustand 5 API differs from v4 — if the installed version differs from npm registry latest, migration needed, but package.json pins `^5.0.14` so this is fine |
| A3 | The existing `execution_mode` column in plugins table is sufficient for legacy flagging | Architecture Patterns | If the column doesn't distinguish 'legacy' from 'inline' properly, may need a schema ALTER to add `format: 'new'|'old'` flag |
| A4 | Blob URL + new Worker() works for dynamically generated code in all modern browsers | Architecture Patterns | Edge cases in older browsers (<2020) — but project targets Node.js 20+ and modern browsers per constraints |
| A5 | Extracted PluginCenter component can share App.tsx's useState without prop drilling | Architecture Patterns | If extracted PluginCenter needs too many props, the PluginHostProvider context can help but adds coupling |

## Open Questions

1. **Frontend PluginContext — should `ctx.ui` be part of the same PluginContext interface used by both inline and Worker plugins?**
   - What we know: Backend PluginContext (`packages/core/plugin-host/types.ts`) has only `services`, `pluginId`, `manifest`, `resolve`. Frontend needs to add `ui` (for extension points).
   - What's unclear: Whether to extend the same PluginContext interface (backend + frontend share the same type) or create a separate FrontendPluginContext.
   - Recommendation: Create a FrontendPluginContext that extends or wraps PluginContext with `ui` property. Inline plugins get full frontend services + UI; Worker plugins get only proxied versions.

2. **How to handle App.tsx's existing Socket.IO connection when wrapping with ISocketService?**
   - What we know: App.tsx already calls `io()` at line 3357 and listens to many events (presence-update, student-progress-updated, etc.)
   - What's unclear: Should ISocketService manage the singleton socket connection, or should App.tsx keep its own connection and ISocketService just be a thin wrapper?
   - Recommendation: ISocketService wraps the existing `io()` instance. App.tsx's event listeners remain as-is. ISocketService provides `emit()` and `on()` for plugin use. This avoids breaking existing functionality.

3. **How to handle legacy plugin migration prompts without a plugin "store" (which is deferred)?**
   - What we know: The plugin market/store is deferred (out of scope). But D-15 mentions a "Migrate" button for legacy plugins.
   - What's unclear: Where does the new-format version of a legacy plugin come from if there's no store? Is it uploaded manually by the developer?
   - Recommendation: The "Migrate" button guides the developer to download/upload a new-format ZIP. Without a store, migration is manual — the button opens the file picker for the new ZIP upload, then shows comparison info.

4. **Extension Point rendering — how to pass plugin-specific props to the lazy-loaded component?**
   - What we know: React.lazy returns a component from a dynamic import(), but different extension slots need different props (e.g., teacher.tab gets `{ lang, session }`, classroom.tool gets `{ lessonId, classId, addToast }`).
   - What's unclear: The props contract for each slot type.
   - Recommendation: Define slot-specific prop interfaces in the ExtensionPointConfig. When the ExtensionPointRenderer renders a slot, it passes the appropriate props based on slot type. Document each slot's prop contract as part of the API.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Web Worker (Worker API) | BrowserWorkerManager | ✓ | Native browser API | — (all modern browsers) |
| Blob URL | BrowserEsmLoader, Worker bootstrap | ✓ | Native browser API | — |
| zustand | PluginHost state management | ✓ | 5.0.14 | — |
| socket.io-client | ISocketService | ✓ | 4.8.3 | — |
| jszip | ZIP preview in PluginCenter | ✓ | 3.10.1 | — |
| React Context | PluginHostProvider | ✓ | 19.0 | — |
| React.lazy + Suspense | ExtensionPoint rendering | ✓ | 19.0 | — |
| structuredClone | Worker IPC | ✓ | Native browser API | Manual polyfill (not needed) |

**Missing dependencies with no fallback:** None — all required capabilities are either native browser APIs or already-installed npm packages.

**Missing dependencies with fallback:** None identified.

## Validation Architecture

> workflow.nyquist_validation is implicitly set (key absent from config.json). Include validation section.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 + jsdom 29.1.1 (browser environment overrides for frontend tests) |
| Config file | vitest.config.ts — needs frontend test path addition + environment override for browser tests |
| Quick run command | `npx vitest run src/plugin-host/__tests__/` (after test files created) |
| Full suite command | `npx vitest run` (after config updated) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | FrontendServiceRegistry register/resolve/unregister | unit | `npx vitest run src/plugin-host/__tests__/service-registry.test.ts` | No — Wave 0 |
| D-03 | PluginHostProvider context distribution | unit (jsdom) | `npx vitest run src/plugin-host/__tests__/plugin-host-context.test.ts` | No — Wave 0 |
| D-04/D-05 | Extension point register + React.lazy render | unit (jsdom) | `npx vitest run src/plugin-host/__tests__/extension-points.test.ts` | No — Wave 0 |
| D-07/D-08 | BrowserWorkerTransport postMessage/onMessage/terminate | unit (jsdom) | `npx vitest run packages/core/worker-runtime/__tests__/transport.test.ts` | Yes (existing, needs BrowserWorkerTransport update) |
| D-09 | Cross-Worker event forwarding | integration (jsdom) | `npx vitest run src/plugin-host/__tests__/event-forwarding.test.ts` | No — Wave 0 |
| D-11 | Command routing priority (modern > legacy) | unit | `npx vitest run packages/core/__tests__/command-routing.test.ts` or existing CommandBus test | No — Wave 0 |
| D-12 | Plugin center legacy badge rendering | component (jsdom) | `npx vitest run src/plugin-host/__tests__/plugin-center.test.ts` | No — Wave 0 |
| D-14 | ZIP preview with jszip | unit (jsdom) | `npx vitest run src/plugin-host/__tests__/zip-preview.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/plugin-host/__tests__/` (frontend plugin tests only, ~5s)
- **Per wave merge:** `npx vitest run` (full suite, ~30s, includes existing backend tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/plugin-host/__tests__/service-registry.test.ts` — covers FrontendServiceRegistry
- [ ] `src/plugin-host/__tests__/plugin-host-context.test.ts` — covers PluginHostProvider + React Context
- [ ] `src/plugin-host/__tests__/extension-points.test.ts` — covers registration + React.lazy rendering
- [ ] `src/plugin-host/__tests__/event-forwarding.test.ts` — covers cross-Worker event forwarding
- [ ] `src/plugin-host/__tests__/plugin-center.test.ts` — covers legacy badge + migration UI
- [ ] `src/plugin-host/__tests__/zip-preview.test.ts` — covers jszip manifest preview
- [ ] vitest.config.ts update — add `src/plugin-host/__tests__/**/*.test.ts` to include paths
- [ ] jsdom environment override — create separate vitest.config.frontend.ts or use `// @vitest-environment jsdom` pragma in test files

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Session handling is backend-only; frontend uses session cookies established by Express |
| V3 Session Management | No | Session lifecycle is backend managed |
| V4 Access Control | No | CapabilityGuard is backend-managed; frontend only displays what backend returns |
| V5 Input Validation | Yes | Plugin manifest validation via zod on ZIP upload; extension point component input validation |
| V6 Cryptography | No | No crypto in browser beyond structured clone safe serialization |
| V14 Configuration | No | No new configuration secrets |

### Known Threat Patterns for Browser Plugin Host

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-extension data leakage | Information Disclosure | Per-plugin key isolation in IStorageService (localStorage namespaced by pluginId, same as backend's plugin_storage namespace pattern) |
| Malicious Worker plugin accessing DOM | Tampering | D-10 enforcement: Worker plugins must NOT access DOM directly. All UI operations go through IUIService proxy which sanitizes inputs. |
| Blob URL code injection | Tampering | Blob URLs are same-origin only. Plugin source code validated by manifestSchema before Worker creation. Source comes from server (stored in SQLite) or uploaded ZIP (validated server-side). |
| RPC proxy method injection | Elevation of Privilege | ServiceHost enforces capability check per invoke. Plugin can only call methods on tokens listed in its manifest.serviceTokens and within its capabilitiesProposed scope. |
| Worker resource exhaustion (fork bomb) | Denial of Service | BrowserWorkerManager limits concurrent Workers (mirroring backend's MAX_WORKERS=32 at worker-manager.ts line 58) |

## Sources

### Primary (HIGH confidence)
- `packages/core/plugin-host/index.ts` (read in full) — Backend PluginHost lifecycle reference implementation
- `packages/core/plugin-host/types.ts` (read in full) — PluginState, PluginContext, Disposable type definitions
- `packages/core/plugin-host/context-builder.ts` (read in full) — buildContext pattern for service wrapping
- `packages/core/plugin-host/resource-tracker.ts` (read in full) — Disposable resource lifecycle management
- `packages/core/plugin-host/middleware.ts` (read in full) — Onion-model middleware compose pattern
- `packages/core/di/service-registry.ts` (read in full) — Backend ServiceRegistry reference
- `packages/core/di/interfaces.ts` (read in full) — IService interface definitions and Token naming convention
- `packages/core/di/token.ts` (read in full) — Token class with @scope/domain:Name format
- `packages/core/worker-runtime/types.ts` (read in full) — IWorkerTransport interface and message protocol types
- `packages/core/worker-runtime/service-host.ts` (read in full) — Backend ServiceHost RPC handling reference
- `packages/core/worker-runtime/worker-manager.ts` (read in full) — Backend Worker lifecycle manager (WorkerRegistry, bootstrap code, createWorker)
- `packages/core/worker-runtime/transport.ts` (read in full) — NodeWorkerTransport + BrowserWorkerTransport stub
- `packages/core/esm-loader/browser-loader.ts` (read in full) — BrowserEsmLoader Blob URL + import() pattern
- `packages/core/esm-loader/manifest-schema.ts` (read in full) — Manifest zod schema
- `src/App.tsx` (partial read of key sections: 6295-6757 plugin center, 5440-5499 nav, 3356-3528 Socket.IO, 4172-4251 plugin CRUD, 1703-1733 state declarations) — Integration points
- `src/main.tsx` (read in full) — React entry point
- `src/components/LiveClassroomView.tsx` (partial read: 196-208 classroomTools parsing, 760-794 tool rendering) — Existing classroomTools pattern
- `packages/plugins/rollcall/manifest.json` (read in full) — classroomTools definition in manifest
- `packages/core/db/index.ts` (partial: execution_mode column at line 320) — DB schema state
- `.planning/phases/09-frontend/09-CONTEXT.md` (read in full) — All user decisions and locked requirements

### Secondary (MEDIUM confidence)
- Web Worker API spec (MDN) — Blob URL + import() + postMessage patterns are standard browser APIs
- React.lazy + Suspense documentation — Standard React 19 API, no external validation needed
- Zustand 5 documentation — Already in package.json, standard React state management library

### Tertiary (LOW confidence)
- None — all critical findings verified against actual source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all directly verified from package.json and source code
- Architecture: HIGH — backend reference implementations read in full, frontend integration points verified from App.tsx
- Pitfalls: HIGH — derived from documented issues in backend implementation and browser-specific constraints
- Security: MEDIUM — general browser plugin security patterns, but specific edge-vs-chromium Web Worker behavior differences not tested
- Test strategy: MEDIUM — jsdom limitations with Web Worker and Blob URL import() need investigation

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (frontend libraries stable, browser APIs don't change)
