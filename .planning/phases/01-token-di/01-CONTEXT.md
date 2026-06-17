# Phase 1: Token DI 内核 - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

建立类型安全的依赖注入基础设施——Token 类（类型安全的服务标识符）和 ServiceRegistry（服务注册/解析/注销容器）。纯基础设施层，不涉及任何插件执行方式变更（Phase 3-5），不涉及现有子系统改造（Phase 2）。

**In scope:**
- Token<T> 泛型类：通过标识符字符串创建类型安全的服务 Token
- ServiceRegistry 容器：register / resolve / unregister 完整生命周期
- 拓扑排序依赖解析：支持 requires/optional 依赖声明
- 循环依赖检测：明确的错误报告（含参与循环的 Token 列表）
- 内省/调试 API：list()、has(token)、dependencies(token)
- vitest 单元测试：覆盖 5 个成功标准

**Out of scope:**
- IService 接口定义和现有子系统 Token 化（Phase 2）
- ESM 动态加载、ZIP 包格式（Phase 3）
- activate/deactivate 生命周期实现（Phase 4）
- Worker 隔离和 RPC 代理（Phase 5）
- SemVer 版本兼容（Phase 6）
- 热重载、中间件管道（Phase 7）
</domain>

<decisions>
## Implementation Decisions

### DI 容器设计哲学
- **D-01:** JupyterLab 显式风格 — `new Token<T>('@scope:name')` + `registry.register(token, instance)` 手动注册。不使用装饰器或 reflect-metadata，确保跨运行时（Node.js/浏览器）零依赖兼容
- **D-02:** Token 命名规范 — 反向域名 scope + 冒号分隔符：`@openlearn/core:IServiceName`、`@openlearn/plugin:IQuizGenerator`。参考 JupyterLab 惯例，层次清晰
- **D-03:** 依赖声明格式 — manifest 中使用字符串标识符（`requires: ['@openlearn/core:ICommandBusService']`）。字符串比较避免跨 bundle 的 Token 对象 `===` 不匹配问题

### 类型系统与 API 设计
- **D-04:** 完整泛型推导 — `Token<T>` 携带服务接口类型，`registry.resolve(token)` 返回类型 `T`（非 unknown），编译期类型安全
- **D-05:** 同步 register + async 接口预留 — `register(token, instance)` 同步执行（注册已实例化对象），但方法签名声明为 async/返回 Promise，为 Phase 5 的 RPC proxy 预留异步签名
- **D-06:** Register 时检查依赖 — 注册时立即验证 requires 指向的 Token 是否已注册，早发现配置错误。要求按依赖顺序注册（被依赖的先注册）

### 错误处理与边界行为
- **D-07:** Fail-fast 抛异常 — 所有异常情况（重复注册、缺失依赖、循环依赖、注销被依赖服务）均抛出具名 Error，错误信息包含 Token 名称和上下文
- **D-08:** 重复注册抛异常 — 同一 Token 注册两次直接抛错。同时提供 `registerOrReplace(token, instance)` 显式覆盖方法，为 Phase 7 热重载预留
- **D-09:** 级联注销阻止 — `unregister(token)` 若存在依赖方则抛错，强制开发者先手动注销依赖方。不自动级联，避免意外的级联停用
- **D-10:** 完整内省 API — 提供 `list()`（列出所有已注册 Token+实例）、`has(token)`（检查是否已注册）、`dependencies(token)`（查询依赖子图）

### 集成与架构
- **D-11:** Kernel 新属性 — `kernelContainer.serviceRegistry`，作为 Kernel 的第 7 个子系统。与现有 commandBus、eventBus 等属性同级，渐进式引入
- **D-12:** 文件组织 — `packages/core/di/` 目录，包含 `token.ts`、`service-registry.ts`、`index.ts` barrel，与 `command-bus/`、`event-bus/` 等平级
- **D-13:** 初始化时机 — ServiceRegistry 在 Kernel 构造函数中初始化，与其他子系统同步创建。实际服务注册推迟到 bootstrap 阶段

### 生命周期与未来兼容
- **D-14:** 纯 DI + 接口预留 — Phase 1 只实现 register/resolve/unregister 核心逻辑。Token 和 ServiceRegistry 接口设计预留扩展点（如 onDispose 回调签名），不实现具体生命周期逻辑
- **D-15:** Token 不预留版本字段 — Phase 1 的 Token 只包含标识符字符串，不涉及版本。Phase 6 通过 Token Registry 叠加版本兼容层，职责分离

### 测试与质量
- **D-16:** Phase 1 加入单元测试 — 为 Token 和 ServiceRegistry 编写测试（循环依赖检测、拓扑排序、unregister 行为等）。DI 容器纯逻辑、无副作用，是建立测试文化的最佳起点
- **D-17:** vitest 作为测试框架 — Vite 原生生态，与项目已有的 Vite 配置零摩擦，速度快，TS 原生支持
- **D-18:** 文件级 TypeScript strict 模式 — Token 和 ServiceRegistry 源码文件使用 `// @ts-strict` 文件级注释，不改变项目全局 tsconfig。新代码高标准，不影响现有代码

### Claude's Discretion
以下技术细节由下游 agent 自主决定：
- 拓扑排序算法的具体实现（Kahn 算法 vs DFS）
- 循环依赖检测的具体数据结构
- registerOrReplace 的实现策略
- 内省 API 的返回格式
- Token 的唯一性保证机制（Symbol vs 字符串比较）
- 测试用例的具体组织和数量
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级文档
- `.planning/ROADMAP.md` — Phase 1 目标、成功标准（5 项）、依赖关系、需求映射（PLUG-04）
- `.planning/PROJECT.md` — 项目核心价值、约束条件（兼容性、双运行时、安全性、类型安全、渐进式）、关键决策表
- `.planning/STATE.md` — 当前项目状态、进度、累积上下文

### 代码库参考（必须阅读）
- `packages/core/kernel/index.ts` — Kernel 类定义和 singleton，ServiceRegistry 的集成点。需理解构造函数中的子系统初始化顺序和拦截器管道
- `packages/core/plugin-runtime/index.ts` — 现有 PluginRuntime，包含 wrapped* 代理模式（wrappedCommandBus、wrappedEventBus 等）。理解现有 API 包装机制，为 Phase 2 的 IService 接口设计提供上下文

### 设计参考（外部）
- JupyterLab Plugin System 设计 — Token-based DI 的原型参考。核心概念：`Token<T>` 泛型、`JupyterFrontEndPlugin<T>` 接口、`requires`/`optional` 声明数组、`autoStart` 控制
- VSCode Extension API — `activate`/`deactivate` 生命周期参考（Phase 4 使用，Phase 1 接口预留时参考）

### 现有代码模式（了解即可）
- `packages/core/command-bus/index.ts` — CommandBus 的 registerHandler/execute 模式，Phase 2 需封装为 ICommandBusService
- `packages/core/event-bus/index.ts` — EventBus 的 subscribe/publish 模式，Phase 2 需封装为 IEventBusService
- `packages/core/registry/index.ts` — ActionRegistry 的 register/unregister 模式，Phase 2 需封装为 IActionRegistryService
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **packages/core/ 目录结构惯例** — 每个子系统一个目录 + index.ts barrel + 类导出 + 单例模式。DI 容器遵循相同结构
- **Kernel 全局单例模式** — `kernelContainer` 在模块加载时实例化（`kernel/index.ts:76`），ServiceRegistry 作为其属性，初始化时机和方式一致
- **现有 PluginRegistration 追踪模式** — `plugin-runtime/index.ts:17` 用 Map<string, PluginRegistration> 追踪每个插件的注册资源。ServiceRegistry 的内部注册表可参考此模式

### Established Patterns
- **ESM 导入规范** — 后端代码使用 `.js` 扩展名的相对导入（`import { EventBus } from '../event-bus/index.js'`）。DI 模块遵循相同规范
- **无装饰器生态** — 项目不使用装饰器、无 reflect-metadata 依赖。DI 容器必须采用显式注册模式，不可引入装饰器
- **同步数据库访问** — better-sqlite3 使用同步 API。DI 容器的 register 同步执行与此一致
- **console 日志惯例** — 使用 `[Subsystem]` 前缀标签（如 `[CommandBus]`、`[Plugin:id]`）。DI 容器的错误/警告信息遵循此格式

### Integration Points
- **Kernel 构造函数** (`packages/core/kernel/index.ts:19-55`) — ServiceRegistry 在此初始化（与其他 6 个子系统同步），置于拦截器设置之前
- **bootstrap 流程** (`server.ts:startServer()`) — Kernel 初始化后、插件加载前，现有服务在此阶段注册到 ServiceRegistry
- **现有插件 API 包装器** — PluginRuntime 中的 wrappedCommandBus、wrappedEventBus 等（plugin-runtime/index.ts:208-362）将在 Phase 2 被 IService + Token 替代
</code_context>

<specifics>
## Specific Ideas

用户未引用具体的外部文档、ADR 或设计规范。设计决策基于：
- JupyterLab Token DI 系统作为核心参考模型
- 项目现有代码库的架构惯例（Kernel 单例、模块目录结构、ESM 导入规范）
- 对 9 个 Phase 依赖关系的考量（Phase 1 作为基石，后续 Phase 依赖其接口设计）

标准方法即可，无需特殊约束。
</specifics>

<deferred>
## Deferred Ideas

讨论中未出现超出 Phase 1 范围的想法——用户始终聚焦于 DI 容器的设计决策。

### Reviewed Todos (not folded)
无。
</deferred>

---

*Phase: 1-Token DI 内核*
*Context gathered: 2026-06-17*
