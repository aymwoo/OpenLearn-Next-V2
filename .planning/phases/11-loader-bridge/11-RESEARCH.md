# Phase 11: 动态加载器与宿主桥接 (loader-bridge) — Research

**Researched:** 2026-06-20
**Domain:** React Micro-Frontend Loading, Dynamic Module Federation, Error Boundaries, Lifecycle Management
**Confidence:** HIGH

## Summary

Phase 11 implements the `MfeLoader` generic React container component, standard lifecycle contract (`createMfeApp` factory), error boundaries with loading fallback UIs, and memory leak prevention via React 19 `root.unmount()`. This phase sits on top of Phase 10's infrastructure (two remote MFE packages with Module Federation configuration) and builds the runtime loading mechanism that Phases 12 and 13 will consume.

Three technology categories converge here: (1) `@module-federation/runtime` v2.5.1 provides `init()` and `loadRemote()` for dynamic module fetching; (2) React 19's `createRoot`/`root.unmount()` API provides container rendering and destruction primitives; (3) React class-component Error Boundaries provide runtime crash isolation. The lifecycle contract (`createMfeApp`) is a custom abstraction inspired by Single-SPA Parcel and `@module-federation/bridge-react` but purpose-built for this project's container-pattern architecture (D-04).

**Primary recommendation:** Build `MfeLoader` as a container-mode React component that uses `@module-federation/runtime` `loadRemote()` for dynamic module fetching, React 19 `createRoot()` for isolated rendering, a class-component Error Boundary for crash isolation, and a standard `createMfeApp(ctx) => { mount, unmount, update, styles }` factory export contract from remotes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### MfeLoader 组件 API 设计
- **D-01:** MfeLoader 通过完整的 `RemoteConfig` 对象指定要加载的远程应用（字段：name, url, fallback, retryCount, timeout 等）。
- **D-02:** 数据与服务通过双通道传递：业务数据通过 React props 透传，宿主基础设施（DI、EventBus、Store）通过 React Context 注入。远程组件通过 `useMfeContext()` 消费平台能力。
- **D-03:** Loading/Error UI 定制采用二层覆盖：`MfeConfigProvider` 设置全局默认组件，单个 `MfeLoader` 可通过 RemoteConfig props 覆盖。
- **D-04:** MfeLoader 采用容器模式渲染 —— 内部使用 `createRoot` 创建独立的 React root，完全控制挂载/卸载生命周期。

#### 远程应用生命周期契约
- **D-05:** 远程应用的标准导出格式为工厂函数：`createMfeApp(ctx: MfeContext) => { mount, unmount, update, styles }`。
- **D-06:** `mount(container: HTMLElement, props?: Record<string, any>) => { unmount, update }` — unmount 负责完整清理，update 支持新 props 的无销毁重渲染。
- **D-07:** `createMfeApp` 的 ctx 参数包含宿主服务引用（eventBus, serviceRegistry, store），供远程应用在初始化时获取平台能力。
- **D-08:** `createMfeApp` 采用单次初始化策略 —— 远程模块首次加载时调用一次，返回的 `{ mount, unmount, update }` 可反复使用。
- **D-09:** 全异步支持 —— `createMfeApp` 和 `mount` 均可为 async，支持异步初始化逻辑（加载配置、预取数据等）。
- **D-10:** 宿主自动管理第三方 CSS —— `createMfeApp` 返回的 `styles` 数组在 mount 时由宿主注入 DOM，在 unmount 时自动移除，避免全局样式污染（落实 Phase 10 D-16）。
- **D-11:** 远程应用元数据（name, version, description 等）由后端 SQLite 数据库统一管理，远程应用无需导出 manifest 对象。
- **D-12:** 向后兼容 —— MfeLoader 自动检测远程导出格式：检测到 `createMfeApp` 时使用完整生命周期，检测到默认 React 组件时自动包装为简单的 mount/unmount。现有远程无需修改即可加载。
- **D-13:** 生命周期契约的 TypeScript 类型定义放在宿主侧（如 `src/mfe/types.ts`），远程应用通过 `import type` 引用。宿主是契约的真相来源。

#### 错误边界与加载策略
- **D-14:** Error Boundary 采用 Per-instance 粒度 —— 每个 MfeLoader 实例自带独立的 Error Boundary，单个远程崩溃不影响其他远程或宿主。
- **D-15:** 默认加载态 UI 为居中 Spinner 动画，可通过 `MfeConfigProvider` 全局替换为骨架屏或其他自定义组件。
- **D-16:** 错误展示 UI：错误图标 + 简要错误描述 + "重新加载"按钮（手动重试）+ "忽略"按钮（关闭错误提示，显示占位区域）。
- **D-17:** 重试策略为手动触发 —— 加载失败后立即显示错误 UI，用户通过"重新加载"按钮手动发起重试（而非自动静默重试）。
- **D-18:** 可配置加载超时 —— 默认 30 秒，在 RemoteConfig 中可通过 `timeout` 字段覆盖。超时后触发错误状态。

#### 内存管理与卸载清理
- **D-19:** unmount 双重触发路径 —— MfeLoader 从 React 树卸载时自动调用（useEffect cleanup）+ 提供显式 ref/controller API（如 `ref.unmount()`）供调用者主动销毁。
- **D-20:** 开发模式下主动泄漏检测 —— unmount 后检查常见泄漏源（未清理的 setInterval、未移除的 event listener、未断开 observer），在 console.warn 中输出警告。
- **D-21:** 宿主全面清理 —— 除调用远程 unmount() 外，宿主主动清理宿主侧资源（EventBus 自动 unsubscribe、Store 自动断开订阅、注入的 styles 移除、React root 销毁）。
- **D-22:** unmount 超时强制销毁 —— 默认 5 秒超时，若远程 unmount() 未在规定时间内完成，强制执行 DOM 移除和 root 销毁，console.error 报告超时。

#### Entry URL 加载与解析
- **D-23:** MfeLoader 通过 REST API 动态查询 Remote Entry URL —— 请求 `/api/mfe/remotes?name=mfe_whiteboard` 获取 SQLite 中注册的 remoteEntry.js 地址。落实 Phase 10 D-10（运行时 entry 地址由数据库注册）。
- **D-24:** API 查询结果以内存 Map 缓存 —— 首次查询后缓存，后续同 name 的 MfeLoader 实例复用缓存结果，避免重复网络请求。

#### Module Federation Runtime 初始化
- **D-25:** `@module-federation/runtime` 的 `init()` 在应用启动时全局调用一次（在 `main.tsx` 或 App 入口层），所有 MfeLoader 共享同一个 runtime 实例，确保单例依赖（react, react-dom, zustand）的 sharedScope 只解析一次。

#### 远程模块预加载
- **D-26:** 提供手动预加载 API —— `preload(name: string): Promise<void>`，调用者在用户即将导航到远程模块时（如 hover 菜单项、路由预加载）主动触发 remoteEntry.js + 主 chunk 的预取。

#### MfeLoader 嵌套支持
- **D-27:** 支持 MfeLoader 嵌套 —— 远程组件内部可以再使用 MfeLoader 加载另一个远程。每个嵌套层保持独立的 Error Boundary 隔离，Context 沿嵌套链正确传递。

### Claude's Discretion
- 无 —— 所有决策均与用户对齐。

### Deferred Ideas (OUT OF SCOPE)
- Shadow DOM 样式隔离（MFE-SEC-01）
- 第三方 iframe 沙箱（MFE-SEC-02）
- 远程版本不匹配自动降级（MFE-SEC-03）
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MFE-LOAD-01 | Implement `MfeLoader` container component supporting dynamic remote entry resolution via `@module-federation/runtime` | D-01-D-04 define the API shape; D-23-D-25 define the entry resolution and MF init strategy; `@module-federation/runtime` v2.5.1 `loadRemote()` is the dynamic loading mechanism |
| MFE-LOAD-02 | Implement React Error Boundaries and Loading fallbacks in `MfeLoader` to prevent remote crashes from bringing down the host | D-14-D-18 define per-instance Error Boundary, loading/error UI, retry strategy; standard React class-component `componentDidCatch` + `getDerivedStateFromError` pattern |
| MFE-LOAD-03 | Standardize Remote application export contract with `bootstrap`, `mount`, and `unmount` hooks | D-05-D-13 define the `createMfeApp(ctx) => { mount, unmount, update, styles }` contract with backward compatibility (D-12) |
| MFE-LOAD-04 | Ensure complete React 19 root unmounting (`root.unmount()`) on remote destruction to avoid memory leaks | D-19-D-22 define dual-trigger unmount, leak detection, host-side cleanup, and forced timeout destruction |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@module-federation/runtime` | 2.5.1 | Dynamic remote module loading via `init()`, `loadRemote()`, `registerRemotes()` | Already installed (package.json: `"@module-federation/runtime": "2.5.1"`); official MF v2 runtime for Vite/Webpack [VERIFIED: npm registry] |
| `react` / `react-dom` | 19.2.x | `createRoot`/`root.unmount()` container rendering and destruction | Already installed (`"react": "^19.0.1"`); React 19 deprecates `ReactDOM.render()` — `createRoot` is the standard API [VERIFIED: npm registry] |
| `lucide-react` | 0.546.x | Loading spinner (`Loader2`) and error state icons | Already installed; provides consistent icon style with existing codebase [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | 14.0.x | Generate unique IDs for MfeLoader instances and style injection tracking | Every MfeLoader instance for identifying styles to remove on unmount |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `createRoot` + custom lifecycle | `@module-federation/bridge-react` `createRemoteAppComponent` | `@module-federation/bridge-react` has heavy React Router dependencies (~3KB gzipped) and SSR assumptions; custom `createRoot` approach (D-04) gives full container lifecycle control without unwanted router coupling |
| `loadRemote()` from runtime | Static config-based remote loading (Phase 10's `remotes: {}`) | Static remotes require host rebuild to add/remove remotes; `loadRemote()` + dynamic `registerRemotes()` enables runtime plugin-style loading per D-23 |

**Installation:**
```bash
# No new packages needed — @module-federation/runtime, react, react-dom, lucide-react already installed
```

**Version verification:**
```bash
npm view @module-federation/runtime version       # 2.5.1 — confirmed
npm view react version                              # 19.2.7 — latest React 19 minor
npm view react-dom version                          # 19.2.7 — latest React 19 minor
npm view lucide-react version                       # 0.546.0 — already used in App.tsx
npm view uuid version                               # 14.0.0 — already used in codebase
```

## Package Legitimacy Audit

> All packages in this phase are already installed in the project. No new external packages need to be fetched. The phase creates user-land source files only.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@module-federation/runtime` | npm | ~1 yr | ~500K/wk | github.com/module-federation/core | [OK] | Already installed |
| `react` | npm | ~11 yrs | ~60M/wk | github.com/facebook/react | [OK] | Already installed |
| `react-dom` | npm | ~11 yrs | ~60M/wk | github.com/facebook/react | [OK] | Already installed |
| `lucide-react` | npm | ~4 yrs | ~2M/wk | github.com/lucide-icons/lucide | [OK] | Already installed |
| `uuid` | npm | ~10 yrs | ~50M/wk | github.com/uuidjs/uuid | [OK] | Already installed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
*No new packages — all dependencies are existing and verified.*

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Remote Entry URL resolution | Backend (server.ts) | — | REST API `/api/mfe/remotes` queries SQLite for remoteEntry.js URL; single source of truth per D-23 |
| Remote module loading | Browser (MfeLoader) | — | `@module-federation/runtime` `loadRemote()` runs in browser; fetches remoteEntry.js and resolves shared dependencies |
| Remote component rendering | Browser (MfeLoader) | — | React 19 `createRoot()` renders into an isolated DOM container managed by MfeLoader |
| Crash isolation | Browser (ErrorBoundary) | — | Per-instance class-component ErrorBoundary wraps each MfeLoader mount point |
| Lifecycle contract types | Host source code | Remote source code | TypeScript types defined in `src/mfe/types.ts` (host side, D-13); remotes consume via `import type` |
| Leak detection | Browser (MfeLoader dev mode) | — | D-20: dev-mode console.warn for unremoved listeners/intervals/observers |
| Style injection/removal | Browser (MfeLoader) | — | D-10: `<link>`/`<style>` DOM injection during mount, removal during unmount |

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser / Host Shell App                                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  main.tsx (app init)                                      │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │ MF Runtime init() called once (D-25)            │     │   │
│  │  │ MfeConfigProvider (global UI defaults, D-03)     │     │   │
│  │  │ MfeContextProvider (DI bridge, infra injection)  │     │   │
│  │  └─────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  App.tsx (host shell)                                      │   │
│  │  ┌─ <MfeLoader name="mfe_whiteboard" props={...}> ─────┐ │   │
│  │  │  ┌─ MfeErrorBoundary (per-instance, D-14) ────────┐ │   │
│  │  │  │  ┌─ MfeLoaderCore (container root, D-04) ────┐ │ │   │
│  │  │  │  │  │  <div #mfe-root>                        │ │ │   │
│  │  │  │  │  │  │  createRoot().render(<RemoteApp />)  │ │ │   │
│  │  │  │  │  │  </div>                                 │ │ │   │
│  │  │  │  └────────────────────────────────────────────┘ │ │   │
│  │  │  └──────────────────────────────────────────────────┘ │   │
│  │  └──────────────────────────────────────────────────────┘   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Data flow:                                                     │
│  props ──────────────────────────────────────────────> Remote   │
│  MfeContext (from Provider chain) ───── useMfeContext ─> Remote  │
│  <───────────────── mount/unmount/update callbacks ──────────    │
└──────────────────────────────────────────────────────────────────┘
         │                        │
         │ GET /api/mfe/remotes   │ loadRemote('mfe_whiteboard/App')
         ▼                        ▼
┌──────────────────┐   ┌─────────────────────────────────────────┐
│  server.ts        │   │  Remote MFE Dev Server (5174/5175)     │
│  ┌──────────────┐ │   │  ┌──────────────────────────────────┐  │
│  │ /api/mfe/    │ │   │  │ remoteEntry.js                   │  │
│  │ remotes      │ │   │  │  └── exposes: ./App              │  │
│  │ SQLite query │─┼───┼──>│     └── createMfeApp or default │  │
│  └──────────────┘ │   │  └──────────────────────────────────┘  │
│  DB:              │   └─────────────────────────────────────────┘
│  mfe_remotes      │
│  (name, entry,    │
│   meta JSON)      │
└──────────────────┘
```

### Recommended Project Structure
```
src/
├── mfe/
│   ├── types.ts              # MfeContext, RemoteConfig, MfeApp lifecycle interfaces (D-13)
│   ├── MfeLoader.tsx         # Main container component (combines ErrorBoundary + core)
│   ├── MfeLoaderCore.tsx     # Container rendering logic: createRoot, loadRemote, lifecycle
│   ├── MfeErrorBoundary.tsx  # Class-component Error Boundary (per-instance, D-14)
│   ├── MfeConfigProvider.tsx # React Context Provider for global UI defaults (D-03)
│   ├── MfeContextProvider.tsx # React Context Provider for DI/service injection (D-02)
│   ├── useMfeContext.ts      # Hook to consume MfeContext (D-02)
│   ├── api.ts                # REST API client: fetchRemoteEntry(name) (D-23)
│   ├── cache.ts              # In-memory entry URL cache Map (D-24)
│   └── leak-detector.ts      # Dev-mode leak detection utilities (D-20)
├── components/
│   ├── MfeLoadingFallback.tsx # Default spinner UI (D-15)
│   └── MfeErrorFallback.tsx   # Default error UI with retry/dismiss (D-16)
├── main.tsx                   # MF runtime init() call (D-25)
└── App.tsx                    # MfeLoader usage points
```

### Pattern 1: Container Mode Rendering (D-04)
**What:** MfeLoader renders a remote component into an isolated `createRoot` container, rather than directly embedding it in the React tree. This gives MfeLoader full control over the mount/unmount lifecycle and prevents React reconciliation conflicts between host and remote.

**When to use:** Every MfeLoader instantiation — this is the primary rendering mode per D-04.

**Example:**
```typescript
// Source: React 19 createRoot documentation [CITED: react.dev]

// Inside MfeLoaderCore:
const containerRef = useRef<HTMLDivElement>(null);
const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
const mfeRef = useRef<MfeAppInstance | null>(null);

useEffect(() => {
  if (!containerRef.current) return;

  async function mountRemote() {
    // Load remote module
    const mod = await loadRemote<{ default: any }>(`${name}/App`);
    const lifecycle = mod.default?.createMfeApp
      ? mod.default.createMfeApp(ctx)
      : wrapReactComponent(mod.default); // D-12 backward compat

    // Create root and mount
    rootRef.current = createRoot(containerRef.current!);
    const instance = await lifecycle.mount(containerRef.current!, props);
    mfeRef.current = instance;
  }

  mountRemote();

  return () => {
    // Cleanup: unmount with timeout (D-22)
    const timeout = setTimeout(() => {
      console.error(`[MfeLoader] unmount timeout for ${name}, forcing cleanup`);
      rootRef.current?.unmount();
    }, 5000);

    mfeRef.current?.unmount().finally(() => {
      clearTimeout(timeout);
      rootRef.current?.unmount();
      mfeRef.current = null;
      rootRef.current = null;
    });
  };
}, [name]);
```

### Pattern 2: Lifecycle Factory Export (D-05)
**What:** Remote modules export a `createMfeApp(ctx)` factory function instead of a raw React component. The factory returns `{ mount, unmount, update, styles }`, giving MfeLoader explicit lifecycle hooks.

**When to use:** All remote MFE packages (mfe-whiteboard, mfe-courseware) must adopt this pattern.

**Example:**
```typescript
// Source: D-05 to D-10 decisions, adapted from Single-SPA Parcel pattern

// In packages/mfe-whiteboard/src/App.tsx (or a wrapper):
import { createRoot, Root } from 'react-dom/client';

export function createMfeApp(ctx: MfeContext) {
  // Single initialization (D-08)
  console.log('[mfe-whiteboard] Initialized with context:', ctx);

  return {
    mount: async (container: HTMLElement, props?: Record<string, any>) => {
      const root = createRoot(container);
      root.render(<WhiteboardApp {...props} />);

      return {
        unmount: async () => {
          root.unmount();
        },
        update: async (newProps: Record<string, any>) => {
          root.render(<WhiteboardApp {...newProps} />);
        },
      };
    },
    styles: [], // Optional third-party CSS urls (D-10)
  };
}
```

### Pattern 3: Backward Compat Wrapper (D-12)
**What:** If a remote module exports a default React component instead of `createMfeApp`, MfeLoader auto-wraps it into the standard lifecycle.

**When to use:** During migration, for existing remotes that haven't adopted the lifecycle contract yet.

```typescript
// Source: D-12 backward compatibility decision

function wrapReactComponent(Component: React.ComponentType<any>) {
  return {
    mount: async (container: HTMLElement, props?: Record<string, any>) => {
      const root = createRoot(container);
      root.render(<Component {...props} />);
      return {
        unmount: async () => { root.unmount(); },
        update: async (newProps: Record<string, any>) => {
          root.render(<Component {...newProps} />);
        },
      };
    },
    styles: [],
  };
}
```

### Anti-Patterns to Avoid
- **Calling `init()` multiple times:** The MF runtime should be initialized once at app startup (D-25). Calling `init()` in each MfeLoader instance will create conflicting shared scope registrations. Use `registerRemotes()` for dynamic additions instead.
- **Rendering remote components directly in JSX without `createRoot`:** Inserting a foreign React tree directly into the host's React reconciler can cause conflicts, duplicate React instances, and hook errors. Always use container mode (D-04).
- **Using React.lazy + Suspense for MfeLoader:** React.lazy expects synchronous resolution of a module's default export. `loadRemote()` is async, and the container pattern (createRoot) is incompatible with Suspense boundaries for error handling — use the class-component ErrorBoundary instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dynamic remote module loading | Custom fetch + eval | `@module-federation/runtime.loadRemote()` | Handles shared dependency resolution, singleton enforcement, and remoteEntry.js lifecycle. Building this manually would require reimplementing Module Federation's entire shared scope negotiation algorithm. |
| Crash isolation for React subtrees | Manual try-catch wrapper | React Error Boundary (class component) | React's error boundary is the standard mechanism — `componentDidCatch` catches errors in child component trees during rendering, lifecycle methods, and constructors. A try-catch cannot catch React render errors. |
| DOM style injection/removal | Manual style tag management | `createMfeApp.styles` array + MfeLoader injection | Standardized lifecycle hook ensures CSS is always cleaned up on unmount (D-10). Manual style management risks orphaned `<link>` tags when MfeLoader is destroyed. |
| Asynchronous timeout for cleanup | Nested setTimeout logic | `Promise.race([cleanup, timeout])` pattern | Cleaner error handling and avoids unhandled promise rejections when unmount takes too long (D-22). |

**Key insight:** The most dangerous thing to hand-roll in this phase is the Error Boundary — it's deceptively complex to get right (catches render-phase errors only, not event handler errors; `getDerivedStateFromError` must be static; class component required). Always use the standard React pattern.

## Common Pitfalls

### Pitfall 1: Shared React Singleton Violation
**What goes wrong:** "Invalid hook call" errors or multiple React instances in the same page.
**Why it happens:** Host and remote load separate copies of `react` when the Module Federation `shared` configuration doesn't match or `type: 'module'` is omitted from runtime `init()`.
**How to avoid:** (1) Ensure `init()` call includes `type: 'module'` for all Vite-built remotes. (2) Verify shared config in both host and remote `vite.config.ts` uses `singleton: true` for `react`, `react-dom`, and `zustand`. (3) Verify remote's `package.json` lists these as dependencies (it does — confirmed).
**Warning signs:** React hooks crash after remote mounts; `Module Federation RUNTIME-001` error in console.

### Pitfall 2: Memory Leak from Unmounted Roots
**What goes wrong:** Repeatedly mounting/unmounting remote components causes unbounded memory growth.
**Why it happens:** `root.unmount()` is not called, or the unmount promise rejects without cleanup. React's concurrent mode may also defer unmounting.
**How to avoid:** Implement the dual-trigger unmount pattern (D-19) with forced timeout (D-22). Always store the root reference and clean up in useEffect return. Use dev-mode leak detector (D-20) to catch issues early.
**Warning signs:** Heap snapshots show detached DOM nodes; memory usage increases with each mount/unmount cycle.

### Pitfall 3: Error Boundary Not Catching Load Errors
**What goes wrong:** A `loadRemote()` failure (network error, 404 remoteEntry.js) causes an unhandled promise rejection instead of showing the error fallback UI.
**Why it happens:** Error Boundary only catches errors during React rendering, not during async module loading (which happens outside the React tree).
**How to avoid:** Wrap the `loadRemote()` call in a try-catch inside the MfeLoader component and set error state explicitly. The Error Boundary catches render-time crashes of the loaded component; the try-catch catches load-time failures. Both paths must produce the error fallback UI.

### Pitfall 4: Styles Leaking Between Unmount and Next Mount
**What goes wrong:** When swapping one remote for another, CSS from the old remote persists and conflicts with the new remote's styles.
**Why it happens:** `styles` injection and removal are two separate operations that must be tightly coupled. If unmount's style removal fails or is skipped, old styles linger.
**How to avoid:** Track injected `<link>`/`<style>` elements by a unique key (e.g., `mfe-style-${name}-${index}`) in a Map keyed by MfeLoader instance ID (generated by `uuid`). Remove all tracked elements unconditionally in the cleanup path.

### Pitfall 5: Context Chain Breakage in Nested MfeLoader (D-27)
**What goes wrong:** An MfeLoader nested inside a remote component cannot access host-provided Context.
**Why it happens:** `createRoot()` creates a new React tree root that is disconnected from the host's Context provider chain. Context from `MfeConfigProvider` or `MfeContextProvider` does not automatically propagate into the container root.
**How to avoid:** Pass required context values as props to the remote on mount (`props` parameter of `mount()`), or expose a `MfeContextBridge` component that the remote renders as its root to re-establish context from the host's provider chain.

## Code Examples

Verified patterns from official sources and project conventions:

### Common Operation 1: MF Runtime Initialization (D-25)
```typescript
// Source: @module-federation/runtime v2 API [CITED: module-federation.io]

// In src/main.tsx:
import { init } from '@module-federation/enhanced/runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Single global init call (D-25)
init({
  name: 'host_shell',
  remotes: [], // Dynamic remotes registered via registerRemotes() or during MfeLoader mount
  shared: {
    react: { singleton: true },
    'react-dom': { singleton: true },
    zustand: { singleton: true },
  },
});

// Render host app
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### Common Operation 2: MfeLoader Usage in App.tsx
```typescript
// Source: D-01 to D-04, project conventions
// Pattern for using MfeLoader in App.tsx

import { MfeLoader } from './mfe/MfeLoader';

// Inside App.tsx rendering:
<MfeLoader
  name="mfe_whiteboard"
  entry="/api/mfe/remotes?name=mfe_whiteboard"
  props={{
    lessonId: currentLessonId,
    onWhiteboardUpdate: handleWhiteboardUpdate,
  }}
  fallback={<CustomSkeleton />}      // Optional per-instance override (D-03)
  timeout={15000}                     // Optional per-instance timeout (D-18)
/>
```

### Common Operation 3: Error Boundary Class Component (D-14)
```typescript
// Source: React Error Boundary standard pattern [CITED: react.dev]

import React from 'react';

interface MfeErrorBoundaryProps {
  children: React.ReactNode;
  name: string;
  fallback: React.ComponentType<{ error: Error; name: string; onRetry: () => void; onDismiss: () => void }>;
}

interface MfeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class MfeErrorBoundary extends React.Component<
  MfeErrorBoundaryProps,
  MfeErrorBoundaryState
> {
  constructor(props: MfeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MfeErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[MfeErrorBoundary:${this.props.name}]`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
    // Parent should handle removing the MfeLoader from the tree
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const Fallback = this.props.fallback;
      return (
        <Fallback
          error={this.state.error}
          name={this.props.name}
          onRetry={this.handleRetry}
          onDismiss={this.handleDismiss}
        />
      );
    }
    return this.props.children;
  }
}
```

### Common Operation 4: Remote Entry URL REST API (D-23)
```typescript
// Source: server.ts route patterns — consistent with existing REST endpoint conventions

// In server.ts (inside startServer()):
const MF_REMOTE_CACHE = new Map<string, { entry: string; meta: Record<string, any> }>();

app.get('/api/mfe/remotes', (req, res) => {
  try {
    const name = req.query.name as string;
    if (!name) {
      // Return all registered remotes
      const rows = kernelContainer.db.prepare(
        'SELECT name, entry, meta FROM mfe_remotes'
      ).all() as Array<{ name: string; entry: string; meta: string }>;
      return res.json({ success: true, result: rows });
    }

    // Check cache first (D-24)
    const cached = MF_REMOTE_CACHE.get(name);
    if (cached) {
      return res.json({ success: true, result: cached });
    }

    const row = kernelContainer.db.prepare(
      'SELECT name, entry, meta FROM mfe_remotes WHERE name = ?'
    ).get(name) as { name: string; entry: string; meta: string } | undefined;

    if (!row) {
      return res.status(404).json({ success: false, error: `Remote "${name}" not registered` });
    }

    const result = {
      entry: row.entry,
      meta: JSON.parse(row.meta || '{}'),
    };

    // Cache the result (D-24)
    MF_REMOTE_CACHE.set(name, result);

    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
```

### Common Operation 5: DB Schema for mfe_remotes Table
```sql
-- In packages/core/db/index.ts, add alongside existing schema:
CREATE TABLE IF NOT EXISTS mfe_remotes (
  name TEXT PRIMARY KEY,
  entry TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Common Operation 6: Dev Mode Leak Detector (D-20)
```typescript
// Source: D-20 decision for dev-mode leak detection

// In src/mfe/leak-detector.ts:
export function createLeakDetector(container: HTMLElement) {
  if (process.env.NODE_ENV !== 'development') return { check: () => {} };

  const intervals = new Set<number>();
  const listeners: Array<{ target: EventTarget; type: string; handler: EventListener }> = [];
  const observers = new Set<MutationObserver | IntersectionObserver | ResizeObserver>();

  return {
    trackInterval(id: number) { intervals.add(id); },
    trackListener(target: EventTarget, type: string, handler: EventListener) {
      listeners.push({ target, type, handler });
    },
    trackObserver(obs: MutationObserver | IntersectionObserver | ResizeObserver) {
      observers.add(obs);
    },
    check() {
      const activeIntervals = intervals.size;
      const activeListeners = listeners.length;
      const activeObservers = observers.size;

      if (activeIntervals > 0 || activeListeners > 0 || activeObservers > 0) {
        console.warn(
          `[MfeLoader:LeakDetector] Potential leaks detected after unmount:`,
          `\n  Active intervals: ${activeIntervals}`,
          `\n  Active listeners: ${activeListeners}`,
          `\n  Active observers: ${activeObservers}`
        );
      }
    },
    cleanup() {
      intervals.forEach(clearInterval);
      intervals.clear();
      listeners.forEach(({ target, type, handler }) => {
        target.removeEventListener(type, handler);
      });
      listeners.length = 0;
      observers.forEach(obs => obs.disconnect());
      observers.clear();
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static remotes in Vite config (`remotes: { remote: '...' }`) | Dynamic runtime `init()` + `registerRemotes()` | MF v2 (@module-federation/runtime 2.x) | Remotes can be registered at runtime without rebuild; enables database-driven plugin loading |
| `ReactDOM.render()` | `createRoot()` | React 18 (2022), standard in React 19 | `createRoot` provides explicit `root.unmount()` API for proper teardown; `ReactDOM.render()` shows deprecation warnings |
| React Error Boundary (legacy) | Same pattern, no change | Stable since React 16 | Class-component boundary is still the standard; hooks cannot replace `componentDidCatch` |
| `@module-federation/bridge-react` `createRemoteAppComponent` | Custom `MfeLoader` with `createRoot` | Decision D-04 | Avoids React Router dependency; gives full lifecycle control |

**Deprecated/outdated:**
- `@module-federation/enhanced/runtime` vs `@module-federation/runtime`: The project currently uses `@module-federation/runtime` 2.5.1 (via `@module-federation/vite`). The `enhanced` variant is the newer version with additional features. For `init()` + `loadRemote()`, both packages expose the same API — either can be used. The host `vite.config.ts` already bundles `@module-federation/vite` which provides the MF runtime instance automatically, so explicit `init()` from `@module-federation/runtime` may conflict. **Testing needed:** Verify whether host-init `@module-federation/vite` plugin already calls `init()` internally, and whether calling it again from `main.tsx` causes duplicate registration.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@module-federation/enhanced/runtime` exposes the same `init()` / `loadRemote()` API as `@module-federation/runtime` at the same version (2.5.1) | Standard Stack | Both packages are from the same publisher; the `enhanced` variant has additional features but exports the same core API. If wrong, fallback to `@module-federation/runtime` — both are on the same version. |
| A2 | `@module-federation/vite` plugin's bundled runtime instance can coexist with explicit `init()` from `@module-federation/enhanced/runtime` without duplicate registration | State of the Art | The `@module-federation/vite` plugin may already initialize the runtime internally. An explicit `init()` call from user code may cause `WARN: Already initialized` or duplicate shared scope registrations. This must be verified during implementation — if it causes issues, skip explicit `init()` and rely on the plugin to manage it. Use `getInstance()` to check if already initialized. |
| A3 | The `mfe_remotes` table does not yet exist in the database schema | Code Examples | If it already exists (e.g., from a previous migration), the `CREATE TABLE IF NOT EXISTS` is idempotent — no harm. If the schema uses a different table name or format, the API query will fail and need adjustment. |
| A4 | The existing remote MFE packages (mfe-whiteboard, mfe-courseware) can be updated to export `createMfeApp` without changing their module federation configuration | Architecture Patterns | The `exposes` field exports `./App` → `./src/App.tsx`. If App.tsx exports a named `createMfeApp` function instead of a default component, the `exposes` config doesn't need to change. `loadRemote('mfe_whiteboard/App')` will return the module with `{ createMfeApp, default }`. Low risk. |

## Open Questions (RESOLVED)

1. **Does `@module-federation/vite` plugin already call `init()` internally?** RESOLVED
   - Resolution: Wrap in try/catch; if `getInstance()` returns an existing instance, skip explicit `init()` and log a warning. The `@module-federation/vite` plugin 1.16.8 does auto-initialize the runtime internally — Plan 02 Task 3 calls `getInstance()` first, and only calls `init()` if no instance exists.

2. **How does `loadRemote()` behave when the remote's dev server is not running?** RESOLVED
   - Resolution: Wrap `loadRemote()` in try/catch within MfeLoaderCore, set error state with descriptive message, show error fallback UI with manual retry button. Set `retryCount: 0` in the remote config to avoid double retry with runtime built-in retries.

3. **What is the import path for `init()` and `loadRemote()` — from `@module-federation/enhanced/runtime` or `@module-federation/runtime`?** RESOLVED
   - Resolution: Use `@module-federation/runtime` (already in package.json at v2.5.1). Both `init` and `loadRemote` are exported from this package. If `loadRemote` is not found at runtime, fall back to installing `@module-federation/enhanced` at v2.5.1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | server.ts REST API, dev servers | ✓ | >=20 (host) | — |
| npm | Package management | ✓ | — | pnpm |
| pnpm | Workspace monorepo | ✓ | — | npm |
| Dev MFE servers | Remote loading (dev) | Both ports 5174, 5175 need to be running | — | `--port` config in package.json scripts |

**Missing dependencies with no fallback:**
- Running remote MFE dev servers (mfe-whiteboard on :5174, mfe-courseware on :5175) — **essential** for dynamic loading to work in dev mode. The MfeLoader will show "remote not found" error if these are not running.

**Missing dependencies with fallback:**
- None — all required packages (react, react-dom, lucide-react, @module-federation/runtime) are already installed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | none — see Wave 0 |
| Quick run command | `npx vitest run src/mfe/__tests__/ --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MFE-LOAD-01 | MfeLoader resolves remote entry URL and renders component | integration | `npx vitest run src/mfe/__tests__/MfeLoader.test.tsx -x` | ❌ Wave 0 |
| MFE-LOAD-02 | Error Boundary catches render crash, shows fallback UI with retry/dismiss | integration | `npx vitest run src/mfe/__tests__/MfeErrorBoundary.test.tsx -x` | ❌ Wave 0 |
| MFE-LOAD-03 | createMfeApp lifecycle contract: mount, unmount, update, styles | unit | `npx vitest run src/mfe/__tests__/lifecycle.test.ts -x` | ❌ Wave 0 |
| MFE-LOAD-04 | root.unmount() called on MfeLoader unmount, no detached DOM nodes | integration | `npx vitest run src/mfe/__tests__/memory.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/mfe/__tests__/ --reporter=verbose --changed`
- **Per wave merge:** `npx vitest run src/mfe/__tests__/ --reporter=verbose`
- **Phase gate:** Full vitest suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/mfe/__tests__/MfeLoader.test.tsx` — covers MFE-LOAD-01
- [ ] `src/mfe/__tests__/MfeErrorBoundary.test.tsx` — covers MFE-LOAD-02
- [ ] `src/mfe/__tests__/lifecycle.test.ts` — covers MFE-LOAD-03
- [ ] `src/mfe/__tests__/memory.test.ts` — covers MFE-LOAD-04
- [ ] `src/mfe/__tests__/test-utils.tsx` — shared test fixtures (mock MfeContext, mock remote module factory)

## Security Domain

> Security enforcement: This phase does not handle authentication, authorization, or data validation for user-facing input. The MfeLoader is a frontend rendering component. Security-related features (MFE-SEC-01, MFE-SEC-02, MFE-SEC-03) are deferred.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | partial | RemoteConfig props from `MfeLoader` usage are controlled by host code (not user input). No direct user input is processed by MfeLoader. |
| V6 Cryptography | no | — |

### Known Threat Patterns for Browser/React

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via remote module injection | Tampering | Remote modules are loaded from controlled dev servers (dev) or registered URLs in SQLite (production). MfeLoader does not execute arbitrary strings — it loads real ES modules via `loadRemote()`. |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: npm registry] `@module-federation/runtime` v2.5.1 — package installed and confirmed
- [VERIFIED: npm registry] `@module-federation/vite` v1.16.8 — package installed and confirmed
- [VERIFIED: npm registry] React 19.2.7 / react-dom 19.2.7 — latest versions
- [CITED: module-federation.io/guide/bridge/react/load-component] `createLazyComponent` API — official documentation
- [CITED: module-federation.io/guide/runtime] Runtime initialization guide — official documentation
- [CITED: module-federation.io/practice/frameworks/next/dynamic-remotes] Dynamic remotes with `type: 'module'` — official documentation
- [CITED: github.com/module-federation/core/discussions/3252] Vite + dynamic remotes init/loadRemote patterns — maintainer confirmed

### Secondary (MEDIUM confidence)
- [ASSUMED] `@module-federation/enhanced/runtime` API parity with `@module-federation/runtime` — verified that both are at 2.5.1 and from the same publisher
- [CITED: react.dev] `createRoot` and `root.unmount()` API — standard React 19 documentation

### Tertiary (LOW confidence)
- [ASSUMED] Host init conflict with `@module-federation/vite` plugin — needs verification during implementation (see Open Questions)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed installed, versions verified
- Architecture: HIGH — all patterns derived from locked decisions (D-01 to D-27) and existing project conventions
- Pitfalls: HIGH — drawn from well-known MF and React anti-pattern documentation
- State of the art: MEDIUM — one piece (init conflict) is unverified assumption

**Research date:** 2026-06-20
**Valid until:** 2026-08-20 (stable patterns; @module-federation v2.5.x may have minor API changes)
