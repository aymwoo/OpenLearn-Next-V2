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

### Active

<!-- 当前阶段要构建的需求 -->

- [ ] **PLUG-01**：插件加载机制从 `vm.createContext` + `vm.Script.runInContext` 迁移到 `Blob` → `URL.createObjectURL()` → `import(url)` 动态 ESM 导入
- [ ] **PLUG-02**：支持多文件插件包格式（ZIP/目录），包含 `manifest.json` + 入口文件 + 可选依赖
- [ ] **PLUG-03**：双运行时支持——Node.js 端通过 Worker Thread 隔离执行插件，浏览器端通过 Web Worker 隔离执行插件
- [ ] **PLUG-04**：Token 依赖注入系统——插件通过 `requires`/`optional` 声明对其他服务的依赖，基座在激活时解析并注入
- [ ] **PLUG-05**：生命周期钩子——每个插件实现 `activate(ctx)` 和 `deactivate()` 标准接口
- [ ] **PLUG-06**：扩展点注册模式——将现有 `classroomTools`、`actionRegistry`、`commandBus` 等能力统一抽象为 Token 标识的 Service，插件通过 Token 获取服务实例
- [ ] **PLUG-07**：全局事件总线服务 `IEventBusService`——插件通过此服务订阅/发布事件，无需单独注册扩展点
- [ ] **PLUG-08**：Kernel 生命周期中间件管道——支持插件注册拦截器/中间件，在命令执行、事件发布等关键节点插入自定义逻辑
- [ ] **PLUG-09**：Token 语义化版本兼容——插件声明依赖 Token 的版本范围（如 `ICommandBusService@^1.0`），基座在激活时检查版本兼容性
- [ ] **PLUG-10**：插件热重载——开发模式下修改插件源码后自动重新加载和激活
- [ ] **PLUG-11**：保留现有所有内置能力（action 注册、command handler、event 订阅、process handler、storage KV 持久化、AI 文本生成）作为 Token 化的 Service
- [ ] **PLUG-12**：现有内置插件（Quiz Component Plugin、Random Student Picker）以新插件格式重写

### Out of Scope

- 插件市场/商店（Plugin Marketplace）— 后续阶段
- 插件沙箱之外的系统安全审计 — 后续阶段
- 前端 App.tsx 拆分为微前端架构 — 独立阶段
- 数据库迁移系统正规化 — 独立阶段
- 现有 REST API 的 GraphQL/TRPC 改造 — 独立阶段

## Context

**技术环境：**
- 当前运行时：Node.js + Express + SQLite（better-sqlite3），前端 React 19 + Vite 6
- 当前插件系统：`packages/core/plugin-runtime/index.ts`，使用 `vm.createContext` + `vm.Script.runInContext`，单一 JS 字符串存在 SQLite `plugins` 表中
- 现有插件 API 包装器：`wrappedCommandBus`、`wrappedEventBus`、`wrappedActionRegistry`、`wrappedProcessManager`、`wrappedStorage`、`wrappedAI`——均需重构为 Token 化 Service
- 现有能力守卫：`CapabilityGuard` 基于字符串能力控制（如 `lesson:write`）
- Node.js 20+ 已支持 `import()` 动态导入、`Worker Threads`、`Blob`

**设计参考：**
- JupyterLab Plugin System：Token-based DI、`JupyterFrontEndPlugin<T>` 泛型接口、`requires`/`optional` 声明数组、`autoStart` 控制
- VSCode Extension API：`activate`/`deactivate` 生命周期、`ExtensionContext` 传递能力

**已知问题：**
- 当前 `vm` 模块在 Node.js 文档中被标记为"仅用于可信代码"，且存在原型链逃逸风险
- `plugin-runtime/index.ts` 已有大量安全包装代码（冻结原型链、超时保护、构造函数阻断），这些逻辑分散且难以维护
- 无插件开发时的热重载能力，修改插件需手动重新安装

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
| 使用 Blob URL + `import()` 替代 `vm` 模块 | 跨运行时兼容（浏览器/Node.js），原生 ESM 互引用 | — Pending |
| Token DI 而非手动 ctx 注入 | JupyterLab 验证过的成熟模式，类型安全，可测试 | — Pending |
| Worker Thread 隔离 | 补偿 `import()` 无沙箱的安全损失 | — Pending |
| 多文件插件包 | 支持复杂插件（含资源文件、多模块、类型定义） | — Pending |
| 全局 IEventBusService 统一事件 | 精简扩展点，降低插件开发学习曲线 | — Pending |
| 语义化版本兼容 | 防止插件与基座版本不匹配导致的隐蔽 bug | — Pending |
| 热重载 | 改善插件开发体验，减少迭代周期 | — Pending |

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
*Last updated: 2026-06-17 after initialization*

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLUG-01 | Phase 3 — ESM 加载 + 包格式 | Pending |
| PLUG-02 | Phase 3 — ESM 加载 + 包格式 | Pending |
| PLUG-03 | Phase 5 — Worker 隔离 + 双运行时 | Pending |
| PLUG-04 | Phase 1 — Token DI 内核 | Pending |
| PLUG-05 | Phase 4 — PluginHost + 生命周期 | Pending |
| PLUG-06 | Phase 2 — 现有能力 Token 化 | Pending |
| PLUG-07 | Phase 6 — EventBus 服务 + SemVer 兼容 | Pending |
| PLUG-08 | Phase 7 — 热重载 + 中间件管道 | Pending |
| PLUG-09 | Phase 6 — EventBus 服务 + SemVer 兼容 | Pending |
| PLUG-10 | Phase 7 — 热重载 + 中间件管道 | Pending |
| PLUG-11 | Phase 2 — 现有能力 Token 化 | Pending |
| PLUG-12 | Phase 8 — 现有插件迁移 | Pending |

---
*Last updated: 2026-06-17 after roadmap creation*
