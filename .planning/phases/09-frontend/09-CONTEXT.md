# Phase 9: 前端集成 + 过渡期 - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段将插件系统扩展到浏览器端：实现前端 PluginHost（浏览器端 ServiceRegistry + WebWorker 管理）、Extension Points（classroomTools、teacherTabs、studentViews 等插件 UI 注册点），以及新旧插件系统的过渡期并行兼容策略。Phase 8 已完成全部后端插件迁移（6 个内置 + 2 个第三方），Phase 9 在此基础上将插件系统的完整生命周期延伸到前端，使第三方插件能够注册前端 UI 组件并在浏览器 Web Worker 中安全执行。
</domain>

<decisions>
## Implementation Decisions

### 前端 PluginHost 架构 (Frontend PluginHost Architecture)
- **D-01:** 前端 PluginHost 镜像后端设计 — 包含浏览器端 `ServiceRegistry`、`PluginHost` 生命周期（install/activate/deactivate/uninstall），以及 `BrowserWorkerManager`。使用 `zustand`（已在依赖中）进行前端 PluginHost 的状态管理，避免在 App.tsx 中增加更多 useState。
- **D-02:** 前端服务 Token 集合 — 提供以下浏览器端 IService：`IFrontendAPI`（fetch 封装，调用 `/api/*`）、`ISocketService`（Socket.IO 客户端）、`IUIService`（Toast/Modal 系统）、`IStorageService`（localStorage 封装）。各服务在前端 ServiceRegistry 中注册为 Token。
- **D-03:** PluginHost 实例通过 React Context 分发到整个组件树，避免 prop drilling。App.tsx 在顶层初始化 `FrontendPluginHost` 并通过 `<PluginHostProvider>` 提供。

### Extension Points 设计 (Extension Points Design)
- **D-04:** 采用 Slot-based 注册模式。插件在 `activate(ctx)` 中通过 `ctx.ui.registerExtensionPoint(slot, config)` 注册 UI 组件。Slot 类型包括：`teacher.dashboard.widget`、`teacher.tab`、`student.view`、`student.lesson.tool`、`classroom.tool` 等。
- **D-05:** Extension Point 组件使用 React 懒加载（`React.lazy`）渲染。插件注册时提供 `component` 工厂函数（`() => React.ComponentType`），PluginHost 在首次渲染时动态加载。
- **D-06:** App.tsx 中的硬编码 teacher tabs 和 student views 重构为从 PluginHost 的 Extension Points 动态渲染，同时保留现有核心 tab 作为默认不可移除项（dashboard、courses、classes、settings）。

### Web Worker 实现 (Browser Web Worker Implementation)
- **D-07:** 完成 Phase 5 留下的 `BrowserWorkerTransport` stub。使用 `new Worker(blobUrl)` 模式，其中 blob URL 从插件 ESM bundle 构建。Blob URL 创建 → Worker 加载 → import() 执行 → ServiceProxy RPC 建立。
- **D-08:** 前端 `ServiceHost` 镜像后端 `packages/core/worker-runtime/service-host.ts` 的 RPC 模式。Worker 中的插件通过 `postMessage` 与主线程的 ServiceHost 通信。主线程端执行 CapabilityGuard 检查。
- **D-09:** 前端 EventBus 支持跨 Worker 事件转发。Worker 中 `eventBus.subscribe('lesson.created', handler)` → `postMessage` → 主线程 ServiceHost 订阅 Socket.IO 事件 → 转发到 Worker 中的 handler。
- **D-10:** Web Worker 中的插件受限访问 — 只能通过 ServiceProxy RPC 访问主线程服务，不能直接访问 DOM/localStorage/fetch。所有 DOM 操作通过 `IUIService` 代理。

### 新旧系统过渡策略 (Dual-System Transition Strategy)
- **D-11:** 命令路由优先级：modern handler 优先，legacy 回退。CommandBus 的 `getHandler(commandType)` 先查 modern（PluginHost 注册的新格式 handler），找不到再查 legacy（旧 `bootstrap*Plugins` 注册的 handler）。Phase 8 已将所有内置插件迁移为新格式，此路由主要用于第三方插件过渡。
- **D-12:** 旧格式插件在 `plugins` 表中标记 `execution_mode = 'legacy'`，与新格式插件（`'inline'` / `'worker'`）共存。前端 Plugin 中心 UI 对 legacy 插件显示黄色 "可迁移" 标记。
- **D-13:** 开发者上传新格式 ZIP 包（含 `manifest.json`）到插件中心后，插件进入新系统。已有的旧格式（纯 JS 字符串）插件保持可用。当新格式版本的插件成功激活后，UI 提示用户可安全卸载旧格式版本。

### 前端 Plugin 管理 UI (Plugin Management UI)
- **D-14:** 扩展现有插件中心 UI（`teacherTab === 'plugins'`），支持：ZIP 文件拖拽上传 + 预览 manifest、legacy 标记显示、迁移提示横幅。使用 `jszip`（已在依赖中）在前端解析 ZIP 包预览 manifest 信息。
- **D-15:** 插件中心新增 "迁移" 按钮（仅在 legacy 插件有新格式对应版本时显示），引导开发者完成从旧格式到新格式的切换。

### 迁移优先级与波次 (Waves & Ordering)
- **D-16:** 按依赖关系分 4 个 Wave 递进：
  - Wave 1（Plan 09-01）：前端 ServiceRegistry + PluginHost 基础架构
  - Wave 2（Plan 09-02）：Extension Points 系统 + App.tsx 集成
  - Wave 3（Plan 09-03）：Browser Web Worker 完整实现 + ServiceProxy
  - Wave 4（Plan 09-04）：过渡期兼容策略 + 前端 Plugin 管理 UI 更新 + 端到端测试

### the agent's Discretion
- **D-17:** React Context vs zustand 的具体使用比例、Extension Point 的类型定义细节、Blob URL 的缓存策略、前端 ServiceRegistry 是否需要与后端共享 Token 命名空间（推荐共享），均由开发助手自主决定。
- **D-18:** vitest + jsdom 测试策略、Web Worker 的 mock 方式、Extension Point 渲染的测试方案由开发助手设计。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 后端插件基础设施 (Backend Plugin Infrastructure)
- `packages/core/di/interfaces.ts` — 所有 IService Token 定义（后端 7 个 Token），Phase 9 需新增前端专用 Token
- `packages/core/di/service-registry.ts` — ServiceRegistry 容器实现，前端需镜像实现
- `packages/core/plugin-host/index.ts` — PluginHost 完整生命周期 (install/activate/deactivate/uninstall/togglePlugin)，前端 PluginHost 的参考实现
- `packages/core/plugin-host/types.ts` — PluginContext, PluginState, Disposable 等核心类型定义

### Worker & Transport
- `packages/core/worker-runtime/types.ts` — IWorkerTransport 接口，BrowserWorkerTransport 需实现此接口
- `packages/core/worker-runtime/service-host.ts` — ServiceHost (主线程端 RPC 处理)，前端需镜像实现
- `packages/core/worker-runtime/worker-manager.ts` — WorkerRegistry + Worker 生命周期管理
- `packages/core/esm-loader/browser-loader.ts` — BrowserEsmLoader (Blob URL + import())，前端 Worker 加载的基础

### 前端现有代码
- `src/App.tsx` — 主 SPA 组件（11K+ 行），包含 plugin 中心 UI、teacher tabs 硬编码、Socket.IO 客户端
- `src/components/` — 现有 React 子组件目录（19 个组件），参考代码风格和导入模式

### 数据库
- `packages/core/db/index.ts` — plugins 表的 `execution_mode` 列（'inline'/'worker'/'legacy'），transition 需读/写此列

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`BrowserEsmLoader`** (`packages/core/esm-loader/browser-loader.ts`): 已实现 Blob URL + import() 的浏览器端 ESM 动态加载。Phase 3 已验收测试。Web Worker 可直接复用此加载器加载插件代码。
- **`ServiceRegistry`** (`packages/core/di/service-registry.ts`): 完整 DI 容器（register/resolve/unregister + 拓扑排序 + 循环检测）。前端 ServiceRegistry 可参考此实现（可能简化依赖注入逻辑，前端服务依赖扁平）。
- **`PluginHost`** (`packages/core/plugin-host/index.ts`): 完整插件生命周期管理器。前端 PluginHost 可复用状态机逻辑（INSTALLED → ACTIVATING → ACTIVE → DEACTIVATING → INACTIVE）。
- **`WorkerManager`** (`packages/core/worker-runtime/worker-manager.ts`): Worker 生命周期管理。前端 BrowserWorkerManager 可参考此实现，但将 `node:worker_threads` 替换为 Web Worker API。
- **`jszip`** (NPM 依赖): 已安装。前端可用 `jszip` 在浏览器端解析 ZIP 包，预览 manifest.json。
- **`zustand`** (NPM 依赖): 已安装但未使用。可用于前端 PluginHost 状态管理，避免增加 App.tsx 的 useState 负担。
- **`socket.io-client`** (NPM 依赖): 已安装，App.tsx 已有 Socket.IO 连接逻辑。`ISocketService` 可封装现有 socket 逻辑。

### Established Patterns
- **Token 命名规范**: 后端 Token 使用 `@openlearn/core:IServiceName` 格式。前端 Token 应使用 `@openlearn/frontend:IServiceName` 格式，与后端区分命名空间。
- **Disposable 模式**: 插件 dispose 时通过 ResourceTracker 清理资源（命令处理器、事件订阅、定时器）。前端 Extension Points 也应实现 Disposable 模式。
- **洋葱模型中间件**: Phase 7 实现的中间件管道可用于前端插件生命周期（activate 前后、deactivate 前后）。
- **硬编码 Tab 模式**: App.tsx 当前使用 `teacherTab` state 条件渲染 11 个 tab。Phase 9 需将部分 tab（至少第三方扩展 tab）改为动态渲染。

### Integration Points
- **`src/App.tsx`** — 主入口：PluginHost Provider 初始化、Extension Points 渲染替换硬编码 tab、现有 plugin 管理 UI 扩展
- **`src/main.tsx`** — React 入口：可能需要在此包装 `<PluginHostProvider>`
- **`server.ts`** — API 路由：`/api/plugins` 系列接口已通过 Phase 8 清理完成，前端直接调用即可
- **`packages/core/worker-runtime/`** — 需新增 `browser-worker-transport.ts` 实现 IWorkerTransport

</code_context>

<specifics>
## Specific Ideas

- 前端 PluginHost 不需要完整的依赖注入拓扑排序（前端服务依赖关系是扁平的），可以简化 ServiceRegistry 实现。但保持相同的 API 接口（`register`/`resolve`）以降低学习曲线。
- Extension Points 的 React 懒加载应使用 `<Suspense fallback={<LoadingSkeleton />}>` 包装，防止插件组件加载阻塞 UI。
- Web Worker 中加载的插件代码应只包含 ESM bundle，manifest.json 在主线程解析。Worker 启动流程：主线程解析 ZIP → 提取 manifest + ESM bundle → 创建 Blob URL → `new Worker(blobUrl)` → postMessage 发送 activate 指令。
- 旧格式插件的 transition 提醒使用黄色 `Badge` 组件（lucide-react 的 AlertTriangle icon + "可迁移" 标签），点击后引导从服务器下载对应的新格式 ZIP 重新安装。
- 前端 ServiceRegistry 的 Token 实例不需要和 TypeScript 类型做严格泛型绑定（浏览器端无类型检查），可以简化 Token 定义为纯字符串标识符。

</specifics>

<deferred>
## Deferred Ideas

- 前端 App.tsx 拆分为微前端架构 → 已在 Out of Scope 中，独立阶段。Phase 9 仅在现有 App.tsx 结构下集成 PluginHost。
- 前端插件市场/商店 → 需要 CDN、审计、付费等基础设施，Out of Scope。
- 前端 ServiceRegistry 与后端共享 Token 定义（同构 DI）→ 有吸引力但增加复杂度且不影响目标，作为未来探索方向。
- PWA / Service Worker 离线支持 → 独立阶段。

</deferred>

---

*Phase: 09-frontend*
*Context gathered: 2026-06-19*
