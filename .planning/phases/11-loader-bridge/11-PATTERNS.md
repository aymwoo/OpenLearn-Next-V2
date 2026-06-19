# Phase 11: Dynamic Loader and Host Bridge (loader-bridge) — Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 19 new/modified files (13 new, 6 modified)
**Analogs found:** 17 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/mfe/types.ts` | type-def | utility | `src/plugin-host/types.ts` | exact |
| `src/mfe/MfeLoader.tsx` | component | request-response | `src/plugin-host/extension-point-renderer.tsx` | exact |
| `src/mfe/MfeLoaderCore.tsx` | component | request-response | `src/plugin-host/extension-point-renderer.tsx` | good |
| `src/mfe/MfeErrorBoundary.tsx` | component | request-response | `src/plugin-host/extension-point-renderer.tsx` (ExtensionErrorBoundary, lines 46-82) | exact |
| `src/mfe/MfeConfigProvider.tsx` | component | request-response | `src/plugin-host/plugin-host-context.tsx` | exact |
| `src/mfe/MfeContextProvider.tsx` | component | request-response | `src/plugin-host/plugin-host-context.tsx` | exact |
| `src/mfe/useMfeContext.ts` | hook | utility | `src/plugin-host/plugin-host-context.tsx` (usePluginHost, lines 41-47) | exact |
| `src/mfe/api.ts` | utility | request-response | `src/plugin-host/plugin-host.ts` (fetch calls) | partial |
| `src/mfe/cache.ts` | utility | utility | No direct analog (Map wrapper) | none |
| `src/mfe/leak-detector.ts` | utility | utility | No direct analog | none |
| `src/mfe/preload.ts` | utility | request-response | No direct analog | none |
| `src/mfe/__tests__/*` | test | various | `src/plugin-host/__tests__/*.test.ts` | exact |
| `packages/core/db/index.ts` | config/db | utility | Same file (existing schema patterns) | exact |
| `server.ts` | controller | request-response | Same file (existing GET route patterns) | exact |
| `src/main.tsx` | config/entry | request-response | Same file (PluginHostProvider pattern) | exact |
| `packages/mfe-whiteboard/src/App.tsx` | component | lifecycle | Same file (current default export) | exact |
| `packages/mfe-courseware/src/App.tsx` | component | lifecycle | Same file (current default export) | exact |
| `src/components/MfeLoadingFallback.tsx` | component | presentation | `src/plugin-host/extension-point-renderer.tsx` (LoadingSkeleton, lines 25-43) | exact |
| `src/components/MfeErrorFallback.tsx` | component | presentation | `src/plugin-host/extension-point-renderer.tsx` (inline error fallback, lines 118-126) | good |

## Pattern Assignments

### `src/mfe/types.ts` (type-def, utility)

**Analog:** `src/plugin-host/types.ts`

**Imports pattern** (lines 1-11):
```typescript
/**
 * Frontend PluginHost type definitions.
 *
 * Mirrors backend PluginHost types (PluginState, Disposable) and adds
 * frontend-specific types (ExtensionSlot, FrontendPluginContext, etc.).
 */
import type React from 'react';

// ── Token name constants (frontend namespace) ────────────────────────────
export const FRONTEND_API_TOKEN = '@openlearn/frontend:IFrontendAPI';
// ── Core types ───────────────────────────────────────────────────────────
export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  // ...
}
```

**Core type definitions pattern** (lines 63-79):
```typescript
export interface Disposable {
  dispose(): void;
}

export interface FrontendPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  // ...
}
```

**Apply to:** Define `MfeContext`, `RemoteConfig`, `MfeAppInstance`, `MfeAppLifecycle` interfaces in `src/mfe/types.ts`. Follow the same pattern of `export interface` shapes with JSDoc comments and grouped section headers.

---

### `src/mfe/MfeLoader.tsx` (component, request-response)

**Analog:** `src/plugin-host/extension-point-renderer.tsx`

**Imports pattern** (lines 18-21):
```typescript
import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { usePluginHost } from './plugin-host-context';
import type { ExtensionSlot } from './types';
```

**Apply to:** MfeLoader should import from React, lucide-react for icons, and local mfe modules.

**Core container pattern** (lines 103-135):
```typescript
export function ExtensionPointRenderer({
  slot,
  fallback,
  lang,
}: ExtensionPointRendererProps) {
  const host = usePluginHost();
  const extensions = host.getExtensions(slot);

  if (extensions.length === 0) return null;

  return (
    <>
      {extensions.map((ext) => (
        <ExtensionErrorBoundary
          key={ext.id}
          fallback={/* ... */}
        >
          <Suspense fallback={fallback ?? <LoadingSkeleton />}>
            {React.createElement(React.lazy(ext.component))}
          </Suspense>
        </ExtensionErrorBoundary>
      ))}
    </>
  );
}
```

**Apply to:** MfeLoader follows this container pattern: wraps content in ErrorBoundary, manages loading state, coordinates fallback UI. Replace Suspense with `createRoot` container rendering pattern (D-04).

---

### `src/mfe/MfeErrorBoundary.tsx` (component, request-response)

**Analog:** `src/plugin-host/extension-point-renderer.tsx` lines 46-82 (ExtensionErrorBoundary)

**Error boundary class-component pattern** (lines 63-82):
```typescript
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ExtensionErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
```

**Apply to:** MfeErrorBoundary follows this identical class-component pattern with `getDerivedStateFromError` and `componentDidCatch`. Add `name` prop for per-instance identification, and `onRetry`/`onDismiss` callbacks per D-16/D-17.

---

### `src/mfe/MfeConfigProvider.tsx` (component, request-response)

**Analog:** `src/plugin-host/plugin-host-context.tsx` (entire file, 47 lines)

**Context Provider + custom hook pattern** (lines 17-47):
```typescript
import React, { createContext, useContext } from 'react';
import { FrontendPluginHost } from './plugin-host';

const PluginHostContext = createContext<FrontendPluginHost | null>(null);

export interface PluginHostProviderProps {
  children: React.ReactNode;
  host: FrontendPluginHost;
}

export function PluginHostProvider({ children, host }: PluginHostProviderProps) {
  return (
    <PluginHostContext.Provider value={host}>
      {children}
    </PluginHostContext.Provider>
  );
}

export function usePluginHost(): FrontendPluginHost {
  const ctx = useContext(PluginHostContext);
  if (!ctx) {
    throw new Error('usePluginHost must be used within PluginHostProvider');
  }
  return ctx;
}
```

**Apply to:** MfeConfigProvider uses the exact same Context + Provider + hook pattern. Replace `FrontendPluginHost` with `MfeConfigContextType` containing `defaultFallback`, `defaultErrorFallback`, `defaultTimeout`, and loading/error component overrides per D-03.

---

### `src/mfe/MfeContextProvider.tsx` (component, request-response)

**Analog:** `src/plugin-host/plugin-host-context.tsx` (same as above, identical pattern)

**Apply to:** MfeContextProvider follows the exact same Context Provider pattern, but provides `MfeContext` infrastructure (eventBus, serviceRegistry, store references per D-02/D-07). Use the same `createContext` + `useContext` + guard throw pattern.

---

### `src/mfe/useMfeContext.ts` (hook, utility)

**Analog:** `src/plugin-host/plugin-host-context.tsx` lines 41-47 (usePluginHost)

**Custom hook pattern** (lines 41-47):
```typescript
export function usePluginHost(): FrontendPluginHost {
  const ctx = useContext(PluginHostContext);
  if (!ctx) {
    throw new Error('usePluginHost must be used within PluginHostProvider');
  }
  return ctx;
}
```

**Apply to:** useMfeContext follows this same pattern — `useContext` + null guard + descriptive error message.

---

### `src/mfe/api.ts` (utility, request-response)

**Analog:** `src/plugin-host/plugin-host.ts` (fetch calls)

**fetch pattern** (from plugin-host.ts, uninstallPlugin):
```typescript
// In plugin-host.ts (around line 297-316):
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
// ...
await host.uninstallPlugin(plugin.manifest.id);
expect(fetch).toHaveBeenCalledWith(
  `/api/plugins/${plugin.manifest.id}`,
  expect.objectContaining({ method: 'DELETE' }),
);
```

**Apply to:** api.ts exports `fetchRemoteEntry(name: string)` using `fetch()` to call `/api/mfe/remotes?name=${name}`. Use async function with try/catch and return `{ success: true, result }` or `{ success: false, error }` matching server.ts response convention.

---

### `src/mfe/cache.ts` (utility, utility)

**No direct analog.** This is a simple in-memory Map wrapper. Pattern to follow:

```typescript
// Simple Map-based cache with expiry
const cache = new Map<string, { data: any; timestamp: number }>();
const TTL = 60_000; // 1 minute

export function getCached(key: string): any | null { ... }
export function setCache(key: string, data: any): void { ... }
export function clearCache(): void { ... }
```

---

### `src/mfe/leak-detector.ts` (utility, utility)

**No direct analog.** This is a new utility for dev-mode leak detection per D-20. Pattern from RESEARCH.md:

```typescript
export function createLeakDetector(container: HTMLElement) {
  if (process.env.NODE_ENV !== 'development') return { check: () => {} };
  // track intervals, listeners, observers
  // check() logs warnings, cleanup() disconnects everything
}
```

---

### `src/mfe/preload.ts` (utility, request-response)

**No direct analog.** This is a new utility for module preloading per D-26. Pattern to follow:

```typescript
import { loadRemote } from '@module-federation/runtime';

export async function preload(name: string): Promise<void> {
  await loadRemote(`${name}/App`);
}
```

---

### `src/mfe/__tests__/*` (test, various)

**Analogs:**
- For Context provider tests: `src/plugin-host/__tests__/plugin-host-context.test.tsx` (lines 1-57)
- For service/unit tests: `src/plugin-host/__tests__/plugin-host.test.ts` (lines 1-330)
- For component rendering tests: `src/plugin-host/__tests__/migration.test.tsx` (lines 1-160)

**Test import pattern** (from plugin-host-context.test.tsx, lines 10-15):
```typescript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PluginHostProvider, usePluginHost } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
```

**Test structure pattern** (from plugin-host-context.test.tsx, lines 16-26):
```typescript
describe('PluginHostProvider', () => {
  it('renders children inside the provider', () => {
    const host = new FrontendPluginHost();
    const html = renderToString(
      <PluginHostProvider host={host}>
        <div data-testid="child">Hello World</div>
      </PluginHostProvider>,
    );
    expect(html).toContain('Hello World');
  });
});
```

**Test mock pattern** (from plugin-host.test.ts, lines 17-42):
```typescript
function createMockServices() {
  return {
    frontendApi: {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
    } as unknown as IFrontendAPI,
    // ...
  };
}
```

**Apply to:** Test files in `src/mfe/__tests__/`:
- `plugin-host-context.test.tsx` pattern for Context provider tests
- `plugin-host.test.ts` pattern for lifecycle/service tests with mocks
- `migration.test.tsx` pattern for component rendering tests

---

### `packages/core/db/index.ts` (config/db, utility) — MODIFIED

**Analog:** Same file (existing patterns)

**CREATE TABLE pattern** (lines 28-316):
```sql
CREATE TABLE IF NOT EXISTS mfe_remotes (
  name TEXT PRIMARY KEY,
  entry TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Apply to:** Add the `mfe_remotes` table schema inside the existing `db.exec()` block alongside all other tables, using the same `CREATE TABLE IF NOT EXISTS` format and column conventions (text primary key, integer timestamps).

---

### `server.ts` (controller, request-response) — MODIFIED

**Analog:** Same file (existing GET route patterns)

**Simple GET route with query param + DB query** (from `/api/events`, lines 2102-2109):
```typescript
app.get('/api/events', (req, res) => {
  try {
    const events = kernelContainer.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 50').all();
    res.json(events);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

**GET route with optional query param** (from `/api/vfs`, lines 2112-2152):
```typescript
app.get('/api/vfs', (req, res) => {
  try {
    const parentId = req.query.parentId === 'null' ? null : (req.query.parentId || null);
    // ... logic ...
    res.json(nodes);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

**GET route with parameter and conditional response** (from `/api/courseware/:id`, lines 2154-2169):
```typescript
app.get('/api/courseware/:id', (req, res) => {
  try {
    const node = kernelContainer.db.prepare('SELECT * FROM vfs_nodes WHERE id = ?').get(req.params.id) as any;
    if (!node) return res.status(404).send('Courseware not found');
    // ... logic ...
    res.send(html);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

**Apply to:** Add `/api/mfe/remotes` GET route following these patterns. Use `req.query.name` for the optional name parameter, `kernelContainer.db.prepare(...)` for SQL queries, in-memory `Map` for caching (D-24). Return `{ success: true, result }` or `{ success: false, error: message }` consistent with other routes.

---

### `src/main.tsx` (config/entry, request-response) — MODIFIED

**Analog:** Same file (existing PluginHostProvider init pattern)

**Entry point init pattern** (current main.tsx, lines 1-16):
```typescript
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import './index.css';

const pluginHost = new FrontendPluginHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PluginHostProvider host={pluginHost}>
      <App />
    </PluginHostProvider>
  </StrictMode>,
);
```

**Apply to:** Add MF runtime `init()` call before rendering (D-25), and wrap `<App />` with `MfeConfigProvider`. Pattern follows existing PluginHostProvider wrapper approach.

---

### `packages/mfe-whiteboard/src/App.tsx` (component, lifecycle) — MODIFIED

**Analog:** Same file (current default export)

**Current pattern** (current App.tsx, lines 1-5):
```typescript
import React from 'react';

export default function App() {
  return <div>Whiteboard MFE</div>;
}
```

**Apply to:** Replace default export with `createMfeApp(ctx)` factory function per D-05/D-06. Keep `export default` for backward compatibility (D-12) but add named `export function createMfeApp(ctx: MfeContext)` that returns `{ mount, unmount, update, styles }`.

---

### `packages/mfe-courseware/src/App.tsx` (component, lifecycle) — MODIFIED

**Analog:** Same as mfe-whiteboard pattern above.

**Apply to:** Same transformation — add `createMfeApp(ctx)` factory function alongside default export.

---

### `src/components/MfeLoadingFallback.tsx` (component, presentation)

**Analog:** `src/plugin-host/extension-point-renderer.tsx` lines 25-43 (LoadingSkeleton)

**Spinner component pattern** (lines 25-43):
```typescript
function LoadingSkeleton() {
  return (
    <div className="w-full h-32 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 size={24} className="text-gray-400 animate-spin" />
        <span className="text-xs text-gray-400">Loading...</span>
      </div>
    </div>
  );
}
```

**Apply to:** MfeLoadingFallback follows this same spinner pattern using `Loader2` from `lucide-react` + `animate-spin` utility. Accept `className` prop for customization.

---

### `src/components/MfeErrorFallback.tsx` (component, presentation)

**Analog:** `src/plugin-host/extension-point-renderer.tsx` lines 118-126 (inline error fallback)

**Error fallback pattern** (lines 118-126):
```typescript
<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
  <p>
    {lang === 'zh'
      ? '扩展组件加载失败'
      : 'Extension failed to load'}
  </p>
</div>
```

**Apply to:** MfeErrorFallback follows this Tailwind error card pattern, extended per D-16: error icon + "reload" button + "dismiss" button. Accept `error`, `name`, `onRetry`, `onDismiss` props.

---

## Shared Patterns

### React Context Provider
**Source:** `src/plugin-host/plugin-host-context.tsx`
**Apply to:** `MfeConfigProvider`, `MfeContextProvider`, `useMfeContext`

Pattern: `createContext` with `null` default + `useContext` hook + null guard with descriptive error message. Export Provider component and consumer hook from the same file.

### Error Boundary (Class Component)
**Source:** `src/plugin-host/extension-point-renderer.tsx` lines 46-82
**Apply to:** `MfeErrorBoundary`

Pattern: Class component with `getDerivedStateFromError` static method (sets hasError) + `componentDidCatch` (console.error for logging). Render props.children when no error, fallback component when error detected.

### Loading/Spinner UI
**Source:** `src/plugin-host/extension-point-renderer.tsx` lines 25-43
**Apply to:** `MfeLoadingFallback`

Pattern: `Loader2` from `lucide-react` with `animate-spin`, centered in a flex container, with appropriate Tailwind spacing/sizing.

### API Route with try/catch + DB access
**Source:** `server.ts` lines 2102-2109, 2363-2369
**Apply to:** New `/api/mfe/remotes` GET route

Pattern: `app.get(PATH, (req, res) => { try { ... res.json(...) } catch (e: any) { res.status(500).json({ error: e.message }) } })`. Use `kernelContainer.db.prepare(SQL).all()` or `.get(param)` for queries.

### DB Table Creation
**Source:** `packages/core/db/index.ts` lines 28-316
**Apply to:** `mfe_remotes` table

Pattern: `CREATE TABLE IF NOT EXISTS` inside the existing `db.exec()` block. Use TEXT PRIMARY KEY, INTEGER timestamps. Follow same naming conventions as existing tables.

### Test Structure
**Source:** `src/plugin-host/__tests__/plugin-host-context.test.tsx`
**Apply to:** All test files in `src/mfe/__tests__/`

Pattern: `import { describe, it, expect } from 'vitest'` + `import React from 'react'` + `import { renderToString } from 'react-dom/server'`. Use `describe('Name') / it('behavior') / expect(...)` blocks. Use `vi.fn()` for mocks.

### Export Pattern for Frontend Files
**Source:** `src/plugin-host/*.ts`, `src/plugin-host/*.tsx`
**Apply to:** All new `src/mfe/*` files

Pattern: Each file exports its primary interface/type and function/component as named exports. Barrel file (`index.ts`) re-exports all public APIs. Follow `export function Name(...)` and `export interface Name` patterns.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/mfe/cache.ts` | utility | utility | Simple Map wrapper with TTL — no existing in-memory cache utility exists in the codebase |
| `src/mfe/leak-detector.ts` | utility | utility | Dev-mode leak detection is a new pattern — no existing analog |
| `src/mfe/preload.ts` | utility | request-response | Module Federation preload API usage is a new pattern — no existing analog |

## Metadata

**Analog search scope:** `src/`, `src/plugin-host/`, `src/plugin-host/__tests__/`, `src/components/`, `packages/core/db/`, `packages/mfe-whiteboard/`, `packages/mfe-courseware/`, `server.ts`, `vite.config.ts`
**Files scanned:** 25+ source files
**Pattern extraction date:** 2026-06-20
