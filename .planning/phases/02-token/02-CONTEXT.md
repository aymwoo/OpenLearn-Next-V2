# Phase 2: 现有能力 Token 化 - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

将现有 7 个核心子系统封装为 IService 接口 + Token 实例，在 Kernel 启动时注册到 ServiceRegistry。纯架构改造——不改变任何外部行为，现有代码通过 `kernelContainer.xxx` 直接访问保持不变，新插件代码通过 `serviceRegistry.resolve(token)` 获取类型安全的服务实例。

**In scope:**
- 7 个 IService 接口定义（ICommandBusService, IEventBusService, IActionRegistryService, ICapabilityService, IProcessService, IStorageService, IAIService）
- 7 个对应 Token 实例导出（命名格式：`IServiceNameToken`）
- StorageService 和 AIService 独立实现类（从 PluginRuntime 提取）
- 现有 5 个子系统实例直接注册到 ServiceRegistry
- Kernel 构造函数中按依赖层级顺序注册
- vitest 测试验证注册/解析流程

**Out of scope:**
- PluginRuntime 架构变更（Phase 4 PluginHost 替代）
- ESM 动态加载、ZIP 包格式（Phase 3）
- Worker 隔离和 RPC 代理（Phase 5）
- SemVer 版本兼容（Phase 6）
- 热重载、中间件管道（Phase 7）
- 现有插件重写（Phase 8）
- DB 的 IService 接口（DB 通过 kernelContainer.db 直接访问）
</domain>

<decisions>
## Implementation Decisions

### IService 接口设计与粒度（D-01 ~ D-05）
- **D-01:** 一个子系统一个 IService — 7 个独立接口：ICommandBusService, IEventBusService, IActionRegistryService, ICapabilityService, IProcessService, IStorageService, IAIService。遵循单一职责原则，每个 Token 对应明确的服务契约
- **D-02:** 暴露全部公开方法 — 接口包含对应子系统的所有 public 方法。setInterceptor 等内部方法也在接口中声明（完整性 > 最小暴露）。PluginRuntime 的 wrapped* 包装器在接口之上叠加安全限制
- **D-03:** 接口定义集中在 `packages/core/di/` 目录 — 所有 IService 接口 + Token 实例放在同一位置，单一入口点便于插件开发者发现
- **D-04:** DB 不做 Token 化 — better-sqlite3 实例通过 `kernelContainer.db` 直接访问。不需要 IDatabaseService 接口
- **D-05:** 不预留生命周期方法 — IService 接口不含 dispose/cleanup 方法。Phase 4 的 deactivate 逻辑由 PluginHost 管理

### Storage/AI 提取 + wrapped* 包装层（D-06 ~ D-09）
- **D-06:** 提取为独立 IService 实现类 — 创建 StorageService 类（实现 IStorageService）和 AIService 类（实现 IAIService），在 Kernel 构造函数中实例化并注册到 ServiceRegistry。Phase 5 可无缝替换为 RPC proxy
- **D-07:** 保留现有 wrapped* 安全包装器 — PluginRuntime 的 wrappedEventBus/wrappedCommandBus/wrappedActionRegistry/wrappedProcessManager 保持不变。IService 实现直接代理到内核实例（功能层），wrapped* 保留安全层。两层分离，PluginRuntime 不改动安全逻辑
- **D-08:** Storage/AI IService 实现文件在 `packages/core/di/` 目录 — 与接口定义同一位置。新增文件：storage-service.ts, ai-service.ts
- **D-09:** 现有子系统直接注册实例 — CommandBus、EventBus、ActionRegistry、CapabilityGuard、ProcessManager 实例直接注册到 ServiceRegistry 并类型断言为 IService 接口。不创建适配器类——现有 public 方法签名与接口兼容

### 接口方法签名与类型规范（D-10 ~ D-13）
- **D-10:** 统一 async 签名 — 所有 IService 方法返回 Promise<T>。同步方法（如 EventBus.subscribe）内部立即 resolve。符合 Phase 1 D-05 前瞻性设计——Worker RPC 代理无需修改接口
- **D-11:** 渐进式收紧类型 — 优先收紧返回值类型（如 execute<T> 泛型返回 Promise<T>）。payload/params 参数保留泛型或 unknown，不强制 any → 严格类型。先建立接口契约框架，后续 Phase 逐步收紧参数
- **D-12:** Storage/AI 基于现有 wrapped API — IStorageService: `get(key) → Promise<any>`, `set(key, value) → Promise<void>`, `delete(key) → Promise<void>`。IAIService: `generateText(prompt, options?) → Promise<string>`。与现有 PluginRuntime wrapped* 接口完全一致——现有插件代码零修改
- **D-13:** Token 命名格式 — Token 常量导出命名为 `IServiceNameToken`：ICommandBusServiceToken, IEventBusServiceToken, IActionRegistryServiceToken, ICapabilityServiceToken, IProcessServiceToken, IStorageServiceToken, IAIServiceToken。Token 标识符字符串遵循 `@openlearn/core:IServiceName`（Phase 1 D-02）

### 注册时机、依赖顺序与测试（D-14 ~ D-17）
- **D-14:** Kernel 构造函数中注册 — 所有 7 个 IService 在 Kernel 构造函数内注册（ServiceRegistry 初始化后、拦截器设置前）。构造函数结束时所有服务可用，server.ts 无需额外 bootstrap 步骤
- **D-15:** 按依赖层级顺序注册 — Layer 0（无依赖）：EventBus、CapabilityGuard、StorageService → Layer 1（仅依赖 Layer 0）：CommandBus（依赖 EventBus）、ActionRegistry → Layer 2（依赖 Kernel/db）：ProcessManager（依赖 Kernel）、AIService（依赖 db + env）。每层内部顺序任意。StorageService 和 AIService 虽是新类但无 Token 级依赖，与其他服务并行注册
- **D-16:** ServiceRegistry 注册时不声明依赖 — 7 个子系统注册时无需 requires/optional 参数。它们之间的依赖通过构造函数传参（如 CommandBus(EventBus)），不是通过 ServiceRegistry.resolve 解析。Token 化的注册是能力暴露，不是 DI 级别依赖管理
- **D-17:** 需要测试 — 为服务注册流程编写 vitest 测试：验证 7 个 Token 全部注册、resolve 返回正确实例、Token 命名格式符合规范。为 StorageService 和 AIService 编写单元测试

### Claude's Discretion
以下技术细节由下游 agent（researcher/planner）自主决定：
- IService 接口文件的具体拆分方式（单个 interfaces.ts 还是 services/ 子目录）
- 每个接口方法的具体类型签名（泛型参数名、可选参数处理）
- StorageService/AIService 类中 DB 访问的具体实现
- 测试用例的具体组织和数量
- Token 实例的导出方式（命名导出 vs barrel 统一导出）
- 现有 subsystem 实例注册时的类型断言写法
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级文档
- `.planning/ROADMAP.md` — Phase 2 目标、成功标准（5 项）、依赖关系（Phase 1）、需求映射（PLUG-06, PLUG-11）
- `.planning/PROJECT.md` — 项目核心价值、约束条件（兼容性、双运行时、安全性、类型安全、渐进式）、PLUG-04 已验证
- `.planning/STATE.md` — 当前项目状态（Phase 01 完成，Phase 02 准备讨论）
- `.planning/phases/01-token-di/01-CONTEXT.md` — Phase 1 锁定决策：Token 命名规范（D-02）、显式注册模式（D-01）、Token 字符串比较（D-03）、async 签名（D-05）、Fail-fast 异常（D-07）

### 代码库参考（必须阅读）
- `packages/core/kernel/index.ts` — Kernel 类定义、构造函数初始化顺序、ServiceRegistry 的集成点。Phase 2 在此处添加 7 个 IService 注册
- `packages/core/di/service-registry.ts` — ServiceRegistry API（register/resolve/unregister/registerOrReplace + 内省方法）
- `packages/core/di/token.ts` — Token<T> 类定义和用法
- `packages/core/command-bus/index.ts` — CommandBus 完整 API + PlatformCommand/CommandHandler 接口定义
- `packages/core/event-bus/index.ts` — EventBus API（subscribe/unsubscribe/publish）+ PlatformEvent 接口
- `packages/core/registry/index.ts` — ActionRegistry API（register/unregister/getAgentTools 等）+ ActionDescriptor 接口
- `packages/core/capability-system/index.ts` — CapabilityGuard API（grant/revokeAll/check）
- `packages/core/process-manager/index.ts` — ProcessManager API（spawn/registerHandler/registerInterval/kill/restore）
- `packages/core/plugin-runtime/index.ts` — wrappedStorage（第 327-362 行）、wrappedAI（第 365-440 行）、wrapped* 包装器的现有实现。Storage/AI 提取的目标代码

### 测试参考
- `packages/core/di/__tests__/token.test.ts` — Phase 1 Token 测试的风格和模式
- `packages/core/di/__tests__/service-registry.test.ts` — Phase 1 ServiceRegistry 测试的风格和模式
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **packages/core/di/ 目录结构** — Phase 1 建立的模式：token.ts + service-registry.ts + errors.ts + index.ts barrel + __tests__/。Phase 2 新增 interfaces.ts（或 services/ 子目录）+ storage-service.ts + ai-service.ts
- **Token<T> 泛型类** — 已在 Phase 1 实现并测试。Phase 2 创建 7 个 Token 实例，命名遵循 `@openlearn/core:IServiceName` 规范
- **ServiceRegistry.register()** — 支持 RegisterOptions（requires/optional）。Phase 2 的 7 个子系统注册时不声明依赖（D-16），但接口预留了此能力
- **wrappedStorage/wrappedAI 实现** — plugin-runtime/index.ts:327-440 包含完整的 Storage（get/set/delete 基于 SQLite plugin_storage 表）和 AI（Gemini/OpenAI 兼容 API 调用）逻辑。提取时直接复用业务逻辑

### Established Patterns
- **Kernel 全局单例模式** — `kernelContainer` 在模块加载时实例化（kernel/index.ts:78）。所有子系统作为 public readonly 属性。Phase 2 保持此模式——添加 IService 注册但不改变属性访问方式
- **ESM 导入规范** — 后端代码使用 `.js` 扩展名相对导入。DI 模块遵循相同规范
- **IService 接口无装饰器** — 项目不使用装饰器。所有接口为纯 TypeScript interface 定义，实现为显式类
- **console 日志惯例** — 使用 `[Subsystem]` 前缀标签。StorageService/AIService 的错误信息遵循此格式

### Integration Points
- **Kernel 构造函数** (packages/core/kernel/index.ts:21-57) — 第 22 行 ServiceRegistry 初始化后、第 31 行拦截器前，插入 7 个 IService 注册（D-14）。位置必须在 ServiceRegistry 创建之后、拦截器使用 actionRegistry 之前
- **PluginRuntime.evaluateAndActivate()** — 当前直接访问 `this.kernel.eventBus` 等创建 wrapped* 对象。Phase 2 不改动此逻辑（D-07），但 Storage/AI 提取后 PluginRuntime 不再内联定义 wrappedStorage/wrappedAI——改为引用独立 IService 实例
- **现有 bootstrap 流程** (server.ts:startServer()) — Kernel 初始化后、插件加载前。Phase 2 不修改此流程
</code_context>

<specifics>
## Specific Ideas

用户未引用外部文档或设计规范。所有决策基于：
- Phase 1 锁定的 DI 容器设计（Token 命名、显式注册、async 签名）
- 现有代码库的子系统架构（7 个子系统，Kernel 单例模式）
- ROADMAP 成功标准（5 项 must-have truths）

标准方法即可，无需特殊约束。
</specifics>

<deferred>
## Deferred Ideas

讨论中未出现超出 Phase 2 范围的想法——用户始终聚焦于现有能力 Token 化的设计决策。

### Reviewed Todos (not folded)
无。
</deferred>

---

*Phase: 2-现有能力 Token 化*
*Context gathered: 2026-06-18*
