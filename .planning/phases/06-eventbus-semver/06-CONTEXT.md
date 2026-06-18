# Phase 6: EventBus 服务 + SemVer 兼容 - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

实现全局事件总线服务 IEventBusService（统一异步事件 API）和 Token 语义化版本兼容系统（插件声明 `ICommandBusService@^1.0`，基座在安装和激活时检查版本兼容性）。

**In scope:**
- IEventBusService 作为统一的事件 API：插件通过 `ctx.services.eventBus` 发布/订阅事件，无需单独注册扩展点
- Token 类新增 `version` 属性（semver 字符串，默认 `'1.0.0'`）
- 使用 `semver` npm 包实现标准 semver 版本范围匹配（支持 `^`/`~`/`>=`/pre-release 标签）
- manifest.json `requires` 字段扩展支持 `@scope:IService@^version` 格式（不带 `@version` 时默认为 `*`——任意版本兼容）
- 安装时 + 激活时双重版本兼容性检查：不兼容则拒绝安装/激活
- SemverMismatchError 结构化错误（插件 id/名称、冲突 Token 名称、要求范围、实际版本、人类可读描述）
- ServiceRegistry.resolveByName() 完成实现：按标识符字符串查询已注册的 Token 并 resolve
- manifest-schema.ts 扩展：新增 requires 正则支持 `@version`，同时保留旧 schema 导出（manifestSchemaV3）
- PluginHost 集成：activatePlugin() 在构建 PluginContext 前检查 requires 声明的 Token 版本兼容性
- optional 依赖版本不匹配时：跳过该服务注入 + console.warn（不阻塞激活）

**Out of scope:**
- 事件历史存储/重放
- 一次性订阅 once()
- 插件热重载（Phase 7）
- 现有插件迁移（Phase 8）
- 浏览器端完整实现（Phase 9）
- Token 的运行时版本自动升级
</domain>

<decisions>
## Implementation Decisions

### IEventBusService API 设计（D-01）
- **D-01: 保持现有接口不变** — IEventBusService 已定义 publish/subscribe/unsubscribe 三个方法，Phase 2 已设为 async 签名。Phase 5 的 EventForwarder 已验证跨 Worker 事件转发可行性。不新增 once()、事件历史/重放等方法。接口足够满足 ROADMAP SC1 要求

### SemVer 版本格式与兼容性（D-02 ~ D-05）
- **D-02: 标准 semver + ^/~ 范围** — x.y.z 版本格式，支持 `^1.2.3`（兼容主版本）、`~1.2.3`（兼容次版本）、`>=1.0.0 <2.0.0`（显式范围）。与 npm 生态完全兼容，零学习成本
- **D-03: 使用 semver npm 包** — 使用 `semver` 包（npm 最广泛使用的 semver 解析器）做版本匹配。内置 `satisfies('1.5.0', '^1.0.0') → true` 和 `satisfies('1.5.0', '^2.0.0') → false`。手动实现仅需 `semver.satisfies(actualVersion, requiredRange)` 调用
- **D-04: 支持 pre-release 标签** — `1.0.0-alpha.1`, `2.0.0-beta.3` 等 pre-release 标签完整支持。semver 包内置 pre-release 优先级规则：`^1.0.0` 不匹配 `2.0.0-alpha`（正确行为——pre-release 版本低于正式版本）
- **D-05: 安装时 + 激活时双重检查** — 安装时拦截：不兼容的插件直接拒绝安装（ROADMAP SC5）。激活时再次验证：因为服务版本可能在安装后因基座升级而变化。保证用户不会遇到"安装成功但无法激活"的情况

### Token 版本注册与 Registry（D-06 ~ D-08）
- **D-06: Token 携带 version 属性** — Token 类新增 `version: string` 字段，默认值 `'1.0.0'`：`new Token<T>('@openlearn/core:ICommandBusService', '1.0.0')`。ServiceRegistry.register() 自动从 Token 读取版本并存储。Phase 2 创建的 7 个 Token 实例无需修改——默认值 `'1.0.0'` 向后兼容
- **D-07: ServiceRegistry.resolveByName() 完成实现** — Phase 5 通过 ServiceHost.resolveService() 中的 fallback 类型检查引入了 resolveByName 调用。Phase 6 在 ServiceRegistry 中完整实现：`resolveByName(tokenName: string): Promise<unknown>`，通过 `internalRegistry` Map 按 Token 标识符字符串查找并 resolve。满足 ROADMAP SC4（Token Registry 模式——插件通过字符串 key 查询 Token 而非直接 import Token 对象）
- **D-08: 现有 7 个 Token 全部从 1.0.0 开始** — ICommandBusServiceToken、IEventBusServiceToken 等 7 个 Phase 2 Token 默认 version `'1.0.0'`。Phase 3-5 创建的其他 Token（如 IEsmLoaderToken）也使用默认值。后续阶段中如某个服务有 breaking change，同步更新该 Token 的版本号

### Manifest Schema 变更（D-09 ~ D-10）
- **D-09: requires 统一字符串格式** — `requires` 条目统一为 `@scope:IServiceName` 或 `@scope:IServiceName@^version`。zod schema 正则支持两种形式。不带 `@version` 时语义为 `*`（任意版本兼容）——向后兼容 Phase 3 的现有 manifest 格式。示例：`["@openlearn/core:ICommandBusService", "@openlearn/core:IEventBusService@^1.0"]`
- **D-10: 扩展 schema + 保留旧版导出** — `manifest-schema.ts` 新增 `requires` 的正则 `.regex(/^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/)`。同时导出 `manifestSchemaV3`（旧正则——不带版本）供 Phase 3-5 的现有代码和测试继续使用。Phase 8 迁移完成后废弃旧版

### 错误处理与 Optional 依赖（D-11 ~ D-12）
- **D-11: 结构化 SemverMismatchError** — 包含 `pluginId`、`pluginName`、`tokenName`、`requiredRange`、`actualVersion` 字段，以及 `message` 属性的人类可读描述（如 "插件 quiz-generator@1.2.0 要求 @openlearn/core:ICommandBusService@^2.0.0，但基座提供 1.5.0。请升级基座或使用兼容的插件版本"）。结构化字段供 UI 解析，人类可读字符串供日志
- **D-12: Optional 依赖不匹配时跳过 + 警告** — manifest.json `optional` 字段中 Token 版本不兼容时：跳过该服务的注入（`ctx.services` 中该 key 为 `null`），打印 `console.warn`。插件可通过 `if (ctx.services.someService === null)` 做降级处理。与 JupyterLab 的 optional token 行为一致

### Claude's Discretion
以下技术细节由下游 agent（researcher/planner）自主决定：
- SemverMismatchError 类的精确字段定义和 message 模板
- PluginHost.activatePlugin() 中版本检查的精确代码位置（在构建 PluginContext 之前、EsmLoader.load() 之前或之后）
- semver.satisfies() 调用的具体错误处理（try/catch 包裹，语义化版本字符串无效时的回退策略）
- Manifest schema 正则的精确模式
- 版本检查逻辑的vitest测试文件组织和 mock 策略
- `semver` 包的具体导入方式（ESM import）
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级文档
- `.planning/ROADMAP.md` — Phase 6 目标、成功标准（5 项）、依赖关系（Phase 5）、需求映射（PLUG-07, PLUG-09）
- `.planning/PROJECT.md` — 项目核心价值、约束条件、需求追踪
- `.planning/STATE.md` — 当前项目状态
- `.planning/REQUIREMENTS.md` — PLUG-07（IEventBusService）、PLUG-09（SemVer 兼容）

### 先前阶段上下文
- `.planning/phases/04-pluginhost/04-CONTEXT.md` — Phase 4 锁定决策：PluginContext 接口（D-04）、ctx.services 对象冻结（D-06）、生命周期错误处理（D-10~D-12）。Phase 6 的 SemVer 检查在 activatePlugin() 中插入
- `.planning/phases/03-esm/03-CONTEXT.md` — Phase 3 锁定决策：manifest.json requires/optional 字符串格式（D-05）、manifest-schema.ts zod schema（D-10）。Phase 6 扩展 requires 正则支持 @version
- `.planning/phases/02-token/02-CONTEXT.md` — Phase 2 锁定决策：IEventBusService 接口定义（D-02）、async 统一签名（D-10）、Token 命名格式（D-13）

### 代码库参考（必须阅读）
- `packages/core/di/interfaces.ts` — IEventBusService 接口定义（publish/subscribe/unsubscribe），Phase 6 无需修改
- `packages/core/di/token.ts` — Token<T> 类，Phase 6 新增 version 参数（默认 '1.0.0'）
- `packages/core/di/service-registry.ts` — ServiceRegistry API，Phase 6 完成 resolveByName() 实现 + register() 存储版本信息
- `packages/core/esm-loader/manifest-schema.ts` — Phase 3 的 zod manifest schema，Phase 6 扩展 requires 正则
- `packages/core/plugin-host/index.ts` — PluginHost.activatePlugin()，Phase 6 在此插入 SemVer 检查
- `packages/core/event-bus/index.ts` — EventBus 实现（subscribe/publish/unsubscribe + wildcard），IEventBusService 的底层实现
- `packages/core/worker-runtime/service-host.ts` — ServiceHost.resolveService()，已在调用 resolveByName（fallback 路径），Phase 6 完成正式实现
- `packages/core/plugin-host/types.ts` — PluginContext 接口定义
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **IEventBusService 接口** (`packages/core/di/interfaces.ts:84-102`) — 已定义 publish/subscribe/unsubscribe，async 签名。已被 PluginContext 使用（`packages/core/plugin-host/types.ts`），EventForwarder 已验证跨 Worker 事件转发。Phase 6 不改动此接口
- **EventBus 实现** (`packages/core/event-bus/index.ts`) — 支持精确类型 + wildcard `*` 订阅。IEventBusService 的直接后端实现，已在内核中注册为 Token
- **ServiceRegistry.resolveByName 的类型检查代码** (`packages/core/worker-runtime/service-host.ts:303-320`) — Phase 5 的 ServiceHost 已通过 `typeof (this.serviceRegistry as unknown as Record<string, unknown>).resolveByName === 'function'` 的 duck-type 检查调用 resolveByName。Phase 6 将此方法的完整实现加入 ServiceRegistry
- **manifestSchema** (`packages/core/esm-loader/manifest-schema.ts`) — Phase 3 的 zod schema。requires/optional 字段当前正则只接受不带版本的服务名。Phase 6 扩展正则，同时导出旧版
- **PluginHost.activatePlugin()** (`packages/core/plugin-host/index.ts`) — Phase 4 的插件激活入口。Phase 6 在此方法中插入 SemVer 检查（在 EsmLoader.load() 之前），构建 PluginContext 之前完成验证
- **Token 类** (`packages/core/di/token.ts`) — 构造函数当前只接受 name 参数。Phase 6 新增可选 version 参数（默认 `'1.0.0'`）。`_phantomService` 泛型占位保持不变

### Established Patterns
- **ESM .js 扩展导入** — 所有 `packages/core/` 下的 .ts 文件使用 `.js` 扩展名导入。semver 包通过 ESM import
- **错误类层次** — 遵循 packages/core/di/errors.ts 和 packages/core/esm-loader/errors.ts 的继承模式。SemverMismatchError 继承自 Error 基类，包含结构化字段
- **Kernel 全局单例** — ServiceRegistry 注册的 Token 实例在 Kernel 构造函数中初始化。Phase 6 的 Token version 信息在注册时自动记录
- **异步接口统一签名** — 所有 IService 方法返回 Promise<T>。Phase 2 D-10 的前瞻性设计在此阶段完全兑现

### Integration Points
- **PluginHost.activatePlugin()** — 主要集成点：在激活前检查 requires + optional 中声明的所有 Token 是否存在、版本是否兼容
- **PluginRuntime.installPlugin()** — 次要集成点：安装时（installPlugin 调用 activatePlugin 之前）做预检查
- **manifest-schema.ts** — manifest 校验的集成点：扩展正则表达式，不影响现有 Phase 3-5 的校验逻辑
- **ServiceRegistry.register()** — Token 注册的集成点：存储 Token 的 version 到内部 Map
- **ServiceRegistry.resolveByName()** — Token 查询的集成点：完成从 Phase 5 fallback 到正式 API 的转换
</code_context>

<specifics>
## Specific Ideas

用户未引用外部文档或设计规范。所有决策基于：
- ROADMAP Phase 6 的成功标准（5 项 must-have truths）
- Phase 1-5 锁定的架构基础：Token DI、IService 接口、PluginHost 生命周期、manifest schema
- 标准 semver 规范（npm semver 包）
- Phase 3 D-05 明确将 `@^1.0` 语法延期到 Phase 6："Phase 6 可扩展为 @openlearn/core:ICommandBusService@^1.0 带版本范围"
- Phase 5 ServiceHost.resolveService() 中已预留的 resolveByName fallback 路径
</specifics>

<deferred>
## Deferred Ideas

讨论中未出现超出 Phase 6 范围的想法——用户始终聚焦于 EventBus 服务和 SemVer 兼容性的设计决策。

### Reviewed Todos (not folded)
无。
</deferred>

---

*Phase: 6-EventBus 服务 + SemVer 兼容*
*Context gathered: 2026-06-18*
