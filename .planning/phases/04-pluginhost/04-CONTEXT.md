# Phase 4: PluginHost + 生命周期 - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Source:** Auto discuss (--auto)

<domain>
## Phase Boundary

建立插件生命周期管理器 PluginHost，替代现有 `plugin-runtime/index.ts`。实现 `activate(ctx)` / `deactivate()` 标准接口契约，支持插件的安装、激活、停用、卸载完整生命周期。仅在内联模式（主线程直接 import）下运行——Worker 隔离推迟到 Phase 5。

**In scope:**
- PluginHost 类：替代 PluginRuntime 的插件生命周期管理（install / activate / deactivate / uninstall）
- PluginContext 接口：通过 Token DI 注入服务（commandBus, eventBus, actionRegistry, storage, ai, processManager）
- 资源追踪器（ResourceTracker）：自动追踪 activate 中创建的命令处理器、事件订阅、定时器
- deactivate 超时保护（5 秒）+ 强制清理
- 插件间隔离：单个插件 activate 失败不影响其他插件和基座
- 现有 PluginRuntime.evaluateAndActivate() 的 wrapped* 安全包装器逻辑迁移到 PluginHost
- PluginRuntime 保留为薄包装层（兼容现有代码），委托给 PluginHost

**Out of scope:**
- Worker Thread / Web Worker 隔离（Phase 5）
- 热重载（Phase 7）
- 现有 vm.createContext 代码移除（Phase 8）
- SemVer 版本兼容检查（Phase 6）
</domain>

<decisions>
## Implementation Decisions

### PluginHost 架构（D-01 ~ D-03）
- **D-01: 新建 PluginHost 类 + PluginRuntime 委托** — 新建 `packages/core/plugin-host/` 目录。PluginHost 是独立的生命周期管理器类（可单独测试），PluginRuntime 改为薄包装层：保留现有 API 签名，内部委托给 PluginHost。好处：不影响 server.ts 和现有调用方，PluginHost 可独立演进
- **D-02: PluginHost 构造函数接收 ServiceRegistry + EsmLoader** — `constructor(serviceRegistry: ServiceRegistry, esmLoader: EsmLoader, db: Database)`。通过 ServiceRegistry.resolve() 获取各服务实例构建 PluginContext，不直接依赖 Kernel 单例。与 Phase 3 D-01 的 DI 模式一致
- **D-03: PluginHost 管理插件状态机** — 每个插件经历 `installed → active → inactive → uninstalled` 状态流转。状态存储在内存 Map<pluginId, PluginState> 中。状态转换通过 PluginHost 方法触发，非法转换（如重复激活）抛出明确错误

### PluginContext 接口（D-04 ~ D-06）
- **D-04: PluginContext 通过 Token DI 注入服务** — `ctx.services.commandBus.execute(cmd)` 而不是 `ctx.commandBus.execute(cmd)`。services 对象包含已解析的 IService 实现，类型安全。与 Phase 2 的 IService 接口和 Phase 1 的 Token 命名规范一致
- **D-05: PluginContext 包含 activate 元数据** — `ctx.pluginId: string`, `ctx.manifest: Manifest`。插件可在 activate 中读取自身 ID 和 manifest 信息
- **D-06: PluginContext.services 对象冻结** — 使用 Object.freeze() 冻结 services 对象，防止插件替换服务引用。与 Phase 3 D-03 的安全包装器模式一致

### 资源追踪（D-07 ~ D-09）
- **D-07: ResourceTracker 集中管理资源** — PluginHost 内部维护 ResourceTracker 实例。插件通过 ctx 中的包装器 API 注册资源时自动追踪：`ctx.commandBus.registerHandler()` → 返回 Disposable → ResourceTracker 记录
- **D-08: 可追踪资源类型** — 命令处理器（command handler）、事件订阅（event subscription）、定时器（setInterval/setTimeout）、进程（spawned process）。每种资源对应一个 Disposable
- **D-09: deactivate 时自动清理** — `deactivatePlugin(pluginId)` → 调用 ResourceTracker.disposeAll(pluginId) → 逐个调用 Disposable.dispose() → 清空追踪记录。清理顺序：先停进程 → 再清定时器 → 最后注销命令/事件

### 生命周期错误处理（D-10 ~ D-12）
- **D-10: 插件间错误隔离** — 插件 A 的 activate() 抛异常：捕获并记录（EsmActivationError），不影响插件 B 和基座运行。失败插件的资源（如有部分注册）通过 ResourceTracker 回滚
- **D-11: deactivate 超时保护** — `Promise.race([plugin.deactivate(), timeout(5000)])`。超时后强制清理资源（ResourceTracker.disposeAll），记录超时警告。与 Phase 3 D-14 的 EsmLoadTimeoutError 模式一致
- **D-12: activate 失败回滚** — activate() 中异常或超时 → 回滚已注册的资源（通过 ResourceTracker）→ 插件状态回到 installed（可重试激活）。不留下半激活状态的残留资源

### 兼容性（D-13 ~ D-14）
- **D-13: PluginRuntime 保留为兼容层** — 现有 `kernelContainer.pluginRuntime` 引用不变。PluginRuntime 内部方法（installPlugin, activatePlugin 等）委托给 PluginHost。server.ts 无需修改
- **D-14: wrapped* 安全包装器迁移** — 现有 `createSafeFunction`、原型链冻结、Object.defineProperty 逻辑从 PluginRuntime 迁移到 PluginHost。不重复编写，直接移动代码。PluginRuntime 的 evaluateAndActivate（vm 路径）继续使用旧的安全包装器直到 Phase 8

### Claude's Discretion
- PluginHost 类的具体文件拆分（单个 plugin-host.ts 还是 host/ 子目录）
- ResourceTracker 是否作为独立类或 PluginHost 内部模块
- PluginState 状态机的具体实现（简单的 string 枚举还是 TypeScript discriminated union）
- loadFromDB / restoreActivePlugins 的具体策略（启动时恢复哪些插件）
- 测试文件的具体组织和 mock 策略
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级文档
- `.planning/ROADMAP.md` — Phase 4 目标、成功标准（5 项）、依赖关系（Phase 3）、需求映射（PLUG-05）
- `.planning/PROJECT.md` — 项目核心价值、约束条件
- `.planning/STATE.md` — 当前项目状态

### 先前阶段上下文
- `.planning/phases/03-esm/03-CONTEXT.md` — Phase 3 锁定决策：EsmLoader 抽象基类（D-02）、PluginModule 接口（D-03）、loader_version 分支（D-09）、EsmActivationError（D-14）
- `.planning/phases/02-token/02-CONTEXT.md` — Phase 2 锁定决策：7 个 IService 接口、async 统一签名（D-10）、安全包装器保留（D-07）
- `.planning/phases/01-token-di/01-CONTEXT.md` — Phase 1 锁定决策：Token 命名规范（D-02）、字符串依赖声明（D-03）

### 代码库参考（必须阅读）
- `packages/core/plugin-runtime/index.ts` — 现有 PluginRuntime 完整实现（wrapped* 安全包装器、evaluateAndActivate、installPlugin、deactivatePlugin），Phase 4 需将其生命周期逻辑提取到 PluginHost
- `packages/core/esm-loader/esm-loader.ts` — EsmLoader 抽象类 + PluginModule 接口，PluginHost 通过 EsmLoader 加载插件
- `packages/core/esm-loader/errors.ts` — EsmLoaderError 层次，PluginHost 复用 EsmActivationError
- `packages/core/kernel/index.ts` — Kernel 构造函数，PluginHost 的初始化位置
- `packages/core/di/service-registry.ts` — ServiceRegistry API，PluginHost 通过它构建 PluginContext
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **PluginRuntime.evaluateAndActivate()** (lines 150-405) — wrapped* 安全包装器构建逻辑（createSafeFunction、原型链冻结、Object.defineProperty）。直接迁移到 PluginHost，不重复编写
- **PluginRuntime.deactivatePlugin()** (lines 78-148) — 现有资源清理逻辑（actions、commandTypes、eventSubscriptions、processHandlers、spawnedProcessIds、capabilities）。ResourceTracker 将此逻辑形式化
- **PluginRuntime.installPlugin()** (lines 36-51) — 现有安装流程（INSERT INTO plugins + evaluateAndActivate）。PluginHost 扩展此逻辑支持 lifecycle 状态机
- **EsmLoader.load()** — Phase 3 的模块加载接口。PluginHost 通过 EsmLoader 加载插件代码，返回 PluginModule
- **manifestSchema** — Phase 3 的 zod manifest 校验。PluginHost 在安装时复用

### Established Patterns
- **ESM .js 扩展导入** — 所有 packages/ 下的 .ts 文件使用 `.js` 扩展名导入
- **packages/core/ 目录结构** — 每个子系统一个目录 + index.ts barrel。plugin-host/ 遵循相同结构
- **Kernel 全局单例 + 构造函数分层注入** — PluginHost 在 Kernel 中初始化，注入 ServiceRegistry 和 EsmLoader
- **错误类层次** — 遵循 packages/core/di/errors.ts 和 packages/core/esm-loader/errors.ts 的继承模式

### Integration Points
- **Kernel 构造函数** — Phase 4 在此创建 PluginHost 实例，替代/包装 PluginRuntime
- **server.ts** — 插件管理 API 端点（POST /api/plugins/install 等），通过 PluginHost 执行
- **PluginRuntime.evaluateAndActivateEsm()** — Phase 3 新增的 ESM 加载分支，PluginHost 直接调用此方法
</code_context>

<specifics>
## Specific Ideas

标准方法——Phase 4 是对现有 PluginRuntime 的架构重构，从单体类拆分为 PluginHost（生命周期管理）+ PluginRuntime（兼容层）。关键原则：
- 现有 wrapped* 安全包装器代码直接迁移，不重新实现
- PluginRuntime API 保持不变，内部委托给 PluginHost
- 资源追踪形式化现有的 deactivatePlugin 清理逻辑
- 与 Phase 3 的 EsmLoader + manifestSchema 紧密集成
</specifics>

<deferred>
## Deferred Ideas

无。讨论聚焦在 Phase 4 的 PluginHost 生命周期管理设计决策上，未出现超出范围的想法。
</deferred>

---

*Phase: 4-PluginHost + 生命周期*
*Context gathered: 2026-06-18 via --auto*
