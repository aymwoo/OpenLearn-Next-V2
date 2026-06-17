# 项目研究摘要

**项目:** OpenLearnV2 插件系统重构
**领域:** JupyterLab 风格 Token DI + ESM 动态加载 + Worker Thread 隔离
**研究日期:** 2026-06-17
**置信度:** HIGH

## 执行摘要

本项目是对教育操作系统（LMS）插件运行时的一次彻底重构。当前系统使用 Node.js 的 `vm.createContext` 模块执行插件代码，但 `vm` 模块已被官方标记为"仅用于可信代码"，存在原型链逃逸等安全隐患，且无法在浏览器端运行。重构目标是以 JupyterLab 的 Token DI 架构为蓝本，使用 ESM 动态导入（`import()`）替代 `vm`，用 Worker Thread 实现真正的进程级隔离，并确保同一套插件 API 在 Node.js 服务端和浏览器前端均可运行。

研究结果表明：最佳方案是**自建轻量 Token DI 容器**（仅约 50 行核心逻辑，远优于引入 Awilix/TSyringe/Inversify 等重量级 IoC 框架），配合 `import-module-string` 实现跨运行时 ESM 加载，使用 `web-worker` polyfill 统一 Node.js Worker Thread 和浏览器 Web Worker 的 API 差异。最关键的发现是：Blob URL + `import()` 在 Node.js 端**不可用**（仅支持 `file:` 和 `data:` 协议），因此必须采用**双运行时分层策略**——浏览器端使用 Blob URL，Node.js 端使用 data: URL 或临时文件方案。这个发现直接改变了架构的加载层设计。

关键风险有五项：(1) Token 版本兼容的"幻影"不匹配——不同 bundle 的同一 Token 对象引用不同，(2) Worker 隔离导致同步 API 静默变为异步——现有插件逻辑将破坏，(3) 跨 Worker 边界的函数不可序列化，(4) 热重载时旧副作用未清理导致状态泄漏，(5) data: URL 内不支持相对 import——多文件插件包需要预打包。每项风险都有明确的预防策略和恢复方案。

## 关键发现

### 推荐技术栈

基于 STACK.md 的研究，核心技术选型如下：

**核心依赖（新增）：**
- **自定义 `Token<T>` + `PluginRegistry`**: 类型安全的依赖注入核心。JupyterLab 的 `@lumino/coreutils` Token 设计优秀但完整引入依赖爆炸。自建 Token 约 20 行，PluginRegistry 约 30 行，完全覆盖需求。比 Awilix（不支持异步激活）、TSyringe（装饰器地狱）、Inversify（30KB 太重）都更适合插件系统的精确需求。
- **`zod@^4.4`**: Runtime 类型验证。v4 性能提升 3-5 倍，用于 manifest schema 校验和 RPC 参数/返回值验证。
- **`semver@^7.8`**: 语义化版本范围检查。`semver.satisfies()` 一行搞定 `requires` 中的 `^1.0` 匹配。
- **`import-module-string@^2.0`**: 跨运行时 ESM 字符串执行。浏览器端用 Blob URL，Node.js 端用 data: URL，屏蔽运行时差异。
- **`web-worker@^1.5`**: 浏览器 Worker API 在 Node.js `worker_threads` 上的 polyfill。统一 `new Worker()` + `postMessage` API。
- **`chokidar@^5.0`**: 插件源码变更检测（热重载）。v5 全新架构，性能大幅优化。
- **`tiny-invariant@^1.3`**: 运行时断言，~200B gzipped，TypeScript 类型收窄。
- **`glob@^13.0`**: 多文件插件目录内文件发现，构建 import map。

**绝对不使用的：**
- `@lumino/coreutils`（完整引入）— 依赖爆炸，仅需 Token 类
- `vm.createContext` — 要被替换的目标，Node.js 标记为不安全
- `eval()` / `new Function()` — 无 ESM 支持
- 装饰器 DI（TSyringe/Inversify）— 异步激活不可用，与 `moduleResolution: bundler` 冲突
- 每个 Worker 持有独立 SQLite 连接 — 多 Worker 写同文件导致 `SQLITE_BUSY`，主线程代理是正解

### 预期功能

**必须有（Table Stakes）：**
- Token 依赖注入（DI）— 整个架构基石，通过 `requires`/`optional` 声明依赖
- `activate(ctx)` / `deactivate()` 生命周期 — 插件标准入口和出口
- 扩展点注册模式 — 6 个核心 Service（CommandBus、EventBus、ActionRegistry、Storage、AI、CapabilityGuard）Token 化
- 命令注册与执行、事件发布/订阅、持久化存储 — 基于现有子系统，仅 Token 化接口
- 错误隔离 — 单插件激活失败不影响其他插件或基座
- 插件安装/卸载/启停 — 适配新加载机制
- 插件元数据（manifest.json）— 独立于源码的声明文件
- 多文件插件包（ZIP）— 支持复杂插件分发

**应该有（差异化竞争）：**
- 双运行时（Node.js + Browser）— 同一套插件代码跨平台运行
- 热重载 — 开发模式下源码变更自动重激活（JupyterLab 本身不支持）
- Worker 线程隔离执行 — 真正的进程级隔离
- Blob URL + `import()` ESM 加载 — 标准的模块化加载
- 语义化版本兼容（SemVer Token）— JupyterLab 无此特性
- 全局事件总线服务 `IEventBusService` — 统一异步事件通道
- TypeScript 泛型 Token 类型推导 — 完整类型安全

**推迟到 v2+：**
- 激活中间件管道 — Phase 4，需 DI + CommandBus 稳定后
- 插件市场/商店 — 需要 CDN、审计、付费等基础设施
- 插件沙箱文件系统访问 — 安全灾难，用受控 Storage Service 替代
- 运行时动态注册新 Token（插件定义自己的 Token）— 导致 Token 冲突和激活顺序不确定
- CSS/UI 主题扩展 — 前端架构需先重构（App.tsx 11000+ 行）

**主动不做（Anti-Features）：**
- `autoStart: true` 全默认激活 — 用懒激活替代，避免启动时全量激活
- 插件执行用户传入的任意代码 — Worker 隔离 + 能力守卫 + 命令审批队列
- 跨插件同步通信（Shared State）— 所有跨插件通信通过 EventBus 和 Token Service

### 架构方案

系统分为三层：**DI 基础设施层**（ServiceRegistry + Token，完全不涉及插件加载）→ **插件运行时层**（PluginHost + 双模式 Sandbox + IPC 协议）→ **扩展能力层**（热重载 + 中间件管道 + 前端集成）。

核心组件：**ServiceRegistry**（Token → Service 的注册/解析/注销，基于拓扑排序激活）只负责 DI，不承担生命周期管理。**PluginHost** 负责插件生命周期（安装/激活/停用/卸载），支持两种执行模式——内联模式（内置可信插件，直接 import，零 IPC 开销）和 Worker 隔离模式（第三方插件，独立 Worker Thread + MessageChannel RPC 代理）。**Token 类**参考 Lumino 的泛型设计（`new Token<IService>('@openlearn/core:IService')`），但完全自实现避免依赖链。**IPC 协议**使用通用 invoke 协议（`token + method + args`），而非为每个方法定义独立消息类型。现有子系统（CommandBus、EventBus 等）保持内部实现不变，仅实现对应的 IService 接口并注册到 ServiceRegistry——向下兼容，渐进迁移。

架构关键约束：**主线程持有唯一 SQLite 连接**，Worker 不能直接访问 DB，所有 DB 操作通过 RPC 代理。**data: URL 限制**意味着多文件插件必须预先打包为单文件，或使用临时文件方案。

### 关键陷阱

1. **Blob URL import() 在 Node.js 中不可用**: 仅支持 `file:` 和 `data:` 协议。必须在设计阶段采用双运行时分层策略——Node.js 端用 data: URL 或临时文件方案，浏览器端用 Blob URL。这是 PLUG-01（加载机制迁移）的设计阶段就必须解决的硬约束，不能假设 Blob URL 是通用的。

2. **Token 版本语义化兼容的"幻影"不匹配**: 不同 bundle 的同一 Token 对象引用不同（`===` 比较失败）。必须实现 Token 注册中心模式——插件通过字符串 key 查询 Token 而非直接 import，版本检查在 resolve 阶段进行，确保 `@openlearn/core` 是 singleton。

3. **同步 API 到异步消息传递的静默破坏**: Worker 隔离后所有跨边界调用变为异步。现有插件的同步调用代码（`const result = commandBus.execute(cmd)`）将获得 `Promise { <pending> }` 而非实际结果。必须在 Service 接口定义阶段明确标注所有方法为 async，并提供旧插件迁移文档。

4. **Worker 中函数的不可序列化**: `postMessage` 使用结构化克隆，函数/闭包/Proxy 全丢失。事件订阅需转换为消息转发模式，所有跨边界调用通过 callId 配对的 Promise 模式实现。

5. **热重载导致的状态丢失和副作用泄漏**: ESM 重新 import 导致模块级状态重置，旧副作用（setInterval、事件监听器）残留。必须实现 `dispose`/`accept` 生命周期，基座追踪插件创建的所有资源并自动清理，采用原子重载策略（新版本激活成功后才停用旧版本）。

## 对路线图的影响

基于组合研究，建议以下阶段结构：

### Phase 1: DI 内核 + 现有能力 Token 化
**理由:** Token DI 是整个架构的基石——所有其他能力（扩展点、生命周期、版本兼容）都依赖 Token DI 先建立。必须先铺设基础设施再谈插件加载。
**交付物:** Token 类实现、ServiceRegistry（拓扑排序激活、循环依赖检测、注册/解析/注销）、6 个 IService 接口定义 + Token 实例导出、现有子系统实现接口并注册到 ServiceRegistry。**不改变插件执行方式**，仍使用现有 vm 加载。
**使用技术:** 自定义 Token<T>、tiny-invariant（运行时断言）、zod（manifest 校验）、semver（Token 版本注册）。
**避免陷阱:** Pitfall 8（any 类型架空 DI）— Service 接口定义阶段就收紧类型，启用 ESLint `no-explicit-any: error`；Pitfall 2（Token 版本幻影不匹配）— Token 注册中心模式在设计阶段接入。

### Phase 2: ESM 加载 + 包格式 + IPC 协议
**理由:** 从 vm 迁移到 ESM 必须先完成 ZIP 包格式支持和 ESM 加载器。IPC 协议是 Worker 隔离的前提。这三者耦合紧密——加载机制和包格式必须一起设计。
**交付物:** ZIP 插件包格式（manifest.json + 入口文件 + 资源文件）、`import-module-string` 加载器（Node.js data: URL + 浏览器 Blob URL 双策略）、IPC 协议定义（通用 invoke 协议 + callId 配对 Promise 模式）、DB schema 扩展（新增 source_blob/manifest_json/token_requires/token_provides 等字段）。
**使用技术:** import-module-string、jszip（已有）、glob。
**避免陷阱:** Pitfall 1（Blob URL 不可用）— 设计阶段就确定双运行时策略；Pitfall 10（data: URL 内不支持相对 import）— 多文件插件打包为单文件或写临时文件方案。

### Phase 3: Worker 隔离 + 双运行时
**理由:** Worker 隔离依赖 Phase 2 的 IPC 协议和 ESM 加载器就绪。双模式架构（内联 + Worker）依赖 ServiceRegistry 可解析服务并为 Worker 创建 RPC 代理。这将实现架构的核心差异化能力。
**交付物:** PluginHost（插件生命周期管理器）、Node.js Worker Thread 沙箱（Sandbox-Node）、浏览器 Web Worker 沙箱（Sandbox-Browser）、RPC 服务代理层（Proxy-based IPC）、内联模式 vs Worker 模式决策逻辑、Worker 生命周期管理（全局 Registry、idle timeout、terminate 保护）。
**使用技术:** web-worker、worker_threads + MessageChannel。
**避免陷阱:** Pitfall 3（同步 API 静默变异步）— 所有 Service 方法明确标注 async，提供迁移指南；Pitfall 4（函数不可序列化）— 事件订阅转换为消息转发；Pitfall 7（Worker 资源泄漏）— 全局 Worker Registry + 生命周期绑定；Pitfall 9（CapabilityGuard 绕过）— Service Proxy 层统一添加能力检查。

### Phase 4: 热重载 + 语义化版本 + 类型推导
**理由:** 热重载是最上层能力——依赖 ESM 加载（Phase 2）、生命周期（Phase 3）、文件监控三个子系统。语义化版本兼容扩展 Token DI（Phase 1）。这三者一起构建完整的开发者体验。
**交付物:** chokidar 文件监控 + 自动重激活、Vite HMR WebSocket 通知前端、dispose/accept 生命周期钩子、副作用追踪器、原子重载（新版本成功才停用旧版本）、SemVer Token 版本注册表 + 激活时版本兼容检查、TypeScript 泛型 Token 完整类型推导。
**使用技术:** chokidar、Vite `import.meta.hot`、semver。
**避免陷阱:** Pitfall 5（热重载副作用泄漏）— 副作用追踪器 + dispose 钩子 + 原子重载；Pitfall 6（新旧系统双重行为）— 命令路由版本标记 + 优先级路由。

### Phase 5: 迁移 + 前端集成 + 扩展能力
**理由:** 前四个阶段建立了完整的基础设施。此阶段将现有内置插件迁移到新格式，并完成前端 PluginHost 和 Extension Points 的集成。激活中间件管道视时间情况决定是否入 Phase 5 或推迟到 v2。
**交付物:** 现有内置插件按新格式重写（builtin.ts、management.ts、vfs.ts 等）、过渡期兼容路由（modern handler 优先，legacy fallback）、前端 PluginHost + WebWorkerPool、前端 Extension Points（classroomTools[]/teacherTabs[]/studentViews[]）、激活中间件管道（视情况）、插件性能/资源监控。
**避免陷阱:** Pitfall 6（新旧系统双重行为）— 优先级路由 + 过渡期截止时间；Pitfall 11 相关（向下兼容）— 旧格式插件过渡期支持。

### 阶段排序理由

1. **Token DI 必须最先**— 所有其他能力（扩展点、生命周期、Worker 代理）都依赖 DI 容器。但 Phase 1 不碰插件执行方式，降低风险。
2. **ESM 加载必须在 Worker 隔离之前**— Worker 需要可用的代码加载机制（data: URL/Blob URL + import()），且 IPC 协议需先定义。
3. **Worker 隔离是架构的核心转折点**— 实现了从 vm 沙箱到真正线程隔离的迁移，同时支持双运行时。
4. **热重载和版本兼容是开发者体验层**— 依赖下层稳定，可在 Phase 3 之后并行开发。
5. **迁移和前端集成放在最后**— 确保新系统的 API 在迁移现有代码之前已经稳定。前端集成依赖后端 PluginHost 就绪。

### 研究标志

**需要深入研究的阶段：**
- **Phase 3（Worker 隔离 + 双运行时）**: 跨运行时 RPC 代理层的性能和可靠性需要在真实场景中验证。MessagePort 的背压处理、大量并发调用的序列化开销、Worker Pool 的调度策略都需要原型验证。
- **Phase 4（热重载）**: ESM 模块缓存失效策略、dispose 钩子的完备性、Node.js 端和浏览器端 HMR 的协调机制都有大量实现细节。

**标准模式（可跳过研究阶段）：**
- **Phase 1（DI 内核）**: JupyterLab Lumino Token 有完整的参考实现，拓扑排序和循环依赖检测是成熟的图算法，不需要额外研究。
- **Phase 2（ESM 加载 + 包格式）**: import-module-string 和 jszip 的 API 都有完善的文档，加载流程清晰。

## 信心评估

| 领域 | 信心 | 备注 |
|------|------|------|
| 技术栈 | HIGH | 所有推荐包都已确认最新版本和兼容性。Node.js Blob URL 限制已在 #47573 issue 中确认。替代方案（data: URL）在 Node.js v12.10+ 已稳定。 |
| 功能 | HIGH | 7 个来源交叉验证（JupyterLab 文档、VSCode 文档、现有代码分析），现有系统能力与目标能力有清晰的对照映射。 |
| 架构 | HIGH | 一手源码分析 + JupyterLab/VSCode 架构参考 + 明确的组件边界和集成策略。向下兼容方案清晰。 |
| 陷阱 | HIGH | 10 个陷阱全部引用具体 issue/source，每个有明确的预防策略和恢复方案。Node.js #47573 第一手确认了 Blob URL 限制。 |

**总体信心: HIGH** — 所有研究文件的来源质量均为 HIGH 为主，MEDIUM 来源交叉验证一致，无重大不确定项。

### 待解决的缺口

- **import-module-string 在大插件（>1MB）上的性能**: 当前研究未覆盖大模块的解析性能。需在 Phase 2 中做原型测试，确认 data: URL 长度限制和 acorn 解析开销。若发现问题，回退方案为写临时文件方案。
- **Worker Pool 的最优大小**: 研究建议 CPU 核心数 × 2 作为上限，但插件的工作负载特性（IO 密集型 vs CPU 密集型）会影响最优值。Phase 3 实现时需做基准测试。
- **多文件插件打包工具链**: 当前研究聚焦运行时加载，未详细设计插件开发者的构建工具链（如何将 `import './utils.js'` 的多文件插件打包为单文件）。Phase 2 中需补充开发者工具设计。
- **SharedArrayBuffer + Atomics 的浏览器可用性**: Pitfall 3 中提到的同步通信 fallback 方案依赖 COOP/COEP headers，在复杂部署环境可能受限。Phase 3 中需验证。

## 来源

### 一手来源（HIGH 信心）
- Node.js `worker_threads` 官方文档 — MessageChannel、Worker options
- Node.js `data:` URL ESM import 文档 — 从 v12.10.0 开始支持
- JupyterLab 插件系统架构（DeepWiki）— Token 模式、requires/optional/provides、拓扑排序
- Lumino Token 类设计 — `new Token<T>(name, description)` 泛型接口
- VS Code Extension Host 架构 — 独立进程隔离、激活事件
- 项目源码：`packages/core/plugin-runtime/index.ts`、`packages/core/kernel/index.ts` 等

### 二手来源（MEDIUM 信心）
- Node.js Blob URL import 限制 issue (#47573) — 确认不可用
- Node.js 跨线程 Blob URL issue (#46557) — 确认 per-thread 限制
- Node.js data: URL 相对 import issue (#51956) — 确认限制
- import-module-string GitHub — 跨运行时 ESM 加载方案
- ESM HMR 状态丢失 issue — 热重载副作用
- Figma 插件沙箱迁移（QuickJS Wasm）— 沙箱演进参考
- AstrBot SDK v4 迁移指南 — 向下兼容 shim 模式

### 三级来源（LOW 信心）
- npm-compare（awilix vs inversify vs tsyringe）— 聚合站点，但多个独立源一致
- Zod v4 announcement（InfoQ）— 新闻网站，但引用了官方 changelog
- VS Code deactivate timeout issue (#47881) — issue 讨论，非官方文档

---
*研究完成日期: 2026-06-17*
*可进入路线图制定: 是*
