# Phase 8: 现有插件迁移 - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段将把系统现有的 6 个核心内置插件（`builtin.ts`、`management.ts`、`vfs.ts`、`process.ts`、`ai-planner.ts`、`ai-submit-injector.ts`）以及 2 个默认第三方插件（智能随堂测验 Quiz Component、随机点名小工具 Random Student Picker）重构为符合新版架构规范的插件。内置插件采用主线程 Inline 加载并使用 Token DI 解析依赖，第三方插件以新的 ZIP 包格式进行构建打包并在独立的 Worker Thread 沙箱中运行。迁移后，彻底删除旧版基于 `vm` 的 `plugin-runtime` 遗留代码。

</domain>

<decisions>
## Implementation Decisions

### 内置插件运行模式 (Execution Mode for Built-in Plugins)
- **D-01:** 所有内置特权插件（VFS, Process, LMS Management, AI Planner, AI Submit Injector）将以 `inline` 模式直接加载和运行在主线程，以保证最低的交互延迟，并能够直接访问主机的本地资源。
- **D-02:** 所有内置插件在执行 Command 和 API 调用时，均须通过 `CapabilityGuard` 能力权限校验，以维持系统整体安全边界和权限审计的一致性。
- **D-03:** 内置插件激活、停用、执行指令等生命周期全量接入在 Phase 7 实现的洋葱模型中间件（Onion Middleware Pipeline），支持全局拦截审计。
- **D-04:** 采用混合故障处理策略：VFS、Process 和 LMS Management 作为系统级核心插件，若激活失败直接崩溃退出（Hard crash）；AI Planner 和 AI Submit Injector 作为应用级插件，若激活失败则记录日志并跳过启动（Soft fail），以确保 Express 基座高可用。

### 适配器过渡策略 (Migration & Adapter Strategy)
- **D-05:** 采用彻底重构策略，不开发过多的兼容性运行期适配器。直接改写现有 6 个内置插件源码，剥离对 `kernelContainer` 全局单例的直接引用，改造成干净的 `activate(ctx)` / `deactivate()` 标准接口与 Token 依赖注入。
- **D-06:** 内置插件的注册和激活下沉到 Kernel 层自动加载，作为 OS 核心启动的一部分，Express 层 `server.ts` 不再直接 `import` 各个插件的 bootstrap 函数。
- **D-07:** 在 SQLite 的 `plugins` 数据表中为每个内置插件写入一条记录（如不存在），将其 `execution_mode` 标记为 `'inline'` 并且标为不可卸载的系统级插件，确保其在前台管理 UI 可见。
- **D-08:** 代码直接导出 Manifest：每个内置插件直接在源文件代码里声明并 export 清单（Manifest），避免从磁盘读取 `manifest.json` 文件以简化开发与打包。

### 第三方插件打包与加载 (Third-Party Plugins Packaging)
- **D-09:** 采用源码管理与构建时打包策略：在 `packages/plugins/` 下为 Quiz 和 Roll Call 插件建立独立的 TypeScript 源码目录（`quiz/` 与 `rollcall/`）。
- **D-10:** 打包输出的 `.zip` 压缩文件输出到 `dist/plugins/` 目录下，并在 `.gitignore` 中忽略，以保证 Git 仓库不被二进制压缩文件污染。
- **D-11:** 两个第三方插件 Quiz 和 Roll Call 默认配置为 `'worker'` 模式运行在独立 Worker Thread 中，所有的服务访问均通过 `ServiceProxy` 跨边界 RPC 代理进行，以隔离插件运行风险。
- **D-12:** 利用项目中已有的 `jszip` 依赖，编写独立的打包脚本 `scripts/build-plugins.mjs`，在 `pnpm build` 或 `npm run build` 流程中被调用，实现跨平台无缝打包。

### 迁移优先级与波次规划 (Migration Waves & Ordering)
- **D-13:** 迁移过程按以下波次与计划（Plans）依次推进：
  - **Wave 1 (Plan 08-01): 系统核心级内置插件迁移**：重构 `vfs.ts` 和 `process.ts`，实现 Kernel 自动加载并在 DB 中注册系统插件信息。
  - **Wave 2 (Plan 08-02): 业务逻辑内置插件迁移**：重构 `management.ts` 和 `builtin.ts`，从 `server.ts` 中彻底剥离旧的 bootstrap 直接调用。
  - **Wave 3 (Plan 08-03): AI 辅助插件迁移与旧系统删除**：重构 `ai-planner.ts` 和 `ai-submit-injector.ts`，并彻底物理删除 `plugin-runtime/index.ts`（基于 vm 的沙箱）及其在 API/路由层面的所有遗留代码。
  - **Wave 4 (Plan 08-04): 第三方插件打包构建与 Worker 沙箱测试**：实现 `scripts/build-plugins.mjs`，重写 Quiz 和 Roll Call 插件，配置为 `worker` 隔离运行并编写跨边界 RPC 和 Event 转发的端到端测试。
- **D-14:** 为每个波次迁移的插件在 `packages/plugins/__tests__/` 下编写对应的 vitest 单元测试，直接调用 `serviceRegistry.resolve` 进行指令与事件的 100% 覆盖率验证。
- **D-15:** 所有内置插件在 Manifest 中明确声明 `version: "1.0.0"`，并在 `requires` 中标明核心依赖 Token 的 SemVer 版本范围（如 `@openlearn/core:ICommandBusService@^1.0.0`），以全面启用语义化版本校验。

### the agent's Discretion
- **D-16:** 插件模块的具体包结构设计、单元测试的 Mock 策略、打包脚本的压缩等级与缓存机制，均由开发助手自主决定。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Platform Interfaces & DI
- [packages/core/di/interfaces.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/di/interfaces.ts) — 核心服务接口定义与 Token 实例声明。
- [packages/core/di/service-registry.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/di/service-registry.ts) — ServiceRegistry 依赖注入容器注册与解析规则。

### Plugin Host Lifecycle & Middleware
- [packages/core/plugin-host/index.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) — PluginHost 插件安装、激活、停用、卸载生命周期。
- [packages/core/plugin-host/middleware.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/middleware.ts) — 洋葱模型中间件组合 `compose()`。
- [packages/core/plugin-host/resource-tracker.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/resource-tracker.ts) — 插件 disposables 的 snapshot 与 reap 资源清理逻辑。

### Sandbox Isolation & Transport
- [packages/core/worker-runtime/](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/) — Worker Thread 执行环境基础。
- [packages/core/plugin-host/service-proxy.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/service-proxy.ts) — 跨边界 RPC 代理与能力校验。

### Database Schema
- [packages/core/db/index.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) — 包含 plugins 等 30+ 数据表的建表及初始化。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ServiceRegistry` / `kernelContainer.serviceRegistry`: 所有的插件现在都需要把自身的接口 Token 注入其中，或者从中解析依赖。
- `PluginHost` / `kernelContainer.pluginHost`: 提供标准的 `installPlugin()`、`activatePlugin()`、以及 `registerMiddleware()` 接口。
- `jszip`: 项目中已包含该 NPM 依赖，构建 ZIP 插件包时应复用它进行内存或流式压缩。

### Established Patterns
- **洋葱模型中间件**：在 `activate` 和 `deactivate` 被包裹，用于插入各种 Hook 处理器。
- **Token 命名规范**：遵循 `@openlearn/core:IServiceName` 形式，所有依赖插件的 `manifest.requires` 必须严格匹配此格式加上 `@^1.0.0` 版本后缀。
- **Disposable 模式**：插件的 `deactivate()` 或是 `deactivate` 中间件中通过 `ResourceTracker` 来释放命令监听、事件订阅和定时器。

### Integration Points
- `packages/core/kernel/index.ts`: 注入系统插件自动加载逻辑的入口。
- `packages/plugins/`: 各个内置与外部插件的开发及测试根目录。
- `package.json` 中的 `scripts.build`：插入调用 `scripts/build-plugins.mjs` 打包 ZIP 的阶段。

</code_context>

<specifics>
## Specific Ideas

- VFS 和 Process 作为底层系统插件，它们的功能是整个 VFS 和 Process 操作的基石。在重构它们的代码时，应当极其注意保持对外导出的 Command 结构与 Payload 字段不变，以防 Express 部分发生任何运行时故障。

</specifics>

<deferred>
## Deferred Ideas

- 前端微前端架构改造 (微前端 App.tsx 拆分) -> 已明确在 Phase 9 或之后阶段进行独立开展。
- 数据库迁移管理系统的正规化 -> Out of scope，目前依然沿用 `try/catch ALTER TABLE` 的加固升级模式。

</deferred>

---

*Phase: 08-migration*
*Context gathered: 2026-06-19*
