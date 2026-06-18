# Roadmap: OpenLearnV2 插件系统重构

## Overview

将现有基于 `vm.createContext` 的插件执行方案重构为 JupyterLab 风格的 Token DI 架构，使用 ESM 动态导入（`import()`）替代 `vm` 模块，Worker Thread 实现进程级隔离，并确保同一套插件 API 在 Node.js 服务端和浏览器前端均可运行。分 9 个阶段递进交付：从 DI 内核奠基开始，经由 ESM 加载和 Worker 隔离实现架构核心转折，最终完成现有插件迁移和前端集成。

## Phases

- [x] **Phase 1: Token DI 内核** — Token 类实现 + ServiceRegistry 依赖注入容器 (completed 2026-06-18)
- [x] **Phase 2: 现有能力 Token 化** — IService 接口定义 + 现有子系统实现 Token 化接口并注册 (completed 2026-06-18)
- [x] **Phase 3: ESM 加载 + 包格式** — data:URL/Blob URL 双运行时加载策略 + ZIP 多文件插件包支持 (completed 2026-06-18)
- [x] **Phase 4: PluginHost + 生命周期** — 插件生命周期管理器 + activate/deactivate 标准接口 (completed 2026-06-18)
- [x] **Phase 5: Worker 隔离 + 双运行时** — Worker Thread/Web Worker 沙箱 + RPC 服务代理 + 内联/Worker 双模式 (completed 2026-06-18)
- [ ] **Phase 6: EventBus 服务 + SemVer 兼容** — 全局 IEventBusService 统一事件 + Token 语义化版本兼容检查
- [ ] **Phase 7: 热重载 + 中间件管道** — 开发模式插件热重载 + 生命周期中间件管道
- [ ] **Phase 8: 现有插件迁移** — 内置插件（Quiz、Rollcall 等）以新插件格式重写
- [ ] **Phase 9: 前端集成 + 过渡期** — 前端 PluginHost + WebWorker + Extension Points + 新旧系统并行过渡

## Phase Details

### Phase 1: Token DI 内核
**Goal**: 建立类型安全的依赖注入基础设施——Token 类定义和 ServiceRegistry 注册/解析/注销容器，不涉及任何插件执行方式变更
**Depends on**: Nothing (第一阶段的基石)
**Requirements**: PLUG-04
**Success Criteria** (what must be TRUE):
  1. Token 类可以通过 `new Token<IService>('@openlearn/core:IService')` 创建类型安全的服务标识符，泛型参数携带完整的服务接口类型信息
  2. ServiceRegistry 可以通过 `register(token, instance)` 注册服务实例，通过 `resolve(token)` 解析已注册的服务实例
  3. ServiceRegistry 在解析具有 `requires` 依赖的服务时，按拓扑排序自动解析并注入所有直接和间接依赖
  4. ServiceRegistry 在检测到循环依赖时抛出明确的错误信息（包含参与循环的 Token 列表），而非栈溢出或静默挂起
  5. ServiceRegistry 支持 `unregister(token)` 注销服务，注销后 `resolve(token)` 抛出 "No provider" 错误
**Plans**: 4 plans
  - [x] 01-01-PLAN.md -- 安装 vitest + Token 类实现 + 错误类 + Token 单元测试
  - [x] 01-02-PLAN.md -- ServiceRegistry 容器（register/resolve/unregister + 拓扑排序 + 循环检测）+ 完整单元测试
  - [x] 01-03-PLAN.md -- Kernel 集成 ServiceRegistry + barrel 导出 + tsc-strict CI 配置
  - [x] 01-04-PLAN.md -- 修复 tsc-strict plugin name 配置不匹配（关闭 VERIFICATION G-001 差距）
**UI hint**: no

### Phase 2: 现有能力 Token 化
**Goal**: 将现有 6 个核心子系统（CommandBus、EventBus、ActionRegistry、Storage、AI、CapabilityGuard/ProcessManager）封装为 Token 标识的 IService，现有子系统实现对应接口并注册到 ServiceRegistry，保持现有代码通过 `kernelContainer.xxx` 直接访问的方式不变
**Depends on**: Phase 1
**Requirements**: PLUG-06, PLUG-11
**Success Criteria** (what must be TRUE):
  1. 每个核心子系统有对应的 IService 接口定义（如 `ICommandBusService`），接口方法签名明确标注为 async（为 Worker 隔离做准备），参数类型不使用 `any`
  2. 每个 IService 接口有对应的 Token 实例导出（如 `ICommandBusServiceToken`），Token 命名遵循 `@openlearn/core:IServiceName` 规范
  3. 现有子系统（CommandBus、EventBus 等）实现对应的 IService 接口，并在 Kernel 启动时注册到 ServiceRegistry
  4. 现有代码通过 `kernelContainer.commandBus` 直接访问子系统的方式继续可用，新的插件代码通过 `serviceRegistry.resolve(token)` 访问服务
  5. Storage 和 AI 服务从现有 `plugin-runtime/index.ts` 中提取为独立的 IService 实现（`IStorageService`、`IAIService`），不再嵌入在 PluginRuntime 内部
**Plans**: 3 plans
  - [x] 02-01-PLAN.md -- IService 接口 + Token 实例 + StorageService/AIService 类定义 + barrel 导出
  - [x] 02-02-PLAN.md -- Kernel 注册 7 个 IService + PluginRuntime wrappedAI 引用切换
  - [x] 02-03-PLAN.md -- vitest 测试（Token 命名格式 + Kernel 注册流程 + StorageService/AIService 单元测试）
**UI hint**: no

### Phase 3: ESM 加载 + 包格式
**Goal**: 实现跨运行时（Node.js data: URL / 浏览器 Blob URL）的动态 ESM 模块加载器，以及支持 manifest.json + 多文件的 ZIP 插件包格式，替代 `vm.createContext` 作为新的代码加载机制
**Depends on**: Phase 2
**Requirements**: PLUG-01, PLUG-02
**Success Criteria** (what must be TRUE):
  1. 在 Node.js 端，可以将一段 JavaScript/TypeScript 字符串通过 data: URL + `import()` 作为 ESM 模块动态加载并执行
  2. 在浏览器端，可以将一段 JavaScript 字符串通过 Blob URL + `import()` 作为 ESM 模块动态加载并执行
  3. ZIP 插件包（包含 `manifest.json` + 入口 `.js` 文件 + 可选资源文件）可以被解压、校验，并提取出插件入口代码字符串供 ESM 加载器使用
  4. `manifest.json` 的结构定义（id、name、version、requires、optional、capabilitiesProposed）通过 zod schema 在加载时进行运行时校验，无效 manifest 在加载阶段即被拒绝
  5. 多文件插件（含 `import './utils.js'` 等相对导入）可以被预打包为单文件，在 Node.js data: URL 环境下正确加载执行
**Plans**: 4 plans
  - [x] 03-01-PLAN.md -- EsmLoader 抽象基类 + PluginModule 接口 + 结构化错误类层次 + manifest-schema zod 校验 + 单元测试
  - [x] 03-02-PLAN.md -- NodeEsmLoader (data: URL) + BrowserEsmLoader (Blob URL) 平台实现 + 测试 fixtures + 完整单元测试
  - [x] 03-03-PLAN.md -- EsmLoader barrel 导出 + 全量 vitest 测试验证
  - [x] 03-04-PLAN.md -- esbuild 打包 + ZIP 解压 + DB schema 扩展 + PluginRuntime ESM 分支 + Kernel DI 注入 + 集成测试
**UI hint**: no

### Phase 4: PluginHost + 生命周期
**Goal**: 建立插件生命周期管理器 PluginHost，替代现有 `plugin-runtime/index.ts`。实现 `activate(ctx)` / `deactivate()` 标准接口契约，支持插件的安装、激活、停用、卸载完整生命周期，仅在内联模式（主线程直接 import）下运行
**Depends on**: Phase 3
**Requirements**: PLUG-05
**Success Criteria** (what must be TRUE):
  1. 插件通过实现 `activate(ctx: PluginContext)` 函数接收注入的服务（通过 Token DI 解析 `requires`/`optional`），在激活时注册命令处理器和事件订阅
  2. 插件通过实现 `deactivate()` 函数清理资源（注销命令、取消事件订阅、释放定时器），deactivate 超时 5 秒后强制终止
  3. 单个插件 activate 失败（抛异常或超时）不影响其他已激活插件和基座运行，错误被捕获并记录详细错误链
  4. PluginHost 支持通过 `installPlugin(manifest, sourceCode)` 安装、`activatePlugin(pluginId)` 激活、`deactivatePlugin(pluginId)` 停用、`uninstallPlugin(pluginId)` 卸载的完整生命周期
  5. 插件停用时，所有在 activate 中创建的资源（命令处理器、事件订阅、定时器）被自动追踪并清理，不会残留
**Plans**: 4 plans
  - [x] 04-01-PLAN.md -- 基础类型层：types.ts（Disposable、PluginState、PluginContext、PluginInfo）+ errors.ts（4 个错误类）+ resource-tracker.ts + 单元测试
  - [x] 04-02-PLAN.md -- ContextBuilder（从 PluginRuntime 迁移 wrapped* 安全包装器）+ PluginHost 类骨架（构造函数、状态机、内省方法）+ 单元测试
  - [x] 04-03-PLAN.md -- PluginHost 完整生命周期方法（installPlugin/activatePlugin/deactivatePlugin/uninstallPlugin/installPluginFromZip/restoreActivePlugins）+ 完整集成测试
  - [x] 04-04-PLAN.md -- PluginRuntime facade 层 + Kernel 集成 PluginHost + 状态机单元测试 + 最终验证
**UI hint**: no

### Phase 5: Worker 隔离 + 双运行时
**Goal**: 实现 Worker Thread（Node.js）/ Web Worker（浏览器）隔离执行模式，通过 Proxy-based IPC 服务代理层让 Worker 中的插件安全访问主线程的 Token 化服务，支持内联模式（内置信任插件）和 Worker 隔离模式（第三方插件）双模式切换
**Depends on**: Phase 4
**Requirements**: PLUG-03
**Success Criteria** (what must be TRUE):
  1. 第三方插件在独立 Worker Thread（Node.js）中执行（浏览器 Web Worker 为 stub，Phase 9 完整实现），Worker 崩溃不影响主线程和其他插件
  2. Worker 中的插件通过 `ctx.services.commandBus.execute(cmd)` 调用主线程服务时，调用被透明代理（基于 token + method + args 通用 invoke 协议），调用方感知不到跨边界差异
  3. 事件订阅在 Worker 隔离模式下自动转换为消息转发——Worker 中的 `eventBus.subscribe('lesson.created', handler)` 在主线程触发事件时正确通知到 Worker 中的 handler
  4. 所有跨 Worker 边界的 RPC 调用在主线程端通过 CapabilityGuard 进行能力检查，Worker 无法越过 manifest 声明的能力范围
  5. Worker 生命周期与插件生命周期绑定：插件 activate 时创建 Worker，deactivate 时 terminate Worker；Worker 资源泄漏被全局 Worker Registry 追踪和预防
**Plans**: 4 plans
  - [x] 05-01-PLAN.md -- Transport foundation: message protocol types, error hierarchy, NodeWorkerTransport + BrowserWorkerTransport stub
  - [x] 05-02-PLAN.md -- ServiceProxy RPC layer + CapGuard: Worker-side Proxy, main-thread ServiceHost with capability enforcement
  - [x] 05-03-PLAN.md -- Worker lifecycle + PluginHost dual-mode + Kernel/DB: WorkerManager, inline/worker mode, execution_mode column
  - [x] 05-04-PLAN.md -- Event forwarding + integration tests: EventForwarder, EventBusProxy, full test suite
**UI hint**: no

### Phase 6: EventBus 服务 + SemVer 兼容
**Goal**: 实现全局事件总线服务 IEventBusService（统一异步事件 API）和 Token 语义化版本兼容系统（插件声明 `ICommandBusService@^1.0`，基座在激活时检查版本兼容性）
**Depends on**: Phase 5
**Requirements**: PLUG-07, PLUG-09
**Success Criteria** (what must be TRUE):
  1. 插件通过 `ctx.services.eventBus` 统一 API 发布/订阅事件，无需单独注册扩展点即可参与事件系统
  2. 插件在 `manifest.json` 的 `requires` 中可以声明 Token 的语义化版本范围（如 `@openlearn/core:ICommandBusService@^1.0`），基座在激活时检查已注册 Token 的版本是否满足范围
  3. 版本不兼容时（如插件要求 `^2.0` 但基座提供 `1.5.0`），激活被明确拒绝并报告具体的版本不匹配信息，而非静默失败或运行时异常
  4. Token 版本匹配通过 Token Registry 模式实现——插件通过字符串 key 查询 Token 而非直接 import Token 对象，避免不同 bundle 的 Token 对象引用不同（`===` 比较失败）导致的"幻影"不匹配
  5. 安装插件时即检查 Token 版本兼容性，不兼容则在安装阶段拒绝，避免"安装成功但无法激活"的用户困惑
**Plans**: 4 plans
  - [ ] 06-01-PLAN.md -- (要规划)
  - [ ] 06-02-PLAN.md -- (要规划)
  - [ ] 06-03-PLAN.md -- (要规划)
  - [ ] 06-04-PLAN.md -- (要规划)
**UI hint**: no

### Phase 7: 热重载 + 中间件管道
**Goal**: 实现开发模式下插件源码变更后的自动热重载（dispose + re-activate），以及生命周期中间件管道（在 activate/deactivate 等关键节点插入拦截逻辑）
**Depends on**: Phase 6
**Requirements**: PLUG-08, PLUG-10
**Success Criteria** (what must be TRUE):
  1. 开发模式下，修改 `plugins/` 目录中插件的源码文件（.ts/.js）后，插件自动 deactivate 旧版本并 activate 新版本，无需手动重启服务
  2. 热重载采用原子策略——新版本 activate 成功后才停用旧版本；若新版本 activate 失败，保留旧版本运行并向开发者报告失败原因
  3. 热重载时旧插件的副作用（setInterval、事件监听器、打开的资源）被 `dispose` 钩子上报的副作用追踪器自动清理，连续热重载 10 次无内存/CPU 增长
  4. 中间件可以在插件生命周期的关键节点（激活前/后、停用前/后、命令执行前/后）注册拦截函数，实现审计、日志、限流等横切关注点
  5. 中间件管道采用洋葱模型——多个中间件按注册顺序依次执行，每个中间件可以决定是否调用下一个或提前终止
**Plans**: 4 plans
  - [ ] 07-01-PLAN.md -- (要规划)
  - [ ] 07-02-PLAN.md -- (要规划)
  - [ ] 07-03-PLAN.md -- (要规划)
  - [ ] 07-04-PLAN.md -- (要规划)
**UI hint**: no

### Phase 8: 现有插件迁移
**Goal**: 将现有内置插件（builtin.ts、management.ts、vfs.ts、process.ts、ai-planner.ts、ai-submit-injector.ts）和第三方插件（Quiz Component Plugin、Random Student Picker）以新插件格式重写，使用 Token DI 获取服务
**Depends on**: Phase 6
**Requirements**: PLUG-12
**Success Criteria** (what must be TRUE):
  1. 所有现有内置插件（Lesson CRUD、Whiteboard、VFS、Process 等 6 个文件）以新格式重写，使用 `manifest.json` + `activate(ctx)` / `deactivate()` 标准接口
  2. 现有第三方插件（Quiz Component Plugin、Random Student Picker）以新 ZIP 包格式重写，通过 ESM 加载
  3. 所有现有功能（课程管理、白板、文件系统、进程管理、考勤、作业批改等）在新插件系统中行为与旧系统完全一致
  4. 旧插件格式的代码（`packages/plugins/*.ts` 中直接 import kernelContainer 的 bootstrap 模式）通过适配器代理转换为新接口，不再直接耦合 Kernel 单例
  5. 插件迁移后，旧的 `plugin-runtime/index.ts`（vm 相关代码）可以被完全移除，无遗留依赖
**Plans**: 4 plans
  - [ ] 08-01-PLAN.md -- (要规划)
  - [ ] 08-02-PLAN.md -- (要规划)
  - [ ] 08-03-PLAN.md -- (要规划)
  - [ ] 08-04-PLAN.md -- (要规划)
**UI hint**: no

### Phase 9: 前端集成 + 过渡期
**Goal**: 实现前端 PluginHost（浏览器端 ServiceRegistry + WebWorker 管理）+ 前端 Extension Points（classroomTools、tabs、views 等）+ 新旧插件系统并行运行的过渡期兼容策略
**Depends on**: Phase 8
**Requirements**: 前端扩展点集成（PLUG-06 前端部分）
**Success Criteria** (what must be TRUE):
  1. 前端 App.tsx 通过前端 PluginHost 获取插件注册的 classroomTools、teacherTabs、studentViews 等扩展点，插件在前端注册的 UI 组件可以正常渲染和交互
  2. 前端插件可以在浏览器 Web Worker 中执行，通过 IPC 代理访问前端服务（API 调用、Socket.IO 事件等）
  3. 新旧插件系统过渡期间，同一命令类型不会被执行两次——命令路由器优先使用 modern handler，仅在无 modern handler 时回退到 legacy handler
  4. 开发者在插件中心 UI 上传新格式（ZIP + manifest.json）的插件包后，插件被安装到新系统，旧格式（单一 JS 字符串）插件保持可用但标记为 legacy
  5. 旧格式插件的用户收到迁移提示（UI 中显示黄色标记），安装新格式版本后可安全卸载旧格式版本
**Plans**: 4 plans
  - [ ] 09-01-PLAN.md -- (要规划)
  - [ ] 09-02-PLAN.md -- (要规划)
  - [ ] 09-03-PLAN.md -- (要规划)
  - [ ] 09-04-PLAN.md -- (要规划)
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Token DI 内核 | 4/4 | Complete    | 2026-06-18 |
| 2. 现有能力 Token 化 | 3/3 | Complete    | 2026-06-18 |
| 3. ESM 加载 + 包格式 | 4/4 | Complete    | 2026-06-18 |
| 4. PluginHost + 生命周期 | 4/4 | Complete    | 2026-06-18 |
| 5. Worker 隔离 + 双运行时 | 4/4 | Complete    | 2026-06-18 |
| 6. EventBus 服务 + SemVer 兼容 | 0/0 | Not started | - |
| 7. 热重载 + 中间件管道 | 0/0 | Not started | - |
| 8. 现有插件迁移 | 0/0 | Not started | - |
| 9. 前端集成 + 过渡期 | 0/0 | Not started | - |
