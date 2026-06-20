# Phase 12: 宿主状态共享与 DI 桥接 - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段的目标是建立宿主 Shell App 与微前端子应用之间的上下文桥接通道（`MfeContext`）。支持远程子应用共享宿主的 Zustand 状态订阅与 DI 服务注入，并通过 EventBus 订阅和发布实时事件。

通过此通道，微前端子应用（如 whiteboard, courseware）可以作为纯视图层无缝接入宿主，订阅实时班级状态、使用 API 服务、发布实时事件，同时确保内存安全（无泄漏）与沙箱安全（不可越权访问宿主内部私有服务）。

</domain>

<decisions>
## Implementation Decisions

### Zustand 状态共享与订阅机制
- **D-01:** 状态强同步机制：统一通过 React Context 向子应用注入宿主的 Zustand Store 实例，子应用直接导入并使用 `zustand` 导出的 `useStore` 钩子对传入的 store 实例进行细粒度订阅（如 `useStore(infra.store, selector)`），无需在子应用重复实例化。
- **D-02:** 宿主状态重构：重构宿主 `App.tsx` 现有的 React `useState` 核心业务状态（例如课程、班级、当前用户、课件等），提取并移植到一个独立的 Zustand Store（例如 `useAppStore`）中，在 `MfeContextProvider` 中将其原生 store 对象传入 Context。
- **D-03:** 自动生命周期释放：不需要额外的手动 store 级清理。由于子应用使用 Zustand `useStore` 进行订阅，该订阅会自动绑定到子应用 React 组件的生命周期上，在组件卸载时会自动释放订阅，天然杜绝内存泄漏。

### 前端 EventBus 与 Socket 桥接策略
- **D-04:** 混合网络桥接：前端 EventBus 默认仅在浏览器端内部进行本地组件间广播。对于符合 `server:*` 前缀命名规范的事件，宿主自动拦截并转化为 `socket.emit` 发送给 Node.js 后端；同理，后端推送的特定 Socket 消息也由宿主转入前端 EventBus。
- **D-05:** 统一事件载荷：前端 EventBus 流转的所有事件数据负载，统一采用与后端一致的 `PlatformEvent<T>` 结构（包含 `id`, `type`, `source`, `payload`, `timestamp` 元数据），确保端到端的类型安全与一致性。
- **D-06:** 宿主自动清理订阅：宿主向子应用传入包装后的 EventBus 代理（Proxy/Wrapper），该代理自动记录子应用发起的所有 `subscribe` 调用，并在子应用 `unmount` 时自动调用其对应的取消订阅函数，确保零内存泄漏风险。
- **D-07:** 安全最终防线：前端宿主仅作为桥接通道透传事件，不做复杂的权限拦截，由后端的 Socket.IO 处理器和后端 DI 容器能力守卫（CapabilityGuard）作为安全最终防线进行过滤鉴权。
- **D-08:** 动态按需 Socket 订阅：宿主的 Socket.IO 采用引用计数机制。只有当至少有一个活跃子应用通过 EventBus 订阅了某个 `server:*` 跨网络事件时，宿主才通过 Socket 向服务器端发起对应的事件订阅请求；当订阅计数归零时，自动退订以节省服务器和网络带宽。
- **D-09:** 职责分离：子应用请求-响应式数据拉取统一使用 DI 注入的 `IFrontendAPI` (HTTP REST)，而 EventBus 则专门负责单向事件广播，禁止在 EventBus 上利用 `correlationId` 拼装复杂的 RPC 等待机制。
- **D-10:** 异步并发执行：事件分发保持并发执行（`Promise.all`），不进行总线级串行阻塞。需要严格顺序的业务（如白板笔迹），由子应用侧利用 `PlatformEvent` 中的 `timestamp` / `sequence` 进行排序。
- **D-11:** 仅支持全量通配符：EventBus 对通配符订阅仅支持 `*`（订阅全部事件），不支持复杂的命名空间前缀通配符（如 `whiteboard:*`），保持总线实现的高效与简洁。

### EventBus API 接口规范
- **D-12:** 契约标准化：前端 MfeContext 中的 EventBus API 接口形式标准化为：`subscribe(event: string, handler: (event: PlatformEvent) => void) => () => void`（返回取消订阅函数）与 `publish(event: PlatformEvent) => Promise<void>`（支持 async/await）。
- **D-13:** useMfeEvent Hook 助手：在宿主侧的 `src/mfe` 目录提供通用的 `useMfeEvent` 自定义 Hook（例如 `useMfeEvent('event.type', handler)`），内部自动获取 Context 并处理 React 组件销毁时的订阅销毁，对子应用开放。
- **D-14:** 自动补全事件源：子应用的 eventBus 包装代理在 `publish` 时，自动拦截并根据当前微应用名称补全 `source: mfe-name` 字段，避免子应用手动填充或写错。

### DI 服务注册表安全与隔离
- **D-15:** 只读代理隔离：宿主为子应用注入包装后的 `FrontendServiceRegistry` 只读代理，完全屏蔽 `register` 和 `unregister` 写入方法，仅暴露 `resolve`, `get`, `has` 查询接口。
- **D-16:** 白名单访问控制：只读代理中配置化管理可访问的服务白名单（在 `MfeContextProvider` 内部定义静态数组，包含 `@openlearn/frontend:IFrontendAPI`、`@openlearn/frontend:ISocketService`、`@openlearn/frontend:IUIService`、`@openlearn/frontend:IStorageService`）。尝试解析未在白名单的宿主私有服务时抛出权限异常。
- **D-17:** DI 异常强抛出：如果子应用请求了白名单内的核心服务，但宿主在初始化时并未注册该服务，代理应立即抛出标准 DI 异常，由 MfeErrorBoundary 捕获降级，使用户在开发期能立刻知晓依赖缺失。

### the agent's Discretion
- 所有关键决策均已在讨论中与用户对齐，无自主决断的灰色地带。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划与需求
- `.planning/ROADMAP.md` — Milestone v2.0 路线图，Phase 12 详情及成功标准
- `.planning/REQUIREMENTS.md` — MFE-BRIDGE-01 ~ MFE-BRIDGE-04 需求定义
- `.planning/PROJECT.md` — 项目核心价值、约束与关键决策
- `.planning/phases/11-loader-bridge/11-CONTEXT.md` — Phase 11 决策

### MFE 契约与提供者代码
- `src/mfe/types.ts` — MFE Context 与 Lifecycle 契约声明 (D-12 的修改将应用到此)
- `src/mfe/MfeContextProvider.tsx` — React Context 提供者 (DI 白名单与 EventBus 代理的核心构建位置)
- `src/mfe/useMfeContext.ts` — 子应用消费宿主能力的统一 Hook

### 核心服务与状态代码
- `src/plugin-host/service-registry.ts` — 宿主侧 FrontendServiceRegistry 实现 (D-15 只读代理的目标源)
- `packages/core/event-bus/index.ts` — 核心 PlatformEvent 定义与 EventBus 逻辑
- `src/services/socket-service.ts` — 前端封装的 ISocketService (用于 EventBus 网络桥接的通道)
- `src/App.tsx` — 包含现有核心共享业务状态，需迁移重构为 Zustand useAppStore

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MfeContextProvider` React Context 与 `useMfeContext` Hook — 上下文传递的现有通道。
- `FrontendServiceRegistry` — 提供 flat DI 的 `resolve`, `has` 实现，可供只读 Proxy 包装。
- `PlatformEvent` 接口 — 作为事件传输的标准结构。
- `useStore` — `zustand` 导出的 React 订阅 Hook，子应用可以直接使用它订阅传入的 store 实例。

### Established Patterns
- Module Federation singleton 共享：`react`, `react-dom`, `zustand` 为单例，确保在共享 scope 下，库的全局上下文和钩子是一致的。
- React 19 Function Components + Hooks 语法。
- 契约由宿主定义在 `src/mfe/types.ts`，远程子应用使用 `import type` 引用。

### Integration Points
- `src/App.tsx` — 需要将 state 重构为 `useAppStore`，并在渲染 MfeContextProvider 时传入该 store。
- `src/mfe/MfeLoaderCore.tsx` — 调用 `createMfeApp(mfeContext)`，目前传入了空对象，需要调用 `useMfeInfraContext()` 获取真实的 infra 并注入。
- `src/mfe/MfeContextProvider.tsx` — 需在此处实现：
  1. `useAppStore` 的实例创建与 Context 整合。
  2. EventBus 包装代理（自动记录订阅并自动清理，补全 `source` 字段，拦截并转换 `server:*` 事件，通过 WebSocket 发送并配合引用计数）。
  3. `ServiceRegistry` 只读代理（校验静态白名单数组，限制 register/unregister 操作）。

</code_context>

<specifics>
## Specific Ideas

- **EventBus Proxy 引用计数简易实现**：可以通过在包装代理中维护一个 `Map<string, Set<Function>>` 来实现。当事件前缀是 `server:` 时，如果 map 中该事件的监听器数量从 0 变 1，就调用 `socketService.on` 监听网络事件；当监听器数量从 1 变 0 时，调用 `socketService.off` 注销网络监听，从而实现极其精确的按需带宽节省。

</specifics>

<deferred>
## Deferred Ideas

- None — 讨论内容完全聚焦于状态共享与 DI 桥接本身。

</deferred>

---

*Phase: 12-di-bridge*
*Context gathered: 2026-06-20*
