---
phase: 11-loader-bridge
reviewed: 2026-06-20T10:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - packages/core/db/index.ts
  - packages/mfe-courseware/src/App.tsx
  - packages/mfe-whiteboard/src/App.tsx
  - server.ts
  - src/components/MfeErrorFallback.tsx
  - src/components/MfeLoadingFallback.tsx
  - src/main.tsx
  - src/mfe/api.ts
  - src/mfe/cache.ts
  - src/mfe/index.ts
  - src/mfe/leak-detector.ts
  - src/mfe/MfeConfigProvider.tsx
  - src/mfe/MfeContextProvider.tsx
  - src/mfe/MfeErrorBoundary.tsx
  - src/mfe/MfeLoaderCore.tsx
  - src/mfe/MfeLoader.tsx
  - src/mfe/preload.ts
  - src/mfe/__tests__/lifecycle.test.ts
  - src/mfe/__tests__/memory.test.ts
  - src/mfe/__tests__/MfeErrorBoundary.test.tsx
  - src/mfe/__tests__/MfeLoader.test.tsx
  - src/mfe/__tests__/test-utils.tsx
  - src/mfe/types.ts
  - src/mfe/useMfeContext.ts
  - vitest.config.ts
findings:
  critical: 3
  warning: 6
  info: 3
  total: 12
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-20T10:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

This review covers the MFE (Micro Frontend) loader bridge implementation: the MFE module loading pipeline, React error boundaries, cache layer, lifecycle contracts, leak detection, and the backend API for remote entry resolution. The code is structurally well-organized with clear module separation, thorough type contracts with D-number tracing, and test files for key components.

However, three BLOCKER bugs exist in the core MFE loading pipeline that would make it non-functional at runtime:

1. The dynamic entry URL resolution fetches the remote URL but never passes it to `@module-federation/runtime` - `loadRemote` is called against a runtime initialized with `remotes: []`.
2. The `lifecycle.unmount()` method is called directly on lifecycle objects from the MFE remote packages, but those objects do not provide `unmount()` or `update()` at the top level.
3. Async load errors (network failures, timeouts) are silently swallowed - the error state is set via `setState` but the parent `MfeErrorBoundary` only catches render-phase errors via `getDerivedStateFromError`, so the user sees a blank area with no error feedback.

Additionally, the server-side cache has no TTL (permanent cache), the `MfeContext` interface is duplicated with incompatible shapes (`subscribe/publish` vs `on/off/emit`), and `handleRetry`/`handleDismiss` are functionally identical.

---

## Critical Issues

### CR-01: Entry URL fetched but never registered with module federation runtime

**File:** `src/mfe/MfeLoaderCore.tsx:209-220`
**Issue:** The code fetches the remote entry URL on line 212 via `fetchRemoteEntry(name)`, caches it passively on line 214, but then calls `loadRemote('${name}/App')` on line 220 without ever registering the entry URL with the module federation runtime. At startup (`src/main.tsx:17-25`), `init()` is called with `remotes: []` - an empty array. The `@module-federation/runtime` package provides `registerRemotes()` for dynamic registration, but it is never imported or called anywhere in the codebase. Therefore, `loadRemote('mfe_whiteboard/App')` has no way to resolve the remote name to a URL and will fail.

The entire entry resolution pipeline (API fetch on line 212, cache set on line 214) produces data that is never consumed by the actual loading mechanism.

**Fix:** Import and call `registerRemotes` from `@module-federation/runtime` before calling `loadRemote`. The fetched entry URL must be dynamically registered:

```typescript
import { loadRemote, registerRemotes } from '@module-federation/runtime';

// After fetching entry URL, register before loading:
if (!entry) {
  const cached = cacheGet(name);
  if (!cached) {
    const remoteEntry = await fetchRemoteEntry(name);
    cacheSet(name, { entry: remoteEntry.entry, meta: remoteEntry.meta });
    // Register dynamically with the MF runtime
    registerRemotes([{
      name,
      entry: remoteEntry.entry,
    }]);
  } else {
    // Even cached entries must be registered
    registerRemotes([{
      name,
      entry: cached.entry,
    }]);
  }
}
```

### CR-02: lifecycle.unmount() called on objects that do not provide it

**File:** `src/mfe/MfeLoaderCore.tsx:271` (call site), `packages/mfe-courseware/src/App.tsx:13-31` and `packages/mfe-whiteboard/src/App.tsx:13-31` (implementations)
**Issue:** The `MfeLoaderCore` cleanup code at line 271 calls `await lifecycle.unmount()` when a load is cancelled during mount. All three call sites (`mountInstance.unmount()` via `line 146`, `lifecycle.unmount()` via `line 148`, and direct `lifecycle.unmount()` via `line 271`) expect the target object to have an `unmount()` method. However, the lifecycle objects returned by both remote MFEs (`packages/mfe-courseware/src/App.tsx` and `packages/mfe-whiteboard/src/App.tsx`) only return `{ mount, styles }` - they are missing the top-level `unmount()` and `update()` methods required by the `MfeAppLifecycle` interface. The `wrapReactComponent` wrapper (line 69-85) correctly provides all four properties, but the native `createMfeApp` implementations do not.

This will produce a runtime TypeError: `lifecycle.unmount is not a function` when:
- A load is cancelled mid-flight (line 271)
- `mountInstance` is null but `lifecycle` exists during cleanup (line 148)

**Fix:** Add the missing `unmount()` and `update()` methods to both MFE lifecycle objects:

```typescript
// packages/mfe-courseware/src/App.tsx
export function createMfeApp(ctx: MfeContext) {
  console.log('[mfe-courseware] Initialized with context:', ctx);
  return {
    mount: async (container: HTMLElement, props?: Record<string, any>) => {
      const root = createRoot(container);
      root.render(<App {...props} />);
      return {
        unmount: async () => { root.unmount(); },
        update: async (newProps: Record<string, any>) => { root.render(<App {...newProps} />); },
      };
    },
    unmount: async () => {},   // ADD
    update: async () => {},     // ADD
    styles: [] as string[],
  };
}
```

Same change needed in `packages/mfe-whiteboard/src/App.tsx`.

### CR-03: Async load errors never reach the error boundary - user sees blank area

**File:** `src/mfe/MfeLoaderCore.tsx:279-285` (error handling), `src/mfe/MfeErrorBoundary.tsx:49-51` (error detection)
**Issue:** When a remote module fails to load asynchronously (network error, `loadRemote` failure, timeout), the catch block at line 279 calls `setState('error')` and `setError(err)`. On re-render, `MfeLoaderCore` conditionally returns `null` at line 301-302. The parent `MfeErrorBoundary` class component only enters error state via `getDerivedStateFromError`, which is triggered exclusively by **render-phase exceptions** (thrown during React rendering). Because `MfeLoaderCore` returns `null` instead of throwing, `MfeErrorBoundary.hasError` stays `false` and it renders `this.props.children` (which is `null`). The user sees a completely blank area with no error message, retry button, or dismiss option.

The `MfeErrorFallback` component exists and is imported by `MfeErrorBoundary`, but it is never displayed because the error boundary never detects the error.

**Fix:** `MfeLoaderCore` should throw the error on the error-render path to trigger the error boundary, or propagate the error to the boundary through a callback:

Option A (throw on error render):
```typescript
if (state === 'error' && error) {
  throw error; // Triggers parent MfeErrorBoundary.getDerivedStateFromError
}
```

Option B (componentDidCatch-style with callback):
```typescript
// In MfeLoaderCore
useEffect(() => {
  if (state === 'error' && error) {
    onError?.(error);  // But onError is just a callback, not state trigger
  }
}, [state, error]);

// MfeErrorBoundary would also need a way to be notified of async errors
```

Option A is simpler and follows the error boundary pattern correctly.

---

## Warnings

### WR-01: Server-side MFE remote cache has no TTL or invalidation

**File:** `server.ts:52`, `server.ts:2146-2152`
**Issue:** The `MF_REMOTE_CACHE` Map at line 52 is a permanent in-memory cache with no expiry mechanism. Once a remote entry URL is cached (line 2152), it is returned to all subsequent clients until the server process restarts. If a remote's entry URL changes in the `mfe_remotes` database table (e.g., after deployment, port change, or DNS update), the server will serve the stale cached URL indefinitely. The frontend-side cache (`src/mfe/cache.ts`) correctly implements a 60-second TTL, but the backend cache has none, making the frontend TTL irrelevant since the stale data originates at the server.

This is exacerbated by the dual-layer caching: frontend cache TTL=60s, backend cache=forever. Even waiting 60s on the frontend side still retrieves stale data from the server.

**Fix:** Add TTL-based expiration to the server cache, matching or exceeding the frontend TTL, and/or add a cache-busting header:

```typescript
const MF_REMOTE_CACHE_TTL = 60000; // 60 seconds
const MF_REMOTE_CACHE = new Map<string, {
  entry: string;
  meta: Record<string, any>;
  timestamp: number;
}>();

// On retrieval:
const cached = MF_REMOTE_CACHE.get(name);
if (cached && (Date.now() - cached.timestamp < MF_REMOTE_CACHE_TTL)) {
  return res.json({ success: true, result: cached });
}
MF_REMOTE_CACHE.delete(name); // Expired or missing
```

### WR-02: handleRetry and handleDismiss are functionally identical

**File:** `src/mfe/MfeErrorBoundary.tsx:61-67`
**Issue:** Both `handleRetry` and `handleDismiss` execute `setState({ hasError: false, error: null })`. This means clicking "Dismiss" (which the UI labels as "忽略" or "Dismiss") re-renders the children and triggers a full reload attempt, identical to clicking "Retry". Users expecting "Dismiss" to make the error go away (by showing a blank placeholder) will instead see the loading spinner again. The dismiss behavior offers no different outcome than retry, making the button misleading.

**Fix:** Add a third "dismissed" state that renders an empty placeholder container instead of re-triggering the load:

```typescript
interface MfeErrorBoundaryState {
  hasError: boolean;
  dismissed: boolean;
  error: Error | null;
}

handleDismiss = (): void => {
  this.setState({ hasError: true, dismissed: true, error: null });
};

render() {
  if (this.state.dismissed) {
    return <div style={{ display: 'none' }} />; // or placeholder
  }
  // ... existing error/children rendering
}
```

### WR-03: MfeContext interface name collision with incompatible event API shapes

**File:** `src/mfe/types.ts:62-70` vs `src/mfe/MfeContextProvider.tsx:29-46`
**Issue:** Two interfaces named `MfeContext` coexist in the codebase with incompatible event bus APIs:
- `types.ts` (line 62-70): Uses `subscribe(event, handler) => () => void` and `publish(event, payload?) => void` (pub-sub pattern)
- `MfeContextProvider.tsx` (line 29-46): Uses `on(event, handler) => void`, `off(event, handler) => void`, and `emit(event, ...args) => void` (EventEmitter pattern)

The `types.ts` version is the contract consumed by remote MFE `createMfeApp(ctx)` factories (imported by `packages/mfe-courseware/src/App.tsx` and `packages/mfe-whiteboard/src/App.tsx`). The `MfeContextProvider.tsx` version is the host-side React context. When Phase 12 bridges the host infrastructure to remotes, someone must reconcile these incompatible APIs, which will either require an adapter or a breaking change to one of the interfaces.

**Fix:** Align the two interfaces to a single contract. Either:
- Re-export shared types from `types.ts` and use them in `MfeContextProvider.tsx`
- Or rename the provider version to `HostMfeContext` to distinguish from the consumer contract

### WR-04: MfeConfigDefaults.defaultTimeout type inconsistency

**File:** `src/mfe/types.ts:136` vs `src/mfe/MfeConfigProvider.tsx:39`
**Issue:** The `MfeConfigDefaults` interface is defined twice with differing optionality for `defaultTimeout`:
- `types.ts` line 136: `defaultTimeout?: number` (optional)
- `MfeConfigProvider.tsx` line 39: `defaultTimeout: number` (required)

The `MfeConfigProvider` applies `INTERNAL_DEFAULTS` (line 50-52) with `defaultTimeout: 30000`, so after merging it is always set. But the `types.ts` declaration being optional is misleading for consumers who use the type for configuration.

**Fix:** Make `defaultTimeout` required in `types.ts` to match the provider's contract:

```typescript
export interface MfeConfigDefaults {
  defaultLoadingFallback?: React.ComponentType;
  defaultErrorFallback?: React.ComponentType<{...}>;
  defaultTimeout: number;  // Remove '?'
}
```

### WR-05: Effect dependency array includes unstable callback references

**File:** `src/mfe/MfeLoaderCore.tsx:296`
**Issue:** The `useEffect` dependency array includes `onError` and `onLoad` (line 296). If consumers pass inline arrow functions for these callbacks (e.g., `<MfeLoader onError={(e) => ...} />`), the reference changes on every render, causing the effect to tear down and re-initialize the entire remote module on every parent re-render. This includes unmounting and re-mounting the remote, which causes a visible UI flash and repeated network requests.

**Fix:** Use refs to decouple the callbacks from the effect dependency array:

```typescript
const onErrorRef = useRef(onError);
onErrorRef.current = onError;
const onLoadRef = useRef(onLoad);
onLoadRef.current = onLoad;

// Inside effect, call via refs:
onErrorRef.current?.(err);
onLoadRef.current?.();
```

Then remove `onError` and `onLoad` from the dependency array on line 296. Document that stable callback references are recommended for consumers who opt not to use this ref pattern.

### WR-06: process.env.NODE_ENV not idiomatic for Vite environment

**File:** `src/mfe/leak-detector.ts:39`
**Issue:** The leak detector uses `process.env.NODE_ENV !== 'development'` to short-circuit in production. While Vite provides a `process.env.NODE_ENV` polyfill via define replacement, this is not the Vite-idiomatic pattern. The standard approach in Vite projects is `import.meta.env.DEV` / `import.meta.env.PROD`. Using the non-standard `process.env` pattern may fail in environments where Vite's define replacement is not configured for that specific string, causing the leak detector to always be active in production.

**Fix:** Replace with Vite's built-in constants:

```typescript
if (!import.meta.env.DEV) {
  return { /* no-op */ };
}
```

---

## Info

### IN-01: Unused import MfeErrorFallback in MfeLoaderCore

**File:** `src/mfe/MfeLoaderCore.tsx:31`
**Issue:** `MfeErrorFallback` is imported on line 31 but never used in the component. Error display is handled externally by the parent `MfeErrorBoundary`. Only the `MfeErrorFallbackProps` type (line 36) is used for prop typing.

**Fix:** Remove the unused import:
```typescript
// Remove line 31:
// import MfeErrorFallback from '../components/MfeErrorFallback';
```

### IN-02: Dead prop errorFallback in MfeLoaderCore

**File:** `src/mfe/MfeLoaderCore.tsx:52` (prop declaration), `src/mfe/MfeLoader.tsx:92` (prop passing)
**Issue:** The `errorFallback` prop is declared in `MfeLoaderCoreProps` (line 52) and passed from `MfeLoader` (line 92), but it is never rendered or referenced in `MfeLoaderCore`'s implementation. The component always returns `null` on error (line 301-302), delegating error display to the parent `MfeErrorBoundary`. The `errorFallback` prop is dead code.

**Fix:** Remove `errorFallback` from `MfeLoaderCoreProps` and stop passing it from `MfeLoader`:

```typescript
// Remove from MfeLoaderCoreProps:
// errorFallback?: React.ComponentType<MfeErrorFallbackProps>;

// Remove from MfeLoader invocation:
// errorFallback={effectiveErrorFallback}
```

### IN-03: Redundant typeof check on error.message

**File:** `src/components/MfeErrorFallback.tsx:63`
**Issue:** The check `typeof error.message === 'string'` on line 63 is redundant. The `error` prop is typed as `Error` (line 29), and the `Error.message` property is always a string per the ECMAScript specification. A `string` type guard is unnecessary.

**Fix:** Simplify to direct string method call:
```typescript
const isTimeout = error.message.toLowerCase().includes('timeout');
```

---

_Reviewed: 2026-06-20T10:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
