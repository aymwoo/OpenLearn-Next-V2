# Research Summary: OpenLearnV2 — 微前端架构改造

**Domain:** Pluggable LMS Micro-frontends (Vite Module Federation)
**Researched:** 2026-06-19
**Overall confidence:** HIGH

## Executive Summary

在 OpenLearnV2 的微前端架构改造中，技术选型决策是决定项目成败的基石。经过对现代微前端生态及构建工具链的充分调研，本项目确定采用官方维护的 **Module Federation 2.0 (MF2)**，即由 `@module-federation/vite` 与 `@module-federation/runtime` 组成的官方标准体系。此举彻底废弃了长期疏于维护、对 Vite 6 新架构（Environment API）支持滞后的社区旧版插件（如 `@originjs/vite-plugin-federation`），保障了微前端系统在 Vite 6 + React 19 技术栈下的高稳定性与面向未来的演进能力。

鉴于 React 19 强单例运行时的要求，本项目设计了严格的依赖共享规范。基座应用（Host）与微前端子应用（Remote）之间的 `react`、`react-dom` 以及全局状态管理库 `zustand` 必须被配置为强单例（`singleton: true`），且 React 版本需开启强版本校验（`strictVersion: true`）。这有效避免了由于加载多重 React 物理实例而导致的 Context 上下文丢失、渲染树断裂以及致命运行时崩溃等问题。同时，针对 Tailwind CSS v4 的 CSS-First 配置模型，采用宿主全局样式文件引入 `@source` 编译指令的方式进行统一类名扫描与提取，消除了子应用重复打包 Tailwind 基础规则导致的样式膨胀。

在系统集成与挂载生命周期层面，所有远程微应用必须导出标准生命周期对象（`bootstrap`、`mount`、`unmount`）。其中，在 `unmount` 清理阶段，必须同步且显式地调用 React 19 的 `root.unmount()` 来彻底销毁 Fiber 树，同时清理 Canvas 绘图、Socket.io 笔迹广播通道等持久副作用，从根本上防止因路由频繁切换而引发的内存泄漏。此外，微前端视图层与后端逻辑层（Web Worker 隔离沙箱）有着明确的安全屏障，微前端自身绝对禁止进行文件系统读写或数据库操作，所有跨模块通信与服务获取必须自上而下通过宿主注入的 `MfeContext`（包括依赖注入容器 `ServiceRegistry` 与事件总线 `IEventBusService`）进行。

最后，系统通过通用的 React 高阶容器组件 `MfeLoader` 对微应用的异步加载、生命周期挂载、错误边界隔离和 Loading 态展示进行了优雅封装。结合 `FrontendPluginHost` 提供的运行时动态注册 API，宿主能基于数据库配置实现微前端插件的动态加载与启停，而无需在编译期写死静态 remote 地址。这为白板（Whiteboard）和课件（Courseware）等庞大单体模块从原 `App.tsx` 中彻底剥离并微前端化打下了坚实的架构基础。

## Key Findings

- **Stack:** 项目必须且仅能统一采用官方的 `@module-federation/vite`（`^1.16.8`）与 `@module-federation/runtime`，并配置 React 19、React DOM、Zustand 5 为强单例共享（`singleton: true`）以确保上下文一致。
- **Architecture:** 基于通用的 `MfeLoader` 视图容器组件，通过包含 `services` 和 `state` 桥接的 `MfeContext` 契约协议，自上而下对子应用注入 DI 服务与全局状态订阅，配合 `ExtensionPointRegistry` 实现插槽式动态挂载。
- **Critical pitfall:** 严禁微应用（View 层）直接调用后台沙箱 Worker（Logic 层）或绕过宿主 DI/事件总线直接操作 VFS 与数据库以确保系统安全；在子应用 `unmount` 中必须强制显式调用 `root.unmount()` 并释放所有 Socket.io 房间订阅和 Canvas DOM 监听以防严重的内存泄漏。

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: 基础设施配置与工程集成 (Infrastructure & Integration)** - 搭建 Vite 6 + Module Federation 2.0 基础构建与编译环境，确立核心依赖单例共享机制，完成 TypeScript 类型定义与工程基建。
   - Addresses: 运行时动态 MFE 加载与依赖版本共享策略，确保基座与子应用编译目标为 `esnext` 以支持 top-level await 异步动态导入。
   - Avoids: 联邦插件选型错误导致运行时漂移与构建失败。
2. **Phase 2: 动态加载器与宿主桥接 (Dynamic Loader & Host Registration)** - 实现 `MfeLoader` 核心高阶容器组件、错误边界降级隔离与 `FrontendPluginHost` 运行时动态发现与注册机制，实现插槽式动态 UI 路由解耦。
   - Addresses: 运行时动态 MFE 加载、MFE 生命周期挂载规范、UI 插槽动态加载。
   - Avoids: 生产环境部署时相对路径打包导致静态资源加载 404/跨域限制，以及开发模式下的热更新（HMR）连接丢失。
3. **Phase 3: 宿主状态共享与 DI 桥接 (State Sharing & DI Bridge)** - 建立 Host 到 Remote 的状态同步管道与依赖注入桥接器，在 `bootstrap` 阶段向子应用封包传入服务实例。
   - Addresses: 宿主状态与上下文共享，将全局 Zustand 状态 store、`IFrontendAPI`、`ISocketService` 等服务穿透注入子应用。
   - Avoids: React Context 穿透失效、Zustand 状态分裂以及底层 DI 容器 `ServiceRegistry` 多实例导致的 Token 查找失败。
4. **Phase 4: 业务模块解耦与样式沙箱化 (Decoupling & Scoping)** - 将大单体 App.tsx 中的白板和课件视图彻底抽离为独立的微前端，并配置编译插件及 CSS 规范以确保样式与沙箱安全。
   - Addresses: 白板与课件微前端化解耦，样式隔离与沙箱保护。
   - Avoids: 视图层越权破坏 Worker 安全沙箱屏障，微应用卸载不干净导致内存泄漏，以及全局样式冲突污染宿主排版。

**Phase ordering rationale:**
- 按照依赖关系，优先完成工程构建层面的插件引入与单例声明（Phase 1）；随后开发用于动态发现和注册的核心加载器容器 `MfeLoader`（Phase 2）；在此基础上，才能通过加载器为子应用注入上下文状态与 DI 服务（Phase 3）；最后，状态与服务通道健全后，方可对白板和课件等具有高交互副作用的重度业务模块进行安全的分步解耦和样式沙箱化集成（Phase 4）。

**Research flags for phases:**
- **Phase 2:** 在联调开发模式下，由于多个子应用运行在不同端口，需重点测试并绑定独立的 `server.hmr` WebSocket 客户端端口，以防 HMR 连接冲突失效。
- **Phase 4:** 白板模块解耦时，需在 `unmount` 中对 Socket.io 的 room 监听退订及 Canvas DOM 卸载逻辑进行严格的内存泄漏审计。

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | 官方 Module Federation 2.0 (Vite 6 + React 19) 的依赖与单例共享配置非常明确，已排除失效的 originjs 插件。 |
| Features | HIGH | 明确了必须实现的 Table Stakes 和避免的 Anti-Features，防止了架构蔓延。 |
| Architecture | HIGH | 基于 MfeLoader 的通用动态加载方案和 DI 桥接设计成熟，具有高度的解耦性和类型安全性。 |
| Pitfalls | HIGH | 覆盖了从构建、React 19 实例、CSS 污染到 Worker 安全沙箱等多个层面的详细踩坑预防指南。 |

## Gaps to Address

- **React 19 并发模式下 Shadow DOM 的样式动态插入机制**：在使用 Shadow DOM 进行物理级样式隔离时，Remote 组件打包出的 CSS 如何能够被自动且安全地注入到其 Shadow Root 内部，而非溢出到全局 document.head 中，这在构建层面需要寻找或定制专用的 Rollup/Vite 插件进行验证。
- **多远程微应用同时进行 HMR 本地调试的便捷度**：在开发环境下，Vite 6 的 Environment API 如何更优雅地管理并同时监控多个独立微应用的源码变动而无需频繁重启或配置大量端口，后续可在开发流程优化中进一步探索。
