# Roadmap: OpenLearnV2 微前端架构改造

## Milestones

- ✅ **v1.0 插件系统重构** — Phases 1-9 (shipped 2026-06-19)
- 🚀 **v2.0 微前端架构改造** — Phases 10-13 (planning)

## Phases

- [ ] **Phase 10: 基础设施配置与工程集成** — 搭建 Vite 6 + Module Federation 2.0 基础构建与编译环境，确立核心依赖单例共享机制，配置 Tailwind CSS 扫描及 esnext 编译目标。
- [ ] **Phase 11: 动态加载器与宿主桥接** — 实现通用的 React 高阶容器组件 `MfeLoader`、错误边界与加载 Fallback，并定义及实施远程微应用标准生命周期接口。
- [ ] **Phase 12: 宿主状态共享与 DI 桥接** — 建立宿主与子应用的上下文桥接通道（MfeContext），支持远程组件共享宿主的 Zustand 状态订阅与 DI 服务注入，并通过 EventBus 订阅 and 发布实时事件。
- [ ] **Phase 13: 业务模块解耦与样式沙箱化** — 解耦原单体 App.tsx，将白板与课件视图抽离为独立的微前端子应用，实现 CSS 隔离与宿主数据库动态注册插件渲染。

<details>
<summary>✅ v1.0 插件系统重构 (Phases 1-9) — SHIPPED 2026-06-19</summary>

- [x] Phase 1: Token DI 内核 (4/4 plans) — completed 2026-06-18
- [x] Phase 2: 现有能力 Token 化 (3/3 plans) — completed 2026-06-18
- [x] Phase 3: ESM 加载 + 包格式 (4/4 plans) — completed 2026-06-18
- [x] Phase 4: PluginHost + 生命周期 (4/4 plans) — completed 2026-06-18
- [x] Phase 5: Worker 隔离 + 双运行时 (4/4 plans) — completed 2026-06-18
- [x] Phase 6: EventBus 服务 + SemVer 兼容 (3/3 plans) — completed 2026-06-19
- [x] Phase 7: 热重载 + 中间件管道 (4/4 plans) — completed 2026-06-19
- [x] Phase 8: 现有插件迁移 (4/4 plans) — completed 2026-06-19
- [x] Phase 9: 前端集成 + 过渡期 (4/4 plans) — completed 2026-06-19

</details>

## Phase Details

### Phase 10: 基础设施配置与工程集成
**Goal**: 搭建 Vite 6 + Module Federation 2.0 基础构建与编译环境，确立核心依赖单例共享机制，配置 Tailwind CSS 扫描及 esnext 编译目标。
**Depends on**: Phase 9 (v1.0 base infrastructure)
**Requirements**: MFE-INF-01, MFE-INF-02, MFE-INF-03
**Success Criteria**:
  1. Developers can build host and remote projects targeting `esnext` and run the development servers with no console errors about dependency version mismatches.
  2. Dynamic path resolution enables asset assets to load correctly from remotes when hot-reloading or switching host environment configurations.
  3. UI styles authored in remotes are correctly scanned by the Host's Tailwind CSS compiler and rendered correctly without visual brokenness on load.
**Plans**: 2 plans
- [x] 10-01-PLAN.md — 创建 Wave 0 测试骨架文件以校验依赖单例、构建目标与样式扫描配置
- [x] 10-02-PLAN.md — 搭建微前端基础设施配置，完成宿主和子应用的 Module Federation 单例共享、编译 target/base 配置以及样式扫描规则
**UI hint**: yes

### Phase 11: 动态加载器与宿主桥接
**Goal**: 实现通用的 React 高阶容器组件 `MfeLoader`、错误边界与加载 Fallback，并定义及实施远程微应用标准生命周期接口。
**Depends on**: Phase 10
**Requirements**: MFE-LOAD-01, MFE-LOAD-02, MFE-LOAD-03, MFE-LOAD-04
**Success Criteria**:
  1. Users see a sleek loading skeleton/spinner while a remote component is being dynamically fetched and loaded via `MfeLoader`.
  2. If a remote component encounters a runtime crash, the rest of the host interface remains fully functional, displaying a friendly error fallback component with a reload option.
  3. Memory usage remains stable without leaks after opening, interacting, and closing a remote application repeatedly, verifying successful invocation of the standard `unmount` hook and React root unmounting.
**Plans**: 4 plans
- [x] 11-01-PLAN.md — Type contracts, DB schema, /api/mfe/remotes endpoint, client API, test scaffold
- [x] 11-02-PLAN.md — Context providers, preload/leak-detector utilities, MF runtime init in main.tsx
- [x] 11-03-PLAN.md — UI fallback components, Error Boundary, MfeLoaderCore, MfeLoader composition
- [x] 11-04-PLAN.md — createMfeApp lifecycle adoption in mfe-whiteboard and mfe-courseware
**UI hint**: yes

### Phase 12: 宿主状态共享与 DI 桥接
**Goal**: 建立宿主与子应用的上下文桥接通道（MfeContext），支持远程组件共享宿主的 Zustand 状态订阅与 DI 服务注入，并通过 EventBus 订阅和发布实时事件。
**Depends on**: Phase 11
**Requirements**: MFE-BRIDGE-01, MFE-BRIDGE-02, MFE-BRIDGE-03, MFE-BRIDGE-04
**Success Criteria**:
  1. Users observe real-time state updates (e.g. current user, theme, class status) sync seamlessly in remote views when they change in the host shell app.
  2. A remote component can successfully request API data and send events using the host-injected `ServiceRegistry` services (e.g. EventBus, API) without needing local credentials or re-login.
  3. Interactions on remote components trigger live socket notifications and EventBus broadcasts that are instantly received and processed by other active host/remote components.
**Plans**: 0 plans
**UI hint**: yes

### Phase 13: 业务模块解耦与样式沙箱化
**Goal**: 解耦原单体 App.tsx，将白板与课件视图抽离为独立的微前端子应用，实现 CSS 隔离与宿主数据库动态注册插件渲染。
**Depends on**: Phase 12
**Requirements**: MFE-VIEW-01, MFE-VIEW-02, MFE-VIEW-03, MFE-VIEW-04
**Success Criteria**:
  1. Teachers and students can draw on the newly refactored independent whiteboard remote view and upload files to the courseware remote view, experiencing zero regression in latency or responsiveness.
  2. Whiteboard and courseware views display correctly side-by-side with no CSS layout overlap, style conflicts, or font distortion.
  3. Administrators can dynamically register/deregister whiteboard or courseware remote entries in the backend database, and the host UI immediately loads or unloads the plugin view without requiring a full page refresh.
**Plans**: 0 plans
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Token DI 内核 | v1.0 | 4/4 | Complete | 2026-06-18 |
| 2. 现有能力 Token 化 | v1.0 | 3/3 | Complete | 2026-06-18 |
| 3. ESM 加载 + 包格式 | v1.0 | 4/4 | Complete | 2026-06-18 |
| 4. PluginHost + 生命周期 | v1.0 | 4/4 | Complete | 2026-06-18 |
| 5. Worker 隔离 + 双运行时 | v1.0 | 4/4 | Complete | 2026-06-18 |
| 6. EventBus 服务 + SemVer | v1.0 | 3/3 | Complete | 2026-06-19 |
| 7. 热重载 + 中间件管道 | v1.0 | 4/4 | Complete | 2026-06-19 |
| 8. 现有插件迁移 | v1.0 | 4/4 | Complete | 2026-06-19 |
| 9. 前端集成 + 过渡期 | v1.0 | 4/4 | Complete | 2026-06-19 |
| 10. 基础设施配置与工程集成 | v2.0 | 2/2 | Complete   | 2026-06-19 |
| 11. 动态加载器与宿主桥接 | v2.0 | 4/4 | Complete    | 2026-06-19 |
| 12. 宿主状态共享与 DI 桥接 | v2.0 | 0/0 | Planning | - |
| 13. 业务模块解耦与样式沙箱化 | v2.0 | 0/0 | Planning | - |

---

*See [.planning/milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) for detailed Phase 1-9 information.*
*See [.planning/MILESTONES.md](MILESTONES.md) for milestone summary.*
