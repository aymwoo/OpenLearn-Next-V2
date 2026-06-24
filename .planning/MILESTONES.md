# Milestones

## v5.1 插件系统能力增强 (Planning: 2026-06-24)

**Steps:** 6 | **Estimated:** ~310 行, ~2h | **Status:** 计划中

**Scope:**
- P0: 插件自主建表能力（PluginDatabaseAPI — 命名空间隔离 + 幂等建表）
- P0: 前端 Extension Slot 扩展（新增 teacher.panel, student.fullscreen, global.setting）
- P0: 插件共享依赖机制（ctx.require() 白名单 — recharts/jspdf/xlsx 等）
- P1: 前端路由支持（ExtensionPointRenderer route prop 注入）
- P1: 文件下载 API（IUIService.downloadFile）

**目标：** 使第三方开发者能交付完整的考试/题库插件。

See: [v5.1-PLUGIN-ENHANCEMENT.md](milestones/v5.1-PLUGIN-ENHANCEMENT.md)

---

## v5.0 核心教学闭环 (Planning: 2026-06-24)

**Phases planned:** 6 phases (23-28) | **Requirements:** 29 | **Status:** 规划中

**Scope:**
- 🔴 Phase 23: 富文本课程编辑器（5项需求 — TipTap编辑器、多媒体嵌入、数学公式、模板系统、AI增强）
- 🔴 Phase 24: 题库系统增强（6项需求 — 题库管理、7种题型、自动组卷、限时考试、结果分析、白板集成）
- 🔴 Phase 25: 学习路径与解锁机制（4项需求 — 课程体系、前置条件、自适应推荐、任务管理）
- 🟡 Phase 26: 学习进度仪表板（4项需求 — 学生仪表板、教师监控、行为分析、成绩预警）
- 🟡 Phase 27: 课程讨论与通知（6项需求 — 讨论区、全局问答、通知系统、课程公告）
- 🟡 Phase 28: 实时授课基础（4项需求 — WebRTC直播、屏幕共享、互动控制、录制回放）

**后续展望：** v6.0 评价激励 → v7.0 教务管理 → v8.0 家校互通 → v9.0 生态开放

See: [v5.0-ROADMAP.md](milestones/v5.0-ROADMAP.md) | [v5.0-REQUIREMENTS.md](milestones/v5.0-REQUIREMENTS.md)

---

## v4.0 质量基础与生产就绪 (Shipped: 2026-06-24)

**Phases completed:** 6 | **Requirements:** 39/39 | **Status:** Shipped ✅

**Scope:**
- 🔴 Phase 17: 安全加固（12项需求 — 密码哈希、Session强化、频率限制、API Key加密、CORS白名单等）
- 🟡 Phase 18: server.ts 模块化拆分（5项需求 — 路由提取、中间件抽象、AI服务独立）
- 🟡 Phase 19: App.tsx 状态抽取与组件化（4项需求 — Zustand迁移、Hook提取、页面拆分）
- 🟡 Phase 20: 数据库迁移系统与备份（4项需求 — 版本化迁移、自动清理、定期备份）
- 🟡 Phase 21: 可观测性基础设施（6项需求 — 结构化日志、健康检查、优雅关闭）
- 🟢 Phase 22: CI/CD + 代码规范 + 功能补全（8项需求 — ESLint/Prettier、GitHub Actions、Docker化）

See: [v4.0-ROADMAP.md](milestones/v4.0-ROADMAP.md) | [v4.0-REQUIREMENTS.md](milestones/v4.0-REQUIREMENTS.md)

---

## v3.0 作业提交与学生互评插件 (Shipped: 2026-06-20)

**Phases completed:** 3 phases, 3 plans | **Tests:** 100% pass

**Key accomplishments:**
- 数据库结构设计与 `ISemesterGradeService` DI 服务对接
- 学生端文件上传（VFS 存储）、版本管理、自由互评系统
- 教师打分、权重折算（教师60% + 互评40%）、学期成绩同步

---

## v2.0 微前端架构改造 (Shipped: 2026-06-20)

**Phases completed:** 4 phases, 8 plans, 24 tasks

**Key accomplishments:**

- 创建 Phase 10 微前端基础设施配置与样式扫描的 Wave 0 测试骨架文件，为后续的配置开发提供 TDD 式的自动化校验。
- 完成 OpenLearnV2 微前端基础设施的搭建与工程配置，集成 Vite 6 与 Module Federation 2.0，配置共享依赖单例与 Tailwind CSS v4 样式扫描机制。
- MFE type contracts, backend remote entry resolution (DB + REST + cache + client), and test scaffold for four MFE loading requirements
- Plan:
- Date:
- Zustand host state sharing, whitelist-restricted DI Proxy, and reference-counted EventBus-Socket.IO network bridge.
- 执行时间:

---

## v1.0 插件系统重构 (Shipped: 2026-06-19)

**Phases completed:** 9 phases, 34 plans | **Tests:** 358 passed, 41 test files | **Commits:** 206

**Key accomplishments:**

1. **Token DI 内核** (Phase 1) — Token<T> 泛型类 + ServiceRegistry 依赖注入容器 + 拓扑排序循环检测
2. **7 个 IService Token 化** (Phase 2) — CommandBus、EventBus、ActionRegistry 等核心子系统封装为 IService 接口，注册到 DI 容器
3. **跨运行时 ESM 动态加载** (Phase 3) — Node.js data: URL + 浏览器 Blob URL 双重加载策略，ZIP 多文件插件包格式 + manifest.json zod 校验
4. **PluginHost 完整生命周期** (Phase 4) — install/activate/deactivate/uninstall 标准流程，ResourceTracker 自动资源追踪清理，5s 超时保护
5. **Worker Thread 隔离 + ServiceProxy RPC** (Phase 5) — Worker 沙箱 + Proxy-based IPC 服务代理 + CapabilityGuard 跨边界权限检查 + Event 转发
6. **EventBus 服务 + SemVer 兼容** (Phase 6) — 全局 IEventBusService + Token 语义化版本兼容检查 + Token Registry
7. **热重载 + 中间件管道** (Phase 7) — chokidar 文件监听 + 原子替换策略（新版本成功才停用旧版本）+ 洋葱模型生命周期中间件
8. **6 个内置 + 2 个第三方插件迁移** (Phase 8) — 全部迁移到 ESM + Token DI 格式，删除旧 plugin-runtime（666 行 VM 沙箱代码）
9. **前端 PluginHost + Extension Points + WebWorker** (Phase 9) — 浏览器端 ServiceRegistry + Zustand state + React Context + ExtensionPointRegistry + BrowserWorkerTransport + ServiceHost RPC + 新旧系统过渡

**Tech stack:** TypeScript 5.8, React 19, Vite 6, Express 4, SQLite (better-sqlite3), vitest 4, Socket.IO 4
**Deferred items at close:** 0 (all artifacts clear)

---

## v2.0 微前端架构改造 (Shipped: 2026-06-20)

**Phases completed:** 4 phases, 8 plans | **Tests:** 60 passed, 6 test files | **Commits:** 22

**Key accomplishments:**

1. **工程配置与工程集成** (Phase 10) — 建立 Vite 6 + Module Federation 2.0 构建编译与按需加载体系，实现 React/Zustand 强单例共享配置，并为 Tailwind v4 配置样式编译扫描。
2. **动态加载器与宿主桥接** (Phase 11) — 编写 React 异步加载组件 `MfeLoader`，集成 React Error Boundary 提供优雅下线与故障容灾降级占位；在子应用 App 中定义标准 `createMfeApp` 周期钩子契约。
3. **状态共享与 DI 桥接** (Phase 12) — 实现 `MfeContext` 并结合 whitelisted `MfeServiceRegistryProxy` 对子应用共享指定 DI 服务（限制直接网络操作与安全威胁）；设计引用计数 `SocketBridge` 实现本地事件高频穿透。
4. **业务模块解耦与样式沙箱** (Phase 13) — 从单体 App 中物理拆分“白板”与“课件”到独立 subprojects (`packages/mfe-whiteboard` 和 `packages/mfe-courseware`)；通过 Tailwind v4 `:wb` / `:cw` 前缀与禁用 Preflight 以及自定义 CSS Modules 实现完美的样式沙箱隔离。

**Tech stack:** Vite Module Federation 2.0, Tailwind CSS v4, Zustand 5, SQLite
**Deferred items at close:** 0 (all artifacts clear)
