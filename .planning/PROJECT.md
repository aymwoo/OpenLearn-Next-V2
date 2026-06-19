# OpenLearnV2 — 插件系统重构

## What This Is

OpenLearnV2 是一个教育操作系统（Educational OS / LMS）平台，采用插件驱动的命令-事件总线架构。本项目对其进行插件系统重构，从当前基于 Node.js `vm` 模块的沙箱执行方案，迁移到基于 Blob URL + `import()` 的动态 ESM 模块导入方案，参考 JupyterLab 插件系统架构设计。

目标用户：教育科技开发者，能够为平台编写和分发 TypeScript/JavaScript 插件来扩展教学功能。

## Core Value

**一个类型安全、跨运行时（浏览器/Node.js）、支持依赖注入和热重载的插件执行环境**，使第三方开发者能像写 ESM 模块一样自然地为平台编写插件。

## Requirements

### Validated

<!-- 从现有代码推断，已经验证工作的能力 -->

- ✓ 课程管理（lesson.create, lesson.update, lesson.delete）— 现有
- ✓ 交互白板（whiteboard.draw, whiteboard.update, whiteboard.delete, whiteboard.clear）— 现有
- ✓ 班级与学生管理（class.create, student.create, class.add_student）— 现有
- ✓ 虚拟文件系统（vfs.write_file, vfs.read_file, vfs.list_dir, vfs.mkdir）— 现有
- ✓ 进程管理（process.spawn, process.kill, process.list, process.logs）— 现有
- ✓ 作业与批改（assignment.create, assignment.submit, assignment.grade）— 现有
- ✓ 排课与考勤（schedule.create, attendance.record）— 现有
- ✓ AI Agent 工具调用（Gemini/OpenAI 兼容 API）— 现有
- ✓ 课件上传与分发（courseware.upload, HTML/ZIP 包）— 现有
- ✓ 插件安装/卸载/启停（plugin.install, plugin.uninstall, plugin.toggle）— 现有
- ✓ 高危操作审批队列（pending_commands, approve/reject）— 现有
- ✓ 实时通信（Socket.IO 事件广播）— 现有
- ✓ 中英文国际化（i18n.ts）— 现有
- ✓ 学期成绩报告与分析图表— 现有
- ✓ **PLUG-04**：Token 依赖注入系统（Token<T> 泛型类 + ServiceRegistry DI 容器 + tsc-strict 类型检查）— 验证于 Phase 01: token-di

### Active

<!-- Phase 9 要构建的需求 -->

- [ ] **PLUG-13**：前端 PluginHost — 浏览器端 ServiceRegistry + WebWorker 管理 + 前端 Extension Points 渲染

### Validated by Phase

<!-- 已通过阶段验证的 PLUG 需求 -->

- ✓ **PLUG-01**：ESM 动态加载（data: URL / Blob URL）— Phase 3
- ✓ **PLUG-02**：多文件 ZIP 插件包格式 + manifest.json — Phase 3
- ✓ **PLUG-03**：双运行时 Worker 隔离（Node.js Worker Thread / 浏览器 Web Worker stub）— Phase 5
- ✓ **PLUG-04**：Token<T> 泛型类 + ServiceRegistry DI 容器 — Phase 1
- ✓ **PLUG-05**：activate(ctx) / deactivate() 标准生命周期接口 — Phase 4
- ✓ **PLUG-06**：扩展点 Token 化注册模式 — Phase 2
- ✓ **PLUG-07**：全局事件总线服务 IEventBusService — Phase 6
- ✓ **PLUG-08**：Kernel 生命周期中间件管道（洋葱模型）— Phase 7
- ✓ **PLUG-09**：Token SemVer 版本兼容检查 — Phase 6
- ✓ **PLUG-10**：插件热重载（chokidar + 原子替换策略）— Phase 7
- ✓ **PLUG-11**：保留现有所有内置能力作为 Token 化 Service — Phase 2
- ✓ **PLUG-12**：现有 6 个内置 + 2 个第三方插件以新格式重写，plugin-runtime 已删除 — Phase 8

### Out of Scope

- 插件市场/商店（Plugin Marketplace）— 后续阶段
- 插件沙箱之外的系统安全审计 — 后续阶段
- 前端 App.tsx 拆分为微前端架构 — 独立阶段
- 数据库迁移系统正规化 — 独立阶段
- 现有 REST API 的 GraphQL/TRPC 改造 — 独立阶段

## Context

**技术环境：**
- 当前运行时：Node.js + Express + SQLite（better-sqlite3），前端 React 19 + Vite 6
- 当前插件系统：PluginHost（esm-loader + Token DI + Worker Thread 隔离），插件存储于 SQLite `plugins` 表 + `dist/plugins/*.zip`
- 当前插件 API：Token DI（7 个 IService Token）+ ServiceProxy RPC（跨 Worker 边界）
- 已删除：`packages/core/plugin-runtime/index.ts`（旧 vm.createContext 沙箱）— Phase 8
- 现有能力守卫：`CapabilityGuard` 基于字符串能力控制（如 `lesson:write`）
- Node.js 20+ 已支持 `import()` 动态导入、`Worker Threads`、`Blob`

**设计参考：**
- JupyterLab Plugin System：Token-based DI、`JupyterFrontEndPlugin<T>` 泛型接口、`requires`/`optional` 声明数组、`autoStart` 控制
- VSCode Extension API：`activate`/`deactivate` 生命周期、`ExtensionContext` 传递能力

**已知问题：**
- ~~`vm` 模块原型链逃逸风险~~ → 已解决：Worker Thread 隔离 + ServiceProxy RPC（Phase 5）
- ~~`plugin-runtime/index.ts` 安全包装代码~~ → 已删除：PluginHost 替代（Phase 4 + Phase 8）
- ~~无热重载~~ → 已解决：chokidar + 原子替换策略（Phase 7）
- 浏览器端 Web Worker 支持为 stub → Phase 9 完整实现

## Constraints

- **兼容性**：现有 REST API 和前端 UI 尽量不改动，插件系统重构对上层透明 — 降低变更风险，聚焦核心目标
- **运行时**：必须同时支持 Node.js（>=20）和现代浏览器 — 用户明确要求双运行时
- **安全性**：Worker Thread 隔离替代 vm 沙箱 — 不能降低现有安全水平
- **类型安全**：新系统应充分利用 TypeScript 泛型和 Token 类型推导 — 提升插件开发体验
- **数据库**：继续使用现有 SQLite 存储插件元数据和持久化数据 — 不引入新数据库
- **渐进式**：支持新旧插件系统并行运行过渡期 — 允许逐步迁移

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 使用 Blob URL + `import()` 替代 `vm` 模块 | 跨运行时兼容（浏览器/Node.js），原生 ESM 互引用 | ✓ Delivered — Phase 3 (ESM loader), Phase 4 (PluginHost) |
| Token DI 而非手动 ctx 注入 | JupyterLab 验证过的成熟模式，类型安全，可测试 | ✓ Delivered — Phase 1 (Token/Registry), Phase 2 (7 IService Tokens) |
| Worker Thread 隔离 | 补偿 `import()` 无沙箱的安全损失 | ✓ Delivered — Phase 5 (Worker lifecycle + ServiceProxy RPC) |
| 多文件插件包 | 支持复杂插件（含资源文件、多模块、类型定义） | ✓ Delivered — Phase 3 (ZIP + manifest.json), Phase 8 (build-plugins.mjs) |
| 全局 IEventBusService 统一事件 | 精简扩展点，降低插件开发学习曲线 | ✓ Delivered — Phase 6 |
| 语义化版本兼容 | 防止插件与基座版本不匹配导致的隐蔽 bug | ✓ Delivered — Phase 6 (SemVer check + Token Registry) |
| 热重载 | 改善插件开发体验，减少迭代周期 | ✓ Delivered — Phase 7 (chokidar + atomic replace) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-19 after Phase 8 (migration) completion*

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLUG-01 | Phase 3 — ESM 加载 + 包格式 | ✓ Validated |
| PLUG-02 | Phase 3 — ESM 加载 + 包格式 | ✓ Validated |
| PLUG-03 | Phase 5 — Worker 隔离 + 双运行时 | ✓ Validated |
| PLUG-04 | Phase 1 — Token DI 内核 | ✓ Validated |
| PLUG-05 | Phase 4 — PluginHost + 生命周期 | ✓ Validated |
| PLUG-06 | Phase 2 — 现有能力 Token 化 | ✓ Validated |
| PLUG-07 | Phase 6 — EventBus 服务 + SemVer 兼容 | ✓ Validated |
| PLUG-08 | Phase 7 — 热重载 + 中间件管道 | ✓ Validated |
| PLUG-09 | Phase 6 — EventBus 服务 + SemVer 兼容 | ✓ Validated |
| PLUG-10 | Phase 7 — 热重载 + 中间件管道 | ✓ Validated |
| PLUG-11 | Phase 2 — 现有能力 Token 化 | ✓ Validated |
| PLUG-12 | Phase 8 — 现有插件迁移 | ✓ Validated |
| PLUG-13 | Phase 9 — 前端集成 + 过渡期 | Active |

---
*Last updated: 2026-06-18 after Phase 01 (token-di) completion*
