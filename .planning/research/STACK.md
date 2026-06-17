# Stack Research

**Domain:** 插件系统重构 — JupyterLab 风格 Token DI + ESM 动态加载 + Worker Thread 隔离
**Researched:** 2026-06-17
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | ~5.8 | 类型安全的 Token<Service> 接口定义 | 项目已在使用；Token 泛型的类型推导依赖严格的 ts 泛型支持 |
| Node.js | >=20 | 服务端运行时 | 已固化的基础设施；`import()`、`worker_threads`、`Blob` 三个关键 API 在 Node 20 LTS 中均已稳定 |
| React | ^19.0 | 前端 UI 框架 | 已在使用；浏览器端的插件容器需要将 React 组件作为扩展点暴露 |
| Vite | ^6.2 | 前端构建/HMR + 浏览器端 Blob 插件打包 | 已在使用；HMR 能力可直接复用于插件源码变更检测与重载 |

### 自定义 Token DI 容器（不自备框架，自行实现）

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| 自定义 `Token<T>` + `PluginRegistry` | — | 类型安全的依赖注入核心 | JupyterLab 的 `@lumino/coreutils` Token 类（v2.2.2）设计优秀但引入完整的 lumino 依赖链太重。核心逻辑仅 ~50 行：`Token<T>(name)` + `PluginRegistry` Map + 拓扑排序激活。**自建远优于引入 Awilix/TSyringe/Inversify**（见下文"不使用哪些"） |
| `zod` | ^4.4 | Runtime 类型验证（manifest schema、plugin API 参数校验） | v4 已经发布，性能大幅提升（高于 v3 3-5 倍），提供 `z.coerce`、`z.string().brand()` 等高级特性；用于插件 manifest 校验和 RPC 调用的参数/返回值验证 |
| `semver` | ^7.8 | 语义化版本范围检查（`ICommandBusService@^1.0` 匹配） | 事实标准库，npm 自用；`semver.satisfies()` 一行搞定 `requires`/`optional` 中的 `^1.0`、`>=2.0 <3.0` 等版本范围匹配 |
| `tiny-invariant` | ^1.3 | 运行时断言语义（`manifest.id` 非空、`activate` 是函数等） | 零依赖，~217B gzipped；TypeScript 类型收窄（`T | null` -> `T`），比手写 `if (!x) throw` 干净得多 |

### 插件加载：Blob URL + import() 双运行时桥接

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `import-module-string` | ^2.0 | 跨运行时 ESM 字符串执行（data: URL / Blob URL） | Zach Leatherman 维护，MIT 协议；v2.0 已移除 adapter 选项，API 简化；使用 `acorn` 解析（轻量级 ESM 解析器）。**核心价值**：同一套 `importModuleString(pluginCode)` 调用在浏览器（Blob URL）和 Node.js（data: URL）均可工作，自动处理运行时差异 |
| 自定义 `ZipPluginLoader` | — | 多文件 ZIP 插件包的解压、入口定位、manifest 读取 | 利用现有 `jszip`（^3.10）解压 ZIP，读取 `manifest.json`，找到入口文件，构建带有依赖映射的 import map，打包为 Blob URL 供 `import()` 加载 |

### Worker Thread 隔离

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `web-worker` | ^1.5 | 浏览器 `Worker` API 在 Node.js `worker_threads` 上的 polyfill | Jason Miller（Preact 作者）维护，Apache-2.0 协议，~760k 周下载量；提供 `new Worker(url, { type: 'module' })` 的统一 API，支持 `onmessage`、`addEventListener`、`postMessage` DOM 风格 API。**核心价值**：让 Worker Thread 隔离的插件宿主代码在 Node.js 和浏览器间完全一致 |
| `worker.postMessage` + `MessageChannel` | 内置 | Worker RPC 通信主干 | Node.js `worker_threads` 和浏览器 `Worker` 均支持。使用 `MessageChannel` 建立主线程与 Worker 之间的双工通信管道，通过 Promise-per-call（callId 映射）模式实现异步 RPC |

### SQLite 数据层（不变动）

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `better-sqlite3` | ^12.10 | 插件元数据 + KV 持久化存储 | 已在用；Worker Thread 隔离架构下，**每个 Worker 不能直接访问主线程的 DB 连接**。正确模式：主线程持有唯一 DB 连接，Worker 通过 RPC（`postMessage`）请求数据库操作，主线程代理执行后返回结果。better-sqlite3 使用 SQLite 多线程模式，多连接安全但不共享连接对象 |

### 热重载支持

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `chokidar` | ^5.0 | 文件系统监听（Node.js 端插件源码变更检测） | 事实标准文件监控库；v5 全新架构，性能大幅优化；监控 `plugins/` 目录，检测 `.ts/.js/.json` 变更后触发重载 |
| Vite `import.meta.hot` | 内置 | 浏览器端 HMR 插件重载 | Vite 6 内置；开发模式下插件源码变更自动触发热更新 |

### 插件打包与分发

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `jszip` | ^3.10 | ZIP 插件包创建/读取 | 已在用；插件以 ZIP 包（manifest.json + 入口 .js + 可选资源）形式分发，运行时解压读取 |
| `glob` | ^13.0 | 插件目录内文件发现（多文件插件的文件清单） | 轻量级，用于扫描插件目录中所有 `.ts/.js` 文件，构建 Blob URL 加载所需的 import map |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript `noEmit: true` | 仅类型检查 | 保持现有 tsconfig 配置 |
| `tsx` ^4.21 | 开发时 TypeScript 直接运行 | 保持现有 |
| `esbuild` ^0.25 | 生产构建（server.ts -> dist/server.cjs） | 保持现有；插件 Worker 脚本也可用 esbuild 打包为单文件 ESM |
| Vite HMR | 前端热更新 | 保持现有，可复用为插件浏览器端热重载 |

## Installation

```bash
# 新增核心依赖
pnpm add zod@^4.4 semver@^7.8 tiny-invariant@^1.3 import-module-string@^2.0 web-worker@^1.5 chokidar@^5.0 glob@^13.0

# 现有依赖不变
# pnpm add jszip@^3.10  # 已有
# pnpm add better-sqlite3@^12.10  # 已有
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| 自定义 Token<T> + PluginRegistry | Awilix（^13.0） | 如果需要装饰器风格注册、请求级作用域容器、配置对象注入等完整 IoC 功能，Awilix 是首选。但插件系统需要的是**轻量 Token 注册 + 拓扑排序激活**，不是通用 IoC |
| 自定义 Token<T> + PluginRegistry | TSyringe（Microsoft） | 如果团队习惯装饰器 DI 且需要反射注入。但 TSyringe 不支持异步激活（`await container.resolve()` 不可用），而插件激活必然是异步的（Worker 通信、DB 访问） |
| 自定义 Token<T> + PluginRegistry | Inversify | 功能最全但最重（~30KB min+gzip），需要 `reflect-metadata` + `experimentalDecorators`。插件系统不需要其复杂绑定规则，杀鸡用牛刀 |
| import-module-string ^2.0 | `vm.Module`（Node.js） | 如果**仅** Node.js 运行时，`vm.Module` 有更好的隔离性。但需要双运行时，`vm.Module` 浏览器不可用 |
| import-module-string ^2.0 | 手写 `import(data:...)` | 如果是简单场景不介意自行处理 URL 编码和错误映射。但 `import-module-string` 处理了 `import.meta.url` 模拟、相对路径导入、acorn 解析等边缘情况，省去大量细节 |
| web-worker ^1.5 | 手写 `worker_threads` + `Worker` 桥接层 | 如果包体积极度敏感且愿意自行处理两种 API 的差异（DOM 事件 vs 原生回调、`parentPort` vs `self`）。本项目"双运行时"是核心需求，`web-worker` 的抽象是必要投资 |
| chokidar ^5.0 | `fs.watch` | 如果不需要递归监控。但插件目录嵌套复杂，`fs.watch` 在不同平台上的行为不一致，chokidar 是标准解 |
| semver ^7.8 | 手写 `satisfies()` 逻辑 | 如果只需简单 `>=` 比较。但语义化版本范围匹配（`^1.0`、`~2.0.0`、`>=3.0 <4.0`）有大量边缘情况，semver 是 npm 生态的基础设施 |
| zod ^4.4 | 手写类型守卫 | 如果 schema 简单且不需要 JSON Schema 导出。但插件 manifest、RPC 调用参数、服务接口等需要可序列化的 Schema 定义，zod 可兼做运行时验证和类型推导 |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@lumino/coreutils`（完整引入） | Token 类本身极简（~15 行），但引入整个 `@lumino/*` 生态链（application、widgets、commands 等）依赖爆炸。我们只需要 `Token<T>` 和 PluginRegistry 模式，不是整个 JupyterLab 前端框架 | 自定义 `Token<T>`（~20 行） + `PluginRegistry`（自建容器） |
| `vm.createContext` + `vm.Script.runInContext` | **这是我们要替换掉的**。Node.js 官方标记为"仅用于可信代码"，原型链逃逸风险高，浏览器不可用 | `import-module-string`（ESM import）+ Worker Thread 隔离 |
| `eval()` / `new Function()` | 无 ESM 支持（没有 `export`/`import`），无法加载模块化插件代码；无法限制全局作用域污染 | `import('data:...')` / `import('blob:...')` |
| `async_hooks` / `domain` | Node.js 废弃 API，与 Worker Threads 体系不兼容 | Worker Thread 隔离 + MessageChannel RPC |
| `Reflect.metadata` + 装饰器 DI | 需要 `experimentalDecorators` + `emitDecoratorMetadata`，与项目现有 `moduleResolution: bundler` 可能有冲突；异步激活不可用（装饰器不可异步） | 自定义 `Token<T>` + 手动注册模式，完全显式，零魔法 |
| 每个 Worker 持有独立 `better-sqlite3` 连接 | `better-sqlite3` 使用 WAL 模式 + 多线程模式是安全的，但**多个 Worker 写同一个数据库文件**会导致 `SQLITE_BUSY` 或锁升级。项目不需要多 Worker 并行写 | 主线程持有唯一 DB 连接，Worker 通过 RPC 代理访问 |
| `@cloudpss/worker` / `threadop` 等高级 Worker 池 | 插件系统每个插件一个 Worker 实例，生命周期明确（activate/ deactivate），不需要动态线程池和自动伸缩 | `web-worker` 的一对一 Worker 模型足够 |

## Stack Patterns by Variant

**如果 Worker 线程需要调用插件 API（AI 生成、存储读写）：**
- 使用 `MessageChannel` RPC 模式，主线程暴露 `{ storage, ai, db, eventBus }` 等 Tokenized Service 的代理
- 每个 RPC 调用带有唯一 `callId`，Worker 端 `await` 等待主线程执行完成并返回
- 主线程端对所有 RPC 调用执行能力检查（`CapabilityGuard`）

**如果插件不需要 Worker 隔离（内置信任插件）：**
- 直接在主线程通过 `import-module-string` 加载
- Token DI 解析和激活在主线程执行
- 跳过 `postMessage` 序列化开销

**如果浏览器端（前端插件，后续阶段）：**
- 使用 `import-module-string` 的 Blob URL 路径（浏览器原生支持）
- Web Worker 替代 Worker Thread
- `web-worker` 提供统一 API，无需改代码

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| zod@^4.4 | TypeScript>=5.0 | Zod v4 需要 TS 5.0+，项目满足 |
| web-worker@^1.5 | Node.js>=12.8（module workers） | Node 20 完全支持，无兼容性问题 |
| import-module-string@^2.0 | Node>=18, Chromium>=80, Firefox>=67, Safari>=15 | v2.0 移除了 adapter 选项，更简洁 |
| chokidar@^5.0 | Node>=18 | 项目 Node 20，满足 |
| semver@^7.8 | 无特殊要求 | 纯 JS，零 System 依赖 |
| tiny-invariant@^1.3 | 无特殊要求 | 纯 JS，~200B gzipped |
| jszip@^3.10 | 已在使用 | 不变动 |

## Sources

- [import-module-string npm page](https://www.npmjs.com/package/import-module-string) — v2.0.3 最新版本，NPM registry API 查询确认
- [web-worker npm page](https://www.npmjs.com/package/web-worker) — v1.5.0 最新版本，NPM registry API 查询确认
- [@lumino/coreutils npm page](https://www.npmjs.com/package/@lumino/coreutils) — v2.2.2 最新版本，NPM registry API 查询确认
- [semver npm registry](https://www.npmjs.com/package/semver) — v7.8.4 最新版本，NPM registry API 查询确认
- [zod npm registry](https://www.npmjs.com/package/zod) — v4.4.3 最新版本，NPM registry API 查询确认
- [tiny-invariant npm page](https://www.npmjs.com/package/tiny-invariant) — v1.3.3 最新版本，NPM registry API 查询确认
- [awilix npm registry](https://www.npmjs.com/package/awilix) — v13.0.5 最新版本，NPM registry API 查询确认
- [chokidar npm registry](https://www.npmjs.com/package/chokidar) — v5.0.0 最新版本，NPM registry API 查询确认
- [glob npm registry](https://www.npmjs.com/package/glob) — v13.0.6 最新版本，NPM registry API 查询确认
- [better-sqlite3 thread safety issue #1138](https://github.com/WiseLibs/better-sqlite3/issues/1138) — 确认多线程模式合理使用方式（MEDIUM confidence）
- [Node.js worker_threads 官方文档](https://nodejs.org/api/worker_threads.html) — MessageChannel、Worker options（HIGH confidence）
- [JupyterLab Plugin System DeepWiki](https://deepwiki.com/jupyterlab/jupyterlab/3.2-plugin-system) — Token 模式、requires/optional/provides、拓扑排序（MEDIUM confidence，第三方 Wiki 但直接引用源码）
- [npm-compare: awilix vs inversify vs tsyringe](https://npm-compare.com/awilix,inversify,tsyringe) — DI 库对比（LOW confidence，聚合站点，但多个独立源一致）
- [zod v4 announcement](https://www.infoq.com/news/2025/08/zod-v4-available/) — Zod v4 特性与性能提升（LOW confidence，新闻网站，但引用了官方 changelog）

---
*Stack research for: 插件系统重构 — JupyterLab 风格 Token DI + ESM 动态加载 + Worker Thread 隔离*
*Researched: 2026-06-17*
