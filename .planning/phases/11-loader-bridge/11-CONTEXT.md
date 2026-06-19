# Phase 11: 动态加载器与宿主桥接 - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段实现通用的 React 容器组件 `MfeLoader`（支持动态远程 Entry 解析、错误边界与加载 Fallback），定义远程微应用标准生命周期接口（`createMfeApp` 工厂函数），并确保 React 19 `root.unmount()` 正确调用以防止内存泄漏。

Phase 10 已搭建好两个远程 MFE 项目（`mfe-whiteboard` 5174, `mfe-courseware` 5175），各暴露 `./App` 为默认导出。本阶段在此基础之上建立加载器、生命周期契约和错误隔离机制。

</domain>

<decisions>
## Implementation Decisions

### MfeLoader 组件 API 设计
- **D-01:** MfeLoader 通过完整的 `RemoteConfig` 对象指定要加载的远程应用（字段：name, url, fallback, retryCount, timeout 等）。
- **D-02:** 数据与服务通过双通道传递：业务数据通过 React props 透传，宿主基础设施（DI、EventBus、Store）通过 React Context 注入。远程组件通过 `useMfeContext()` 消费平台能力。
- **D-03:** Loading/Error UI 定制采用二层覆盖：`MfeConfigProvider` 设置全局默认组件，单个 `MfeLoader` 可通过 RemoteConfig props 覆盖。
- **D-04:** MfeLoader 采用容器模式渲染 —— 内部使用 `createRoot` 创建独立的 React root，完全控制挂载/卸载生命周期。

### 远程应用生命周期契约
- **D-05:** 远程应用的标准导出格式为工厂函数：`createMfeApp(ctx: MfeContext) => { mount, unmount, update, styles }`。
- **D-06:** `mount(container: HTMLElement, props?: Record<string, any>) => { unmount, update }` — unmount 负责完整清理，update 支持新 props 的无销毁重渲染。
- **D-07:** `createMfeApp` 的 ctx 参数包含宿主服务引用（eventBus, serviceRegistry, store），供远程应用在初始化时获取平台能力。
- **D-08:** `createMfeApp` 采用单次初始化策略 —— 远程模块首次加载时调用一次，返回的 `{ mount, unmount, update }` 可反复使用。
- **D-09:** 全异步支持 —— `createMfeApp` 和 `mount` 均可为 async，支持异步初始化逻辑（加载配置、预取数据等）。
- **D-10:** 宿主自动管理第三方 CSS —— `createMfeApp` 返回的 `styles` 数组在 mount 时由宿主注入 DOM，在 unmount 时自动移除，避免全局样式污染（落实 Phase 10 D-16）。
- **D-11:** 远程应用元数据（name, version, description 等）由后端 SQLite 数据库统一管理，远程应用无需导出 manifest 对象。
- **D-12:** 向后兼容 —— MfeLoader 自动检测远程导出格式：检测到 `createMfeApp` 时使用完整生命周期，检测到默认 React 组件时自动包装为简单的 mount/unmount。现有远程无需修改即可加载。
- **D-13:** 生命周期契约的 TypeScript 类型定义放在宿主侧（如 `src/mfe/types.ts`），远程应用通过 `import type` 引用。宿主是契约的真相来源。

### 错误边界与加载策略
- **D-14:** Error Boundary 采用 Per-instance 粒度 —— 每个 MfeLoader 实例自带独立的 Error Boundary，单个远程崩溃不影响其他远程或宿主。
- **D-15:** 默认加载态 UI 为居中 Spinner 动画，可通过 `MfeConfigProvider` 全局替换为骨架屏或其他自定义组件。
- **D-16:** 错误展示 UI：错误图标 + 简要错误描述 + "重新加载"按钮（手动重试）+ "忽略"按钮（关闭错误提示，显示占位区域）。
- **D-17:** 重试策略为手动触发 —— 加载失败后立即显示错误 UI，用户通过"重新加载"按钮手动发起重试（而非自动静默重试）。
- **D-18:** 可配置加载超时 —— 默认 30 秒，在 RemoteConfig 中可通过 `timeout` 字段覆盖。超时后触发错误状态。

### 内存管理与卸载清理
- **D-19:** unmount 双重触发路径 —— MfeLoader 从 React 树卸载时自动调用（useEffect cleanup）+ 提供显式 ref/controller API（如 `ref.unmount()`）供调用者主动销毁。
- **D-20:** 开发模式下主动泄漏检测 —— unmount 后检查常见泄漏源（未清理的 setInterval、未移除的 event listener、未断开 observer），在 console.warn 中输出警告。
- **D-21:** 宿主全面清理 —— 除调用远程 unmount() 外，宿主主动清理宿主侧资源（EventBus 自动 unsubscribe、Store 自动断开订阅、注入的 styles 移除、React root 销毁）。
- **D-22:** unmount 超时强制销毁 —— 默认 5 秒超时，若远程 unmount() 未在规定时间内完成，强制执行 DOM 移除和 root 销毁，console.error 报告超时。

### Entry URL 加载与解析
- **D-23:** MfeLoader 通过 REST API 动态查询 Remote Entry URL —— 请求 `/api/mfe/remotes?name=mfe_whiteboard` 获取 SQLite 中注册的 remoteEntry.js 地址。落实 Phase 10 D-10（运行时 entry 地址由数据库注册）。
- **D-24:** API 查询结果以内存 Map 缓存 —— 首次查询后缓存，后续同 name 的 MfeLoader 实例复用缓存结果，避免重复网络请求。

### Module Federation Runtime 初始化
- **D-25:** `@module-federation/runtime` 的 `init()` 在应用启动时全局调用一次（在 `main.tsx` 或 App 入口层），所有 MfeLoader 共享同一个 runtime 实例，确保单例依赖（react, react-dom, zustand）的 sharedScope 只解析一次。

### 远程模块预加载
- **D-26:** 提供手动预加载 API —— `preload(name: string): Promise<void>`，调用者在用户即将导航到远程模块时（如 hover 菜单项、路由预加载）主动触发 remoteEntry.js + 主 chunk 的预取。

### MfeLoader 嵌套支持
- **D-27:** 支持 MfeLoader 嵌套 —— 远程组件内部可以再使用 MfeLoader 加载另一个远程。每个嵌套层保持独立的 Error Boundary 隔离，Context 沿嵌套链正确传递。

### Claude's Discretion
- 无 —— 所有决策均与用户对齐。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划与需求
- `.planning/ROADMAP.md` — Milestone v2.0 路线图，Phase 11 详情及成功标准
- `.planning/REQUIREMENTS.md` — MFE-LOAD-01 ~ MFE-LOAD-04 需求定义
- `.planning/PROJECT.md` — 项目核心价值、约束与关键决策
- `.planning/phases/10-infra-config/10-CONTEXT.md` — Phase 10 决策（D-06, D-10, D-12, D-16 的 informational notes 均指向本阶段实现）

### 构建与工程配置
- `vite.config.ts` — 宿主 Vite 配置（Module Federation shared 单例、esnext target、Tailwind 插件）
- `packages/mfe-whiteboard/vite.config.ts` — Whiteboard 远程 MFE 配置（端口 5174、exposes ./App、shared 依赖）
- `packages/mfe-courseware/vite.config.ts` — Courseware 远程 MFE 配置（端口 5175、exposes ./App、shared 依赖）
- `src/index.css` — Tailwind CSS v4 配置（`@source` 扫描 mfe-* 包）

### 现有远程应用源码
- `packages/mfe-whiteboard/src/App.tsx` — 当前为简单默认导出（`export default function App()`），需适配生命周期契约
- `packages/mfe-courseware/src/App.tsx` — 同上

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- React 19 `createRoot` / `root.unmount()` API — 容器模式的核心渲染/卸载机制
- `@module-federation/runtime` — 已在 Phase 10 引入，提供 `init()`, `loadRemote()` 等动态加载 API
- `MfeConfigProvider` — 待新建的 React Context Provider，模式参考现有 Zustand store / Socket.IO Context
- Error Boundary — React class component 模式（`componentDidCatch` + `getDerivedStateFromError`），标准实现
- Tailwind CSS Spinner — 可用 `animate-spin` + `lucide-react` 的 `Loader2` 图标

### Established Patterns
- Host app 构建为 `esnext` target，ESM 模块，`bundler` moduleResolution
- 前端使用函数组件 + Hooks（`useState`, `useEffect`, `useRef`），遵循 `[value, setValue]` 命名约定
- 组件命名 PascalCase（`MfeLoader`, `MfeConfigProvider`），类型命名 PascalCase（`RemoteConfig`, `MfeContext`）
- REST API 响应格式：`{ success: true, result }` / `{ success: false, error: message }`
- Error handling：try-catch + console.error + 用户友好的错误展示

### Integration Points
- `src/main.tsx` — MF runtime `init()` 的调用位置
- `src/App.tsx` — MfeLoader 的使用位置（动态加载远程模块替换现有内联组件）
- `server.ts` — 新增 `/api/mfe/remotes` REST 端点用于查询 Remote Entry URL
- `packages/core/db/index.ts` — 可能需要 `mfe_remotes` 表的 schema（如果尚未创建）
- `src/index.css` — `@source` 已配置扫描 `packages/mfe-*/**/*.{ts,tsx}`，无需修改

</code_context>

<specifics>
## Specific Ideas

- 用户期望 MfeLoader 提供完整的开发体验：dev 模式下的泄漏检测警告、清晰的错误消息、可自定义的加载/错误 UI
- 生命周期契约的设计受到了 Single-SPA Parcel 模式和 Module Federation 原生 API 的启发
- 强调向后兼容性 —— 现有的简单 React 组件导出不应因迁移到生命周期契约而中断

</specifics>

<deferred>
## Deferred Ideas

- Shadow DOM 样式隔离（MFE-SEC-01）— 已在 REQUIREMENTS.md 中标记为 Out of Scope，CSS 模块/前缀隔离更简单
- 第三方 iframe 沙箱（MFE-SEC-02）— 独立安全里程碑
- 远程版本不匹配自动降级（MFE-SEC-03）— 简单的 Error Boundary 对于初始迁移已足够

</deferred>

---

*Phase: 11-loader-bridge*
*Context gathered: 2026-06-19*
