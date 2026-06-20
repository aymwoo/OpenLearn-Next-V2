# Phase 13: 业务模块解耦与样式沙箱化 - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段的目标是解耦现有的 Host Shell App 中的大单体 App.tsx，将 InteractiveWhiteboard（白板）与 InteractiveCoursewareViewer（课件查看器）视图抽离为独立的微前端子应用项目（分别对应 `packages/mfe-whiteboard` 与 `packages/mfe-courseware`），在宿主端通过 MfeLoader 进行动态异步解析与加载，并配合 Tailwind v4 前缀、CSS Modules 以及 Preflight 隔离机制实现彻底的样式沙箱隔离与下线容灾降级。

通过该解耦，原大单体 `App.tsx` 能够极大程度瘦身，核心白板与课件逻辑移出主应用项目，成为支持独立发版、独立打包的 Module Federation Remote 模块，并基于 Phase 12 的 DI 与状态共享通道安全运行。

</domain>

<decisions>
## Implementation Decisions

### Zustand 状态共享与本地 UI 隔离 (State Acquisition & UI Isolation)
- **D-01:** 状态消费机制：微前端应用统一通过 `MfeContext` 共享的 Zustand Store 进行 React 级别细粒度订阅与 Actions 状态写入，保证单一数据源，最大化解耦并不使用 React Props 进行传统双向流转。
- **D-02:** 非 React 状态消费：在非 React 逻辑或高频同步逻辑（如 Konva 绘图回调）中，微前端应用应直接通过调用 `infra.store.getState()` 同步获取数据最新快照，彻底规避 React 闭包旧值问题。
- **D-03:** 业务大字典共享：业务字典及大基础数据（如班级列表、课程列表、当前用户信息）统一由宿主全局 Zustand Store 托管，微前端应用直接从 store 消费，避免产生冗余的二次接口网络拉取开销。
- **D-04:** 局部 UI 状态自管理：微前端应用的纯局部交互状态（如白板的笔画粗细、当前所选颜色、全屏等 UI 控制）统一由微前端应用组件自身通过 React `useState` 局部托管，不进入宿主全局 Zustand Store，实现职责边界隔离与避免不必要的渲染风暴。

### 实时通信与高频数据路由 (WebSocket Sync & Routing)
- **D-05:** 高频数据直连 Socket：针对白板协同的高频绘图轨迹（画笔移动、点坐标），微应用应通过 DI 解析宿主的 `@openlearn/frontend:ISocketService` 直连底层 WebSocket 通道进行双向数据实时传输，防止高频坐标消息污染前端 EventBus 总线。
- **D-06:** 临时笔迹内存广播：协同绘图时产生的临时画笔轨迹（`temp-draw` 和 `temp-end`）仅通过 WebSocket 进行端到端内存实时广播渲染，在画笔抬起（Pointer Up）完成最终线段或图形时，再由微应用调用命令写入 SQLite 进行持久化，大幅降低并发数据库写锁冲突风险。
- **D-07:** 低频消息总线网格：低频的控制或教学业务通知事件（如随机点名 picked 结果、环节同步切换等）统一发布到宿主的本地 EventBus，利用 `server:*` 事件经由 SocketBridge 自动广播，使各组件能够实现松耦合协同响应。

### 样式隔离与 Tailwind CSS 沙箱化 (CSS Isolation & Sandbox)
- **D-08:** Tailwind 前缀隔离：为避免白板和课件与宿主发生全局类名冲突，两个微前端子应用分别配置独立的 Tailwind 前缀（白板使用 `wb-`，课件使用 `cw-`）结合根 class 包裹限制，规避 Shadow DOM 带来的 Portal 弹出层定位失效兼容性问题。
- **D-09:** 自定义样式哈希化：微应用编写的普通非 Tailwind 自定义样式一律强制使用 CSS Modules（`*.module.css`）进行哈希混淆命名，由 Vite 在编译期提供无缝的安全隔离保障。
- **D-10:** 禁用子应用 Preflight：为防止子应用覆盖宿主默认样式，在子应用 Tailwind 打包构建时明确禁用全局基础重置样式（`preflight: false`），微前端视图层直接复用宿主的全局 Preflight。

### 插件注册与数据库动态加载 (Plugin Registration & Fail-safe)
- **D-11:** 数据库种子配置发现：核心微前端白板与课件应用全部作为动态 remote 记录预置在 `mfe_remotes` 数据库表中。宿主启动时自动发现并使用 MfeLoader 异步挂载，支持零停机热更新和独立版本控制。
- **D-12:** 停用降级安全防守：当管理员停用或注销某个微前端记录时，宿主端 UI 对应的插槽区域（如 Tab 选项卡或内嵌面板）应友好显示“应用未安装或已停用”占位符，且完全阻断对 Entry 远程脚本的网络请求，以确保宿主在子应用下线或崩溃时的最大安全容错。

### the agent's Discretion
- 无。所有重大架构与交互设计均与用户进行了详细讨论和决策对齐。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划与需求
- `.planning/ROADMAP.md` — Milestone v2.0 路线图，Phase 13 详情及成功标准
- `.planning/REQUIREMENTS.md` — MFE-VIEW-01 ~ MFE-VIEW-04 需求定义
- `.planning/STATE.md` — 项目决策与连续性历史状态
- `.planning/phases/12-di/12-CONTEXT.md` — Phase 12 状态与 DI 桥接上下文决策

### 核心服务与加载代码
- `src/mfe/types.ts` — MfeContext 类型契约 (子应用用以类型推导)
- `src/mfe/MfeLoaderCore.tsx` — 动态加载器实现，负责微应用实例化与 unmount 清理调用
- `src/store/appStore.ts` — 宿主侧全局 Zustand 共享状态 store

### 待解耦的源码目标
- `src/components/InteractiveWhiteboard.tsx` — 现有的 4000+ 行大单体白板代码，需移入子应用
- `src/components/InteractiveCoursewareViewer.tsx` — 课件查看器组件，需移入子应用
- `src/App.tsx` — 宿主侧入口文件，包含现有白板与课件的内嵌逻辑，需替换为 MfeLoader

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MfeLoader` / `MfeLoaderCore` (Allows rendering remote modules dynamically)
- `MfeContextProvider` / `useMfeContext` (Provides access to `MfeContext` containing Zustand store, socket, eventBus)
- `useAppStore` (Shared global state container in host)
- `InteractiveWhiteboard.tsx` / `InteractiveCoursewareViewer.tsx` (Existing local components, to be moved and decoupled as independent remotes)

### Established Patterns
- Module Federation Singleton Sharing (react, react-dom, zustand as singletons)
- Module Federation entry mapping (`mfe_remotes` registration API fetch)

### Integration Points
- `src/App.tsx` (Remove direct import of whiteboard and courseware viewer, replace with MfeLoader wrappers)
- `packages/mfe-whiteboard/src/App.tsx` (Implement whiteboard mount/unmount factory wrapper loading InteractiveWhiteboard)
- `packages/mfe-courseware/src/App.tsx` (Implement courseware mount/unmount factory wrapper loading InteractiveCoursewareViewer)

</code_context>

<specifics>
## Specific Ideas

- **开发过渡隔离**：解耦时，原 `src/components/InteractiveWhiteboard.tsx` 和 `src/components/InteractiveCoursewareViewer.tsx` 应当剪切移入子应用包的相应 src 目录下，而宿主侧对应的文件应当删除或替换为占位导出，防止重复加载相同类库导致包冗余。

</specifics>

<deferred>
## Deferred Ideas

- None — 所有讨论内容都严格聚焦于解耦与沙箱化。

</deferred>

---

*Phase: 13-decouple*
*Context gathered: 2026-06-20*
