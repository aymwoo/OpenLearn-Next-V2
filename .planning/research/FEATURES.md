# Feature Research

**Domain:** JupyterLab-style 插件系统（教育 OS / LMS 平台）
**Researched:** 2026-06-17
**Confidence:** HIGH

## Feature Landscape

### Table Stakes（用户预期必需）

插件系统的基础能力，缺失任何一个都会让人觉得系统不完整。

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Token 依赖注入（DI） | JupyterLab 的核心解耦机制，插件通过 `requires`/`optional` 声明依赖，由基座自动解析和注入 | HIGH | 需要实现 Token 注册表、拓扑排序激活、循环依赖检测。参考 Lumino `Token` 类的泛型设计 |
| `activate(ctx)` / `deactivate()` 生命周期 | 插件的标准入口和出口，`activate` 接收注入的依赖并初始化，`deactivate` 做清理（注销命令、取消事件订阅、释放资源） | MEDIUM | 当前系统已有隐式的 activate/deactivate 逻辑，但无标准接口契约 |
| 扩展点注册模式（Extension Points） | 将基座能力（CommandBus、EventBus、ActionRegistry、Storage、AI）抽象为 Token 标识的 Service，插件通过 Token 获取服务实例 | MEDIUM | 当前 `wrappedXxx` 模式本质是手动 DI，Token 化使其类型安全且可测试 |
| 命令注册与执行（CommandBus） | 插件注册命名空间命令处理器（如 `lesson.create`），基座路由命令到对应处理器执行 | LOW | 现有 CommandBus 已完整实现，只需 Token 化接口 |
| 事件发布/订阅（EventBus） | 插件订阅系统事件（如 `lesson.created`）并做出响应，支持通配符订阅 | LOW | 现有 EventBus 已完整实现，只需 Token 化接口 |
| 插件安装/卸载/启停 | 用户通过 UI 或 API 管理插件生命周期 | MEDIUM | 现有 `installPlugin`/`uninstallPlugin`/`togglePlugin` 已实现，需适配新加载机制 |
| 插件元数据（manifest） | `manifest.json` 声明 id、name、version、capabilities、依赖 | LOW | 当前嵌入在插件源码中，需独立为 manifest 文件 |
| 多文件插件包（ZIP） | 支持复杂插件（含资源文件、多模块、类型定义）以 ZIP 格式分发 | MEDIUM | 当前仅支持单 JS 字符串，需扩展包格式 |
| 持久化存储（Storage） | 插件可读写持久化的 KV 数据，数据与插件生命周期绑定 | LOW | 现有 `plugin_storage` 表已实现，Token 化即可 |
| 错误隔离 | 单个插件的激活失败或运行时错误不应影响其他插件或基座 | HIGH | 当前 vm 沙箱部分实现，Worker 隔离后更彻底 |

### Differentiators（竞争优势）

这些能力让本插件系统区别于简单的脚本执行环境，给插件开发者带来更好的体验。

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| 双运行时（Node.js + Browser） | 同一套插件 API 在服务端（Worker Thread）和浏览器端（Web Worker）均可运行，真正跨平台 | HIGH | 这是本轮重构的核心差异点。需要抽象跨运行时通信层（RPC proxy） |
| 热重载（Hot Reload） | 开发模式下修改插件源码后自动重新加载和激活，无需手动重装或重启服务 | HIGH | JupyterLab 本身也不支持（需整页刷新），这是超出 JupyterLab 的能力。需要文件监控 + 缓存失效 + 自动重激活 |
| 全局事件总线服务 `IEventBusService` | 统一的异步事件通道，插件无需单独注册扩展点即可订阅/发布事件。降低插件开发学习曲线 | MEDIUM | 相比 JupyterLab 需要了解多个 Token（ILabShell, INotebookTracker, IStateDB...），统一事件总线更简洁 |
| 语义化版本兼容（SemVer Token） | 插件声明依赖 Token 的版本范围（如 `ICommandBusService@^1.0`），基座在激活时检查版本兼容性 | HIGH | JupyterLab 无此特性。需要 semver 库 + Token 版本注册表 + 激活时匹配检查 |
| Worker 线程隔离执行 | 每个插件在独立 Worker 中运行，真正的进程级隔离而非 vm 沙箱（vm 已被 Node.js 标记为不安全） | HIGH | 补偿 Blob URL + import() 无沙箱的安全损失。需要 RPC proxy 模式 |
| Blob URL + `import()` ESM 加载 | 利用浏览器和 Node.js 原生 ESM 导入机制加载插件模块，支持标准的 `import`/`export` 语法 | MEDIUM | 取代当前 `vm.createContext` + `vm.Script.runInContext`，更安全且跨运行时兼容 |
| 激活中间件管道（Kernel Middleware） | 插件可注册拦截器/中间件，在命令执行、事件发布等关键节点插入自定义逻辑（类似 Express 中间件模式） | HIGH | JupyterLab 无此能力。可支持审计、日志、限流、权限检查等横切关注点 |
| TypeScript 泛型 Token 类型推导 | Token 携带完整类型信息：`Token<IService>` → `requires: [IMyService]` 自动推导参数类型 | MEDIUM | JupyterLab 的 Lumino Token 已有此设计，本项目可参考并改进（如更好的 API 命名） |

### Anti-Features（主动不构建的能力）

这些看似有用的能力会带来复杂度和维护负担。

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| 插件市场/商店（Plugin Marketplace） | 用户希望一键发现和安装插件 | 需要额外的服务端、CDN、审计、付费系统、恶意软件扫描等基础设施。当前阶段用户量不足以支撑 | 明确划为 Out of Scope。先用 ZIP 文件上传 + 手动安装满足需求 |
| 插件沙箱文件系统访问 | 插件想要直接读写服务器文件系统 | 安全灾难——恶意插件可读写任意文件、访问环境变量、窃取密钥 | 通过 Token 化的 Storage Service 提供受控的 KV 持久化；通过 CommandBus 执行受限的文件操作 |
| 跨插件同步通信（Shared State） | 插件希望直接修改其他插件的内部状态 | 破坏隔离性，使 deactivate 无法干净清理，导致内存泄漏和状态污染 | 所有跨插件通信通过 EventBus（异步通知）和 Token Service（方法调用）完成 |
| `autoStart: true` 的全默认激活 | 所有插件都希望自动激活 | JupyterLab 中大量插件注册 `autoStart`，导致启动时全量激活，拖慢启动时间 | 默认使用懒激活（lazy activation），仅在被其他插件依赖或显式调用时才激活 |
| 插件执行用户传入的任意代码 | "让插件变成一个 IDE" | 等同于 eval() 的无限权限——这是 `vm` 模块正在被解决的问题 | Worker 隔离 + 能力守卫（CapabilityGuard）+ 命令审批队列 |
| 运行时动态注册新 Token（插件定义自己的 Token） | 插件想要暴露新的扩展点给其他插件 | 导致复杂的依赖图、Token 冲突、激活顺序不确定性。JupyterLab 本身也面临这个问题 | Token 由基座定义和导出，插件只能消费不能注册新 Token。未来可在 V2 中考虑 |
| CSS/UI 主题扩展 | 插件想自定义平台外观 | 与当前前端架构（App.tsx 单体 11000+ 行）耦合太深，需要微前端拆分先行 | 划为独立阶段。前端重构后再考虑 |

## Feature Dependencies

```
Token 依赖注入（DI）
    ├──requires──> activate(ctx) / deactivate() 生命周期
    │                 ├──requires──> 扩展点注册模式
    │                 │                 ├──requires──> 命令注册与执行（CommandBus）
    │                 │                 ├──requires──> 事件发布/订阅（EventBus）
    │                 │                 └──requires──> 持久化存储（Storage）
    │                 └──requires──> 错误隔离
    └──enhances──> TypeScript 泛型 Token 类型推导

Worker 线程隔离执行
    ├──requires──> Blob URL + import() ESM 加载
    │                 └──requires──> 多文件插件包（ZIP）
    └──enables──> 双运行时（Node.js + Browser）

全局事件总线服务 IEventBusService
    └──uses──> 事件发布/订阅（EventBus Token）

激活中间件管道
    └──extends──> 命令注册与执行（CommandBus）

语义化版本兼容
    └──extends──> Token 依赖注入（DI）

热重载
    ├──requires──> Blob URL + import() ESM 加载
    ├──requires──> activate/deactivate 生命周期
    └──requires──> 文件变更检测（chokidar/fs.watch）

插件安装/卸载/启停
    ├──requires──> activate/deactivate 生命周期
    └──requires──> 多文件插件包（ZIP）
```

### Dependency Notes

- **Token DI 是整个架构的基石**：所有其他能力（扩展点、生命周期、语义化版本）都依赖 Token DI 先建立
- **Blob URL ESM 加载是运行时迁移的关键路径**：从 vm 迁移到 ESM，必须先完成 ZIP 包格式支持和 ESM 加载器
- **Worker 隔离不是 DI 的前提**：DI 可以先在主线程实现然后包装到 Worker 中；反过来 Worker 必须先有 DI 才能注入代理服务
- **热重载是最上层能力**：依赖 ESM 加载、生命周期、文件监控三个子系统就绪
- **中间件管道是 CommandBus 的增强层**：底层命令执行不变，只是在执行链中插入中间件节点

## MVP Definition

### Phase 1：DI 内核 + 基础能力（v1）

最小可行插件系统——用新架构复现当前所有功能。

- [x] **Token 依赖注入系统** — 定义 Token、注册表、拓扑排序、循环依赖检测
- [x] **`activate(ctx)` / `deactivate()` 标准接口** — 插件必须实现的契约
- [x] **扩展点 Token 化** — 将现有 CommandBus、EventBus、ActionRegistry、Storage、ProcessManager、AI 封装为 Token Service
- [x] **命令注册与执行** — 通过 Token 化 CommandBus 使用
- [x] **事件发布/订阅** — 通过 Token 化 EventBus 使用
- [x] **持久化存储** — 通过 Token 化 Storage 使用
- [x] **错误隔离** — 插件激活失败不影响其他插件
- [x] **插件安装/卸载/启停** — 适配新加载机制

### Phase 2： ESM 加载 + Worker 隔离（v1.1）

从 vm 沙箱迁移到 ESM 模块加载，实现真正的线程隔离。

- [x] **多文件 ZIP 插件包支持** — manifest.json + 入口文件 + 资源文件
- [x] **Blob URL + `import()` 动态 ESM 加载** — 替代 vm.createContext
- [x] **Worker 线程隔离（Node.js Worker Thread）** — RPC proxy 模式
- [x] **浏览器端 Web Worker 隔离** — Comlink 或自研 RPC 层
- [x] **双运行时兼容** — 抽象统一的服务代理层

### Phase 3： 扩展能力（v1.2）

提升插件开发体验和系统可观测性。

- [x] **全局事件总线服务 `IEventBusService`** — 统一事件 API
- [x] **TypeScript 泛型 Token 类型推导** — 完整类型安全
- [x] **语义化版本兼容检查** — Token 版本范围匹配
- [x] **热重载** — 文件监控 + 自动重激活

### Phase 4：高级能力（v2）

锦上添花，需要在 Phase 1-3 稳定后构建。

- [x] **激活中间件管道** — 在 CommandBus 执行链中插入中间件
- [x] **插件性能/资源监控** — 每个 Worker 的 CPU/内存/网络使用报告
- [x] **现有内置插件迁移** — Quiz Component、Random Student Picker 等用新格式重写

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Token 依赖注入（DI） | HIGH | HIGH | P1 |
| activate/deactivate 生命周期 | HIGH | MEDIUM | P1 |
| 扩展点注册模式（Token 化） | HIGH | MEDIUM | P1 |
| 命令注册与执行（CommandBus） | HIGH | LOW | P1 |
| 事件发布/订阅（EventBus） | HIGH | LOW | P1 |
| 持久化存储（Storage） | HIGH | LOW | P1 |
| 错误隔离 | HIGH | HIGH | P1 |
| 插件安装/卸载/启停 | HIGH | MEDIUM | P1 |
| 多文件 ZIP 插件包 | MEDIUM | MEDIUM | P2 |
| Blob URL + import() ESM 加载 | HIGH | MEDIUM | P2 |
| Worker 线程隔离 | HIGH | HIGH | P2 |
| 双运行时兼容 | HIGH | HIGH | P2 |
| 全局事件总线服务 | MEDIUM | MEDIUM | P3 |
| TypeScript 泛型类型推导 | MEDIUM | MEDIUM | P3 |
| 语义化版本兼容 | MEDIUM | HIGH | P3 |
| 热重载 | MEDIUM | HIGH | P3 |
| 激活中间件管道 | LOW | HIGH | P4 |
| 插件性能监控 | LOW | MEDIUM | P4 |

## Competitor Feature Analysis

| Feature | JupyterLab (Lumino) | VSCode Extension | 我们的插件系统 |
|---------|---------------------|-----------------|--------------|
| Token DI | Token-based, `requires`/`optional`/`provides` | 无 DI, ExtensionContext 传递 | 同 JupyterLab，增加版本语义兼容 |
| 生命周期 | `activate(app)`, deactivate 提案中 | `activate(ctx)`, `deactivate()` (可选) | `activate(ctx)`, `deactivate()` (必需) |
| 扩展点 | 多 Token 注册（50+ 核心Token） | `package.json` `contributes` 声明 | Token Service 注册 + 统一 EventBus |
| 运行时隔离 | 单线程（浏览器） | 独立 Extension Host 进程 | Worker Thread / Web Worker |
| 热重载 | 不支持（需整页刷新） | 部分支持（调试模式） | 完整支持 |
| 插件格式 | npm 包 | .vsix | ZIP + manifest.json |
| 跨平台 | 浏览器 only | 桌面 only | Node.js + Browser |
| 中间件管道 | 无 | 无 | 支持（差异化能力） |
| 语义化版本 | 无 | 引擎版本声明（`engines.vscode`） | Token 级版本范围匹配 |
| 类型安全 | 通过泛型 Token | 通过 VS Code API 类型定义 | 通过泛型 Token（同 JupyterLab） |

## 现有系统能力对照

将当前 `plugin-runtime/index.ts` 中的能力映射到新系统。

| 当前能力 | 现状 | 目标 |
|---------|------|------|
| `wrappedCommandBus` | 手动创建安全包装函数，vm 沙箱内注入 | Token 化 `ICommandBusService` |
| `wrappedEventBus` | 手动创建安全包装，auto-source prefix | Token 化 `IEventBusService` |
| `wrappedActionRegistry` | 手动创建安全包装 | Token 化 `IActionRegistryService` |
| `wrappedProcessManager` | 手动创建安全包装 | Token 化 `IProcessManagerService` |
| `wrappedStorage` | 手动创建安全包装，SQLite KV | Token 化 `IStorageService` |
| `wrappedAI` | 手动创建安全包装，含 provider 选择逻辑 | Token 化 `IAIService` |
| `safeConsole` | 手动创建带前缀的 console proxy | 内置在插件宿主中 |
| `createSafeFunction` | 手动冻结原型链 | Worker 隔离自然消除此需求 |
| `CapabilityGuard` | 基于字符串的能力控制 | 保持不变，Token 化 `ICapabilityGuardService` |
| `deactivatePlugin` 清理 | 手动管理 registration list | `deactivate()` 标准接口 + 自动追踪 |
| 激活超时（5s） | `Promise.race` 实现 | `AbortSignal` + Worker `terminate()` |
| 插件元数据校验 | 手动检查 `manifest.id`/`manifest.name` | JSON Schema 校验 |

## Sources

- [JupyterLab Extension Developer Guide](https://jupyterlab.readthedocs.io/en/stable/extension/extension_dev.html) — 插件系统架构、Token DI、activate 签名
- [JupyterLab Common Extension Points](https://jupyterlab.readthedocs.io/en/4.4.x/extension/extension_points.html) — 命令面板、上下文菜单、状态栏、Launcher、设置、StateDB
- [Lumino IPlugin Interface](https://lumino.readthedocs.io/en/1.x/api/application/interfaces/iplugin.html) — `activate`/`deactivate`/`autoStart`/`requires`/`optional`/`provides`
- [Dynamic Extensions Reloading (Lumino #278)](https://github.com/jupyterlab/lumino/issues/278) — deactivate 生命周期提案、依赖图 DAG 处理
- [JupyterLab Plugin Manager (4.1+)](https://deepwiki.com/jupyterlab/jupyterlab/4.2-installing-and-managing-extensions) — 运行时插件的启用/禁用/锁定
- [VSCode Extension API](https://code.visualstudio.com/api) — 激活事件、贡献点、命令、菜单、视图、WebView、Disposable 模式
- [Comlink (Google Chrome Labs)](https://github.com/GoogleChromeLabs/comlink) — RPC over postMessage for Web Workers
- [es-module-shims](https://github.com/guybedford/es-module-shims) — Blob URL ESM 加载、CSP 兼容性
- [npm semver](https://www.npmjs.com/package/semver) — 语义化版本范围匹配 (`^1.0`/`~1.0`)
- 项目源码：`packages/core/plugin-runtime/index.ts`、`packages/core/kernel/index.ts` — 现有插件系统实现
- PROJECT.md — 已确认的 PLUG-01 到 PLUG-12 需求列表

---
*Feature research for: OpenLearnV2 插件系统重构*
*Researched: 2026-06-17*
