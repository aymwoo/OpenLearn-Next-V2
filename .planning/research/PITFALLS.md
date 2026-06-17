# Pitfalls Research

**Domain:** JupyterLab 风格插件系统重构 — vm → Blob/ESM + Worker 隔离 + Token DI
**Researched:** 2026-06-17
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Blob URL import() 在 Node.js 中不被原生支持

**What goes wrong:**
设计决策文档计划使用 `Blob` → `URL.createObjectURL()` → `import(url)` 作为跨运行时（浏览器/Node.js）的统一动态 ESM 导入方案。但在 Node.js（包括 v20/v22/v23）中，`import(blobUrl)` 失败：
```
TypeError [ERR_INVALID_URL_SCHEME]: Only URLs with a scheme in: file and data are supported
```
这意味着整个"Blob URL import"核心方案在 Node.js 端完全不可用。浏览器端可以，但 Node.js 端不行。相关 issue（nodejs/node#47573）因无活动已关闭。

**Why it happens:**
Node.js ESM loader 仅支持 `file:` 和 `data:` 协议。尽管 Node.js 实现了 `URL.createObjectURL()` 和 `Blob` API，但 import 钩子未注册 `blob:` 协议处理器。另外，Blob URL 是 per-thread 的（nodejs/node#46557），这意味着即使支持，在 Worker Thread 中创建的 Blob URL 也无法从主线程访问，违反了 FileAPI spec 的 per-agent 共享要求。

**How to avoid:**
Node.js 端使用 **data: URL** 方案替代 Blob URL：
```typescript
const dataUrl = `data:text/javascript,${encodeURIComponent(pluginCode)}`;
await import(dataUrl);
```
data: URL 的 `import()` 从 Node.js v12.10.0 开始支持，成熟稳定。但需要处理以下限制：
1. **相对导入不可用**：data: URL 模块内不能 `import "./foo.js"`，所有依赖必须在编译时打包进单个入口文件，或仅允许导入 Node.js 内置模块（`import 'node:fs'`）
2. **node_modules 解析不可用**：data: URL 没有文件系统上下文，`import 'lodash'` 会失败
3. **大小限制**：大型插件代码可能接近 URL 长度限制（Node.js 约 512MB，浏览器 32MB pre-Firefox 137 / 512MB 之后）

**双运行时统一策略**：
- 浏览器端：使用 Blob URL + Worker（原生支持）
- Node.js 端：使用 data: URL + Worker Thread（需要 `--experimental-import-meta-resolve` 或 `worker_threads` 配合 `data:text/javascript` 的 worker script）
- 抽象统一接口层，根据 `typeof window !== 'undefined'` 选择策略

**Warning signs:**
- 在 Node.js 端测试 `import(blobUrl)` 立即报 `ERR_INVALID_URL_SCHEME`
- 在 Worker Thread 中测试 Blob URL 出现 `ERR_INVALID_URL`

**Phase to address:**
PLUG-01（插件加载机制迁移）— 必须在设计阶段就确定双运行时各自的加载策略，不能假设 Blob URL 是通用的。

---

### Pitfall 2: Token 版本语义化兼容的"幻影"不匹配

**What goes wrong:**
当插件声明 `requires: [ICommandBusService@^1.0]`，基座提供的是 `ICommandBusService@1.2.0`，理论上兼容。但实际运行时出现 `No provider for token: ICommandBusService` 错误。原因是：**Token 是 JavaScript 对象，DI 容器使用 `===` 严格引用相等比较**。当插件和基座各自 bundle 了不同版本的 Token 包时，两个 "相同的" Token 实际上是不同的对象引用。

这是 JupyterLab 社区最常见的问题之一，尤其发生在：
- 插件在开发期引用 `@openlearn/core@1.0.0` 中的 Token
- 基座运行 `@openlearn/core@1.2.0`（语义兼容但对象不同）
- 两个版本各自导出一个 `ICommandBusService` Token 对象
- 插件用 v1.0.0 的 Token 向 DI 容器查询 → 容器只有 v1.2.0 的 Token → 找不到

**Why it happens:**
JavaScript 的 Token 模式（`new Token('ICommandBusService')`）仅靠 `===` 比较，不依赖字符串名称。这是有意为之（防止名称冲突），但在版本共存场景下成了陷阱。Node.js 的模块缓存基于文件路径，不同 `node_modules` 路径下的同一包会被视为不同模块。

**How to avoid:**
1. **Token 注册中心模式**：基座导出一个全局 TokenRegistry，所有插件通过字符串 key 查询 Token：
   ```typescript
   // 不要：直接用 import 的 Token 对象
   plugin.requires = [importedToken]; // 如果是不同版本就废了
   
   // 要：通过基座的 TokenRegistry 获取
   const token = kernel.getToken('ICommandBusService@^1.0');
   ```
2. **版本解析时做包去重**：在应用入口处确保 `@openlearn/core` 是 singleton，不存在多版本
3. **Symbol.for() 作为后备**：Token 可以用 `Symbol.for('openlearn.token.ICommandBusService')` 跨模块共享，但牺牲了版本隔离能力
4. **语义版本检查在 resolve 阶段进行**：不依赖 Token 对象等同性来做版本检查。先按字符串 key 找到 Token，再检查提供者的版本是否满足范围

**Warning signs:**
- 插件安装成功但激活时报 `No provider for token`
- 同一 Token 的两个导入路径在运行时 `===` 比较结果为 `false`
- `node_modules` 中出现多个版本的 `@openlearn/core`

**Phase to address:**
PLUG-09（Token 语义化版本兼容）— 这是该阶段的直接工作内容。需要同时处理 Token 身份（对象引用）和版本兼容性两个维度。

---

### Pitfall 3: 同步 API 到异步消息传递的静默破坏

**What goes wrong:**
当前插件系统通过 `vm` 模块直接注入包装函数（如 `wrappedCommandBus.execute(command)`、`wrappedStorage.get(key)`），插件代码可以**同步**调用这些 API。迁移到 Worker Thread/Web Worker 隔离后，所有跨边界调用必须通过 `postMessage`，变成**异步**的。现有插件中的同步调用代码（如 `const result = commandBus.execute(cmd)`）在迁移后将获得 `Promise { <pending> }` 而非实际结果，在不报错的情况下产生逻辑错误。

**Why it happens:**
Worker Thread 的 postMessage 本质是异步消息传递。主机（主线程）和 Worker 之间没有任何同步通信通道。插件代码中任何依赖同步返回值的逻辑都会静默失败。这包括：
- `commandBus.execute()` → 从同步返回值变为返回 Promise
- `storage.get()` → 从同步键值读取变为返回 Promise
- `eventBus.emit()` → 从同步触发变为异步调度
- `process.spawn()` → 返回值从同步变为 Promise

从 Chromium PPAPI 和 VS Code 扩展主机的历史来看，这是插件 API 重构中最隐蔽的陷阱：编译器不会报错（`any` 类型），但运行时行为完全不同。

**How to avoid:**
1. **在兼容适配层做 async/await 包装**：
   ```typescript
   // Shim 层将 async 调用伪装成 sync 外观
   // 实际上插件代码必须在 async activate() 中使用 await
   ```
2. **为旧插件提供"表面同步"的代理模式**：
   - 使用 Worker + Atomics + SharedArrayBuffer 实现有限同步通信（仅用于简单键值读取）
   - 警告：`SharedArrayBuffer` 需要 COOP/COEP headers，在浏览器端复杂
3. **插件迁移文档明确标注所有 API 签名变更**：从同步变为异步的每个方法必须有迁移指南
4. **提供 lint 规则 / TypeScript 插件**：检测插件代码中对 DI 注入服务的非 await 调用
5. **运行时检测**：在所有代理方法中打印 warning，如果返回值是 Promise 但调用方没有 await

**Warning signs:**
- 旧插件迁移后行为不一致（某些操作"延迟"生效）
- 日志中出现 `UnhandledPromiseRejection`
- `any` 类型的返回值被当作具体值使用但实际上是 Promise

**Phase to address:**
PLUG-06（扩展点注册模式）和 PLUG-04（Token DI 系统）— 在定义 Service 接口时就必须将同步/异步语义明确化。

---

### Pitfall 4: Worker 中函数的不可序列化 — 回调地狱回归

**What goes wrong:**
当前插件系统直接向插件注入包装函数（`wrappedCommandBus.execute` 是一个真实的函数引用）。迁移到 Worker Thread 后，`postMessage` 使用结构化克隆算法——**函数、闭包、Proxy、类实例的原型链全部丢失**。这意味着：
- 不能传递回调函数给插件
- 不能传递事件监听器引用
- 插件注册的事件处理器（`eventBus.subscribe('lesson.created', handler)`）中 `handler` 不能直接跨边界传递

**Why it happens:**
Structured Clone Algorithm 是设计限制，不是 bug。Worker Thread 的 V8 isolate 独立于主线程，不能共享 JS 对象引用。所有通信必须是可序列化的纯数据。

**How to avoid:**
1. **代理模式 (Proxy Pattern)**：所有跨边界调用通过消息 ID 配对实现：
   ```
   插件调用 ctx.commandBus.execute({ type: 'lesson.create', payload: {...} })
   → 代理层生成 callId，postMessage 发送消息
   → 主线程收到消息，查找真实 commandBus，执行
   → 主线程 postMessage 返回 { callId, result }
   → 代理层 resolve Promise
   ```
2. **事件订阅转换为消息转发**：
   - 插件调用 `eventBus.subscribe('lesson.created')` 时，向主线程发送订阅消息
   - 主线程收到事件后，向 Worker 发送 `{ type: 'event', eventType: 'lesson.created', payload: {...} }`
   - Worker 内的事件代理层分发到已注册的处理器
3. **所有 API 定义必须是异步的**：包括事件订阅的处理器也返回 Promise

**Warning signs:**
- Worker 中收到 `undefined` 或 `null` 替代了预期的函数
- `postMessage` 抛 `DataCloneError`
- 事件监听器注册了但永远不被调用

**Phase to address:**
PLUG-03（双运行时 Worker 隔离）和 PLUG-07（全局事件总线服务）— 代理层必须在 Worker 隔离实现时一起构建。

---

### Pitfall 5: 热重载导致的状态丢失和副作用泄漏

**What goes wrong:**
实现插件热重载时，通过重新 `import(url)` 加载新代码。每次 re-import 都会：
1. **模块级状态丢失**：插件中 `let counter = 0` 的状态重置
2. **旧副作用未清理**：`setInterval`、事件监听器、打开的文件描述符残留
3. **事件总线双订阅**：旧版本插件注册的事件处理器仍在运行，新版本又注册一份，导致事件被处理两次
4. **数据库连接/事务泄漏**：未关闭的连接在 reload 后变成孤立的

这在 Vite HMR 社区和 `hot-esm` 项目中是被反复强调的核心问题。Vite 的 `module.hot.dispose()` 模式是解决此问题的标准方式。

**Why it happens:**
ESM 的 `import()` 只是重新执行模块顶层代码，Node.js 没有内置的模块卸载机制。旧的模块引用、闭包、定时器、事件监听器仍然存在于 JavaScript 堆中。

**How to avoid:**
1. **实现 dispose/accept 生命周期**：
   ```typescript
   interface HotReloadablePlugin {
     activate(ctx: PluginContext): Promise<void>;
     deactivate(): Promise<void>; // 必须实现，不仅仅是接口定义
     // HMR 专用
     hot?: {
       accept(): void;
       dispose(data: { state: unknown }): void;
     };
   }
   ```
2. **状态外置模式**：插件不应在模块顶层保存重要状态（命令处理器注册、数据库连接），这些都应在 `activate()` 中创建并注册到基座
3. **副作用追踪器**：基座在 `activate()` 时追踪插件创建的所有资源（定时器、事件订阅、Worker 子线程），在 reload 时自动清理
4. **deactivate 超时保护**：VS Code 给 deactivate 只有 ~5 秒。必须实现 hard timeout，超时后强制终止
5. **冷/热层分离**：
   ```
   冷层（不重载）：PluginContext、Token 注册表、EventBus 实例
   热层（替换）：插件模块代码、render 函数、样式模块
   ```
6. **原子重载**：新版本激活成功后才停用旧版本。如果新版本 `activate()` 抛异常，回滚到旧版本

**Warning signs:**
- 多次热重载后内存持续增长
- 同一个事件被处理多次
- 插件行为"累积"（上一次 reload 的状态影响下一次）

**Phase to address:**
PLUG-10（热重载）和 PLUG-05（生命周期钩子）— 生命周期钩子的设计必须预先考虑热重载场景，不能事后修补。

---

### Pitfall 6: 新旧插件系统并行期间的双重注入行为冲突

**What goes wrong:**
约束要求"渐进式：支持新旧插件系统并行运行过渡期"。但如果在过渡期间，旧系统通过 `wrappedCommandBus` 注册了一个 `lesson.create` handler，新系统通过 Token DI 的 `ICommandBusService` 也注册了一个 `lesson.create` handler，两个 handler 都会被调用，导致命令被重复执行（双写、双事件）。

**Why it happens:**
当前的 `CommandBus` 支持同一命令类型注册多个 handler（`Promise.all(handlerPromises)`）。新旧系统的 handler 都是有效的 handler，`CommandBus` 无从区分哪个是过渡期的哪个是正式的。

**How to avoid:**
1. **命令路由版本标记**：在 handler 注册时标记来源（`legacy` vs `modern`）
2. **优先级/独占模式**：如果一个命令类型有 modern handler，就跳过 legacy handler
3. **适配器代理而非并行注册**：
   ```typescript
   // 不是：新旧各注册一个 handler
   // 而是：旧插件 → 适配器 → 转换为新接口 → 注册到新系统
   ```
4. **过渡期路由策略**：基座在启动时检查每个命令类型，优先使用 new-style handler，仅在无 new-style 时回退到 legacy adapter
5. **清晰的弃用路径**：每个命令类型有明确的迁移截止时间，过渡期结束后移除 legacy adapter

**Warning signs:**
- 同一个命令执行后数据库出现两条相同记录
- 同一个事件触发两次
- 日志中同一命令被 legacy 和 modern handler 各处理一次

**Phase to address:**
PLUG-11（保留现有内置能力）— 迁移现有 `builtin.ts` 和 `management.ts` 时为每个能力显式定义过渡路由策略。

---

### Pitfall 7: Worker Thread 的资源泄露和僵尸 Worker

**What goes wrong:**
当前 `vm` 方案每次执行代码后上下文自动销毁（GC 回收）。Worker Thread 不会自动终止——每个 Worker 是独立的 V8 isolate + 事件循环，需要显式调用 `worker.terminate()`。如果插件系统在热重载或插件卸载时不清理 Worker，会导致：
- 每个插件残留一个运行中的 Worker（内存泄漏）
- 每个热重载后的旧版本插件留下一个孤立 Worker
- 事件循环未结束的 Worker（如 `setInterval` 插件）永久运行

**Why it happens:**
Worker Thread 的生命周期与创建它的线程解耦。`worker.terminate()` 发送终止信号但 Worker 可以拒绝。没有池管理的情况下，开发者很容易忘记清理。

**How to avoid:**
1. **工作池模式**：不按插件数量创建 Worker，而是用固定大小的 Worker Pool（Piscina 或自建）
2. **插件 → Worker 生命周期绑定**：
   ```typescript
   class IsolatedPlugin {
     private worker: Worker;
     async activate() { this.worker = new Worker(...); }
     async deactivate() { await this.worker.terminate(); }
     // dispose 模式兼容 HMR
     [Symbol.dispose]() { this.worker?.terminate(); }
   }
   ```
3. **空闲超时自动终止**：Worker 在 N 秒无消息后自动终止
4. **执行超时**：每个 `postMessage` 调用的 Promise 附带 `setTimeout` + `worker.terminate()`
5. **全局 Worker 注册表**：基座维护所有活跃 Worker 的引用，进程退出时统一清理

**Warning signs:**
- 进程的线程数持续增长
- 内存占用线性增长
- `ps` 或 Activity Monitor 看到不明线程

**Phase to address:**
PLUG-03（双运行时 Worker 隔离）— Worker 生命周期管理是隔离方案的核心部分，不能留到后续阶段。

---

### Pitfall 8: 现有 `any` 类型约定与 DI 泛型推导的断裂

**What goes wrong:**
当前代码库广泛使用 `any` 类型（如 `CommandHandler.execute(command: any)`、`EventSubscriber: (event: any) => any`、`catch (err: any)`）。Token DI 系统的核心价值之一是"类型安全"和"泛型推导"——`token<ICommandBusService>` 让 TypeScript 自动推导 `activate(ctx)` 中 `ctx.commandBus` 的类型。但如果 Service 接口内部仍然使用 `any`，整个类型安全收益被架空。

**Why it happens:**
`any` 是逃逸舱口。在没有严格类型检查（`tsconfig.json` 未启用 `"strict": true`）的代码库中，`any` 会传染：一个 `any` 参数让整个调用链失去类型检查。泛型 Token 的类型推导在遇到 `any` 时会退化为 `any`。

**How to avoid:**
1. **启用 TypeScript strict 模式**：至少 `"strict": true` 或逐步启用 `"noImplicitAny": true`、`"strictFunctionTypes": true`
2. **定义 PlatformCommand 泛型接口取代 `any`**：
   ```typescript
   interface PlatformCommand<T extends string = string, P = unknown> {
     type: T;
     payload: P;
     source?: string;
   }
   ```
3. **Token 接口明确定义**：每个 Service 接口的参数类型精确声明，不依赖 `any` 万能类型
4. **新代码零容忍 `any`**：ESLint 规则 `no-explicit-any: error` 对新系统代码强制执行
5. **渐进式类型收紧**：先在 Token DI 层提供精确类型，再逐步收紧 Service 实现

**Warning signs:**
- `ctx.commandBus.execute()` 的参数类型推断为 `any`
- IDE 不能提供自动补全
- 重构时 TypeScript 不报错但运行时挂掉

**Phase to address:**
PLUG-04（Token DI 系统）— 在定义 Service 接口时就确立类型边界。PLUG-06（扩展点注册）— 将现有能力 Token 化时收紧类型定义。

---

### Pitfall 9: CapabilityGuard 基于字符串的能力控制在新系统中的失效路径

**What goes wrong:**
当前 `CapabilityGuard` 基于字符串能力控制（如 `lesson:write`、`vfs:write_file`）。在 Token DI 系统中，插件通过 `requires: [ICommandBusService]` 声明依赖，获得整个服务实例。这破坏了细粒度能力控制——插件获得了 `ICommandBusService` 的全部能力，而非仅 `lesson:write` 子集。

**Why it happens:**
Token 粒度与能力粒度不匹配。一个 Service 可能暴露 20 个方法，但插件只应该访问其中 3 个。直接注入整个 Service 实例绕过了能力守卫。

**How to avoid:**
1. **能力级 Token 细分**：不是 `ICommandBusService` 一个 Token 通吃，而是 `ICommandBusService<'lesson:write'>` 这样的泛型受限 Token
2. **Service Proxy 包装**：注入的是 Proxy，在方法调用时检查 manifest 中声明的能力列表
   ```typescript
   const guarded = new Proxy(commandBus, {
     get(target, prop) {
       if (!pluginManifest.capabilities.includes(`command:${String(prop)}`)) {
         throw new CapabilityDeniedError(prop);
       }
       return target[prop];
     }
   });
   ```
3. **manifest 能力声明与 Service 方法映射**：插件 manifest 声明 `capabilities: ['lesson:write', 'vfs:read']`，基座在注入 Service 时自动创建受限视图

**Warning signs:**
- 插件声明只需 `ICommandBusService` 即可调用任何命令
- 高危操作审批队列（`pending_commands`）被绕过
- 插件可以访问 manifest 未声明的能力

**Phase to address:**
PLUG-04（Token DI 系统）配合 PLUG-11（保留现有能力）— Security 约束不能因为架构迁移而退化。

---

### Pitfall 10: data: URL 模块内不能 impor·相关模块导致插件组合能力丧失

**What goes wrong:**
当前插件系统允许插件内使用 `require()` 或简单的模块内联。在 Node.js 端使用 data: URL 方案后，data: URL 模块内不能使用相对 import（`import './utils.js'`），也不能 import `node_modules` 中的包，只能 import Node.js 内置模块。这意味着多文件插件包或依赖了第三方库的插件无法在 Node.js 端加载。

**Why it happens:**
data: URL 不是文件系统 URL，Node.js 的 ESM resolver 无法从 data: 基础 URL 解析相对路径。尝试 `import './foo.js'` from `data:text/javascript,...` 会报 `ERR_INVALID_URL`。

**How to avoid:**
1. **多文件插件打包为单文件**：插件上传时打包（bundle）为单个 ESM 模块文件，在编译期解决所有相对导入
2. **写临时文件方案**：对于生产环境，将插件代码写入临时 `.mjs` 文件再 import，原生支持所有模块解析
3. **插件 SDK 预打包外部依赖**：基座预导出常用库（lodash、dayjs 等），插件通过 Token 访问而非直接 import
4. **Worker 中使用文件系统方案**：Node.js 端不使用 data: URL，而是将插件写入临时目录，Worker 直接 import 文件
5. **分层策略**：
   - 开发模式（热重载）：写临时文件 → `import(url)` → 支持完整模块解析
   - 生产模式：插件预先 bundle 为单文件 → data: URL 或文件 import

**Warning signs:**
- 插件中 `import './helpers'` 抛 `ERR_INVALID_URL`
- 依赖了 lodash 的插件无法加载
- 多文件插件包构建成功但运行时报 import 错误

**Phase to address:**
PLUG-01（插件加载机制迁移）配合 PLUG-02（多文件插件包格式）— 加载机制和包格式必须一起设计，确保 Node.js 端的限制不影响浏览器端的使用。

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Token 接口使用 `any` 参数类型 | 快速定义 Service 接口 | 整个 DI 系统的类型推导失效，IDE 无法辅助 | 仅在原型阶段，必须在上线前收紧 |
| 跳过 Worker 生命周期管理（手动清理） | 少写 50 行代码 | 热重载/插件卸载后的内存泄漏，需重启进程 | 仅在单例插件且不热重载时 |
| 旧 plugin-activate 直接调用新 activate | 兼容层最少代码 | 双份命令处理器、双份事件订阅 | 仅在过渡期（<2 周），必须配合 handler 优先级路由 |
| Blob URL import 作为唯一方案 | 跨运行时 API 统一 | Node.js 不可用，需重构 | 永远不可接受，必须从一开始就设计双运行时策略 |
| Token 通过字符串 key 查找（绕过类型系统） | Token 版本问题立即可解 | 失去类型推导，Name 冲突风险 | 仅在 Token Registry 模式中使用，字符串 key 需命名空间保护 |
| postMessage 不设尺寸限制 | 简化消息协议 | DoS 攻击面、大文件传输 OOM | 永远不可接受，必须在消息入口处验证 |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Worker Thread 的 `workerData` 参数 | 试图传入函数、类实例、Proxy | 仅传入可序列化的纯数据（manifest、配置） |
| `postMessage` 大对象传输 | 依赖默认的结构化克隆（O(N) 复制成本） | 二进制数据使用 Transfer List `[buffer]`，文本保持 <1MB |
| data: URL 模块内 import | 在 data: URL 代码中使用相对 import | 预先 bundle 为单文件，或写临时文件方案 |
| Socket.IO 事件广播到 Worker | Worker 中直接 `require('socket.io-client')` | 通过主线程代理模式转发 Socket.IO 事件 |
| SQLite (better-sqlite3) 访问 | Worker 中创建独立 DB 连接 | 所有 DB 操作通过主线程代理，Worker 通过 postMessage 请求 |
| AI 服务调用 | 插件直接访问 `wrappedAI.generateText()` | 通过 `IAIService` Token 注入，基座做 API key 管理和 rate limiting |
| 新旧插件系统共享 CommandBus | 两个系统无条件注册到同一个 CommandBus | 使用优先级路由，modern handler 优先，legacy 作为 fallback |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 每个插件一个 Worker Thread | 10 个插件 → 10 个 V8 isolate → 数百 MB 内存 | Worker Pool 固定大小（CPU 核心数），插件在 Pool 中调度执行 | 5+ 插件同时激活 |
| postMessage 每次传完整数据集 | 插件间消息延迟线性增长 | 分页、增量更新、流式传输 | 数据 >1MB |
| 热重载时重新创建 Worker | 每次修改需 500ms+ 重建 V8 isolate | 复用 Worker Pool，仅重新 import 模块代码 | 开发频率 >10 次/分钟 |
| SharedArrayBuffer 无锁竞争 | `postMessage` 返回时数据已被另一个 Worker 修改 | 正确使用 Atomics.wait/notify/compareExchange | 多 Worker 共享状态时 |
| ESM import 缓存导致热重载不生效 | 修改插件代码后重新 import 结果同一份缓存 | 使用 `import(url + '?t=' + Date.now())` 或写临时文件 | 开发模式下第一次热重载即暴露 |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Worker Thread 中允许 `require('fs')` | 插件可读/删服务器文件 | 在 Worker 中全局变量去 `require`，仅通过 postMessage 传递能力 |
| Token 注入时不检查 manifest 能力声明 | 插件获得声明之外的能力访问 | 注入 Service 时使用 Proxy 做能力过滤 |
| 热重载时不重新验证 manifest | 修改后的插件可能新增未授权能力 | 每次热重载前重新校验 manifest + 能力列表 |
| Worker 消息序列化未设大小限制 | DoS：插件发送超大消息耗尽主线程内存 | 对所有 `postMessage` 入口做 payload size 硬限制 |
| data: URL 中的插件代码未经过完整性校验 | 数据库被篡改导致执行恶意代码 | 存储插件时附带 SHA-256 hash，加载时校验 |
| 插件 deactivate 超时后未强制终止 Worker | 恶意插件无限延迟 deactivate 阻止卸载 | deactivate 5 秒 hard timeout + `worker.terminate()` |
| 旧 vm 系统与新 Worker 系统共享能力守卫 | 一个绕过，两个都废 | 统一的安全检查层，在命令执行前校验，不依赖调用路径 |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 插件加载失败时静默失败，无错误上下文 | 插件开发者不知道哪里出问题 | 详细的错误链："manifest.json: 'requires' 字段的 Token 'ICommandBusService@^1.0' 在基座注册表中未找到" |
| 热重载后状态丢失无提示 | 插件开发者困惑为何数据重置 | 控制台明确提示 `[HMR] plugin X reloaded — module-level state has been reset` |
| 同步 API 变异步后无迁移指南 | 旧插件作者不知道需要 `await` | 每个破坏性变更附带 before/after 代码示例 |
| 插件卸载后持久化数据残留 | 用户以为数据已删除 | 卸载时询问是否同时清除持久化数据 |
| 版本不兼容的插件可以安装但无法激活 | 操作看起来成功但实际无效 | 安装时即检查 Token 版本兼容性，不兼容则拒绝安装 |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Plugin activate/deactivate**：常缺少 deactivate 中的资源清理（定时器、事件订阅、Worker）。验证：安装 → 启用 → 禁用 → 重新启用的完整循环，检查无双重事件处理
- [ ] **热重载**：常缺少旧模块的副作用清理（事件监听器泄漏）。验证：连续热重载 10 次，检查内存和事件处理次数
- [ ] **Token 版本兼容**：常缺少跨版本的 Token 身份验证。验证：用 v1.0.0 的 Token 包写插件，安装到 v1.2.0 的基座
- [ ] **双运行时**：常只在 Node.js 端测试，浏览器端全挂。验证：每个功能点分别在 Node.js 和浏览器环境各测一次
- [ ] **Worker 错误处理**：常忘记 attach `error` 和 `exit` 事件监听。验证：插件中 `throw new Error('test')`，确认主线程捕获并记录
- [ ] **能力守卫**：常只在"正常路径"加上检查。验证：插件直接调用未授权命令（绕过 TypeScript 类型），确认被拦截
- [ ] **向后兼容**：常只测新插件不测旧插件。验证：安装启用一个旧格式插件（vm 模式），确认功能正常
- [ ] **多文件插件**：常忽略相对 import 在 data: URL 中的限制。验证：含 `import './utils'` 的插件在 Node.js 端加载

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Blob URL 在 Node.js 不可用 | MEDIUM | 统一到 data: URL + 临时文件方案，接口层无需大改 |
| Token 版本幻影不匹配 | HIGH | 实现 Token Registry 模式，插件重新 build 引用基座导出的 Token |
| 同步 API 静默变异步 | HIGH | 旧插件需要逐个审查并添加 async/await，可能需要重新测试全部功能 |
| Worker 资源泄漏 | MEDIUM | 实现全局 Worker Registry，重启进程中清理；添加 idle timeout |
| 热重载副作用泄漏 | MEDIUM | 已有插件需实现 dispose 钩子，基座添加副作用追踪器 |
| 双重命令执行 | MEDIUM | 停用旧系统注册，添加优先级路由，审查所有命令类型 |
| 能力守卫失效 | HIGH | 在 Service Proxy 层统一添加能力检查，重新审计所有插件的 manifest |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Blob URL 不可用 | PLUG-01（加载机制） | Node.js 端 `import(pluginUrl)` 测试通过 |
| Token 版本幻影不匹配 | PLUG-09（版本兼容） | 不同版本 Token 包的插件能正确解析 |
| 同步 API 静默变异步 | PLUG-04/06（DI + 扩展点） | 所有 Service 方法明确标注 async |
| 跨边界函数序列化 | PLUG-03/07（Worker + EventBus） | postMessage 代理层通过回调测试 |
| 热重载状态丢失 | PLUG-05/10（生命周期 + HMR） | 连续热重载 10 次无副作用累积 |
| 新旧系统双重行为 | PLUG-11（保留能力） | 所有命令类型仅有单个 handler 执行 |
| Worker 资源泄漏 | PLUG-03（Worker 隔离） | 插件卸载后无残留 Worker/线程 |
| any 类型架空 DI | PLUG-04（Token DI） | `tsc --noEmit` 严格模式通过 |
| CapabilityGuard 绕过 | PLUG-04/11（DI + 能力保留） | 无授权插件无法调用越权命令 |
| data: URL 内 import 失败 | PLUG-01/02（加载 + 包格式） | 多文件插件在 Node.js 端正确加载 |

## Sources

- JupyterLab Plugin System token deduplication issues: https://github.com/jupyterlab/jupyterlab/issues/9640
- JupyterLab token identity problems: https://github.com/jupyterlab/jupyterlab-plugin-playground/issues/5
- JupyterLab semver compatibility proposal: https://github.com/jupyterlab/jupyterlab/issues/1011
- Node.js Blob URL import limitation: https://github.com/nodejs/node/issues/47573
- Node.js cross-thread Blob URL issue: https://github.com/nodejs/node/issues/46557
- Node.js data: URL import support: https://nodejs.cn/api/v22/esm/data.html
- Node.js data: URL relative import issue: https://github.com/nodejs/node/issues/51956
- Worker Thread security considerations: https://snyk.io/blog/node-js-multithreading-worker-threads-pros-cons/
- Worker + vm interop issue: https://github.com/nodejs/node/issues/56440
- ESM HMR state loss: https://github.com/FredKSchott/esm-hmr/issues/26
- hot-esm npm: https://www.npmjs.com/package/hot-esm
- dynohot deadlock and binding relinking: https://github.com/braidnetworks/dynohot
- VS Code deactivate timeout issue: https://github.com/microsoft/vscode/issues/47881
- VS Code uninstall lifecycle hook: https://github.com/microsoft/vscode/issues/45474
- Figma plugin sandbox migration to QuickJS Wasm: https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
- Axis Framework 6 async migration: https://docs.axoniq.io/axon-framework-reference/5.0/migration/
- NServiceBus async migration: https://docs.particular.net/nservicebus/upgrades/5to6/
- Backward compatibility shim pattern (Savga PhD thesis): https://www.virascience.com/document/050bdeb5ba4f7a6aaf71cf27803a3e79b1eec647/
- AstrBot SDK v4 migration with compatibility shim: https://deepwiki.com/united-pooh/astrbot-sdk/7.1-v4-migration-guide

---
*Pitfalls research for: JupyterLab 风格插件系统重构 — vm → Blob/ESM + Worker 隔离 + Token DI*
*Researched: 2026-06-17*
