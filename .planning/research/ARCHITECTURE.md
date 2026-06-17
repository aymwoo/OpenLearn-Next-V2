# 架构研究：JupyterLab风格插件系统

**领域：** 教育操作系统插件架构重构
**研究日期：** 2026-06-17
**置信度：** HIGH

## 推荐架构

### 系统全景

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          前端 SP（浏览器运行时）                                 │
│  React 19 + Vite 6                                                           │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │  PluginHost (前端)    │  │  Web Worker Pool      │  │  现有 UI 组件         │ │
│  │  ServiceRegistry     │  │  (per-plugin 隔离)     │  │  (不变)               │ │
│  │  TokenResolver       │  │  import(blobUrl)       │  │                      │ │
│  └─────────┬────────────┘  └──────────┬───────────┘  └──────────────────────┘ │
│            │                          │  MessagePort                          │
│            │   ┌──────────────────────┘                                       │
│            │   │                                                              │
│            ▼   ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                     前端 Extension Points                                │ │
│  │  classroomTools[]  teacherTabs[]  studentViews[]  QuickActions[]         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                        HTTP / Socket.IO
                                      │
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Express Server (后端运行时)                              │
│  server.ts — 路由、Socket.IO、认证                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                      OS Kernel (改造后) — kernelContainer                      │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐    │
│  │   ServiceRegistry    │  │            PluginHost Manager               │    │
│  │   (Token DI 容器)     │  │  ┌──────────────────┐  ┌──────────────────┐ │    │
│  │                     │  │  │  Worker Pool      │  │  Inline Mode     │ │    │
│  │  Token → Service     │  │  │  (Worker Thread   │  │  (trusted built- │ │    │
│  │  注册/解析/生命周期   │  │  │   per-plugin)     │  │   in plugins)    │ │    │
│  └──────────┬──────────┘  │  └────────┬─────────┘  └────────┬─────────┘ │    │
│             │              │           │                     │          │    │
│             │              │           │  MessagePort        │          │    │
│  ┌──────────┴──────────┐   │           ▼                     ▼          │    │
│  │  Tokenized Services  │   │  ┌──────────────────────────────────────┐    │    │
│  │  ┌───────────────┐   │   │  │        Plugin Sandbox                 │    │    │
│  │  │ ICommandBus    │   │   │  │  import(data:...) → activate(ctx)    │    │    │
│  │  │ IEventBus      │   │   │  │  deactivate() → cleanup              │    │    │
│  │  │ IActionRegistry│   │   │  │  manifest.json → Token 声明          │    │    │
│  │  │ IProcessManager│   │   │  └──────────────────────────────────────┘    │    │
│  │  │ IStorageService│   │   │                                              │    │
│  │  │ IAIService     │   │   └──────────────────────────────────────────────┘    │
│  │  │ ICapabilityGuard│  │                                                     │
│  │  └───────────────┘   │                                                     │
│  └──────────────────────┘                                                     │
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │              现有核心子系统（保持数据结构不变）                       │        │
│  │  CommandBus | EventBus | ActionRegistry | CapabilityGuard          │        │
│  │  ProcessManager | DB (SQLite)                                      │        │
│  │  ── 实现各类 IService 接口，注册到 ServiceRegistry                   │        │
│  └──────────────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    SQLite (better-sqlite3)                                    │
│  plugins 表扩展：+ source_blob (BLOB), + manifest_json (TEXT),                 │
│  + token_requires (TEXT), + token_provides (TEXT),                            │
│  + format_version (TEXT), + package_hash (TEXT)                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 职责 | 关键实现细节 |
|------|------|------------|
| **ServiceRegistry** | Token 依赖注入容器——注册/解析/注销所有 IService 实现 | 单例，替换当前的直接属性访问模式。基于 Topological Sort 的激活排序。循环依赖检测 |
| **PluginHost** | 插件生命周期管理器——安装、激活、停用、卸载、热重载 | 替代现有 PluginRuntime。支持两种执行模式：Worker隔离模式（第三方插件）、内联模式（内置可信插件） |
| **WorkerPool** | Node.js Worker Thread 池——管理 per-plugin Worker 实例 | worker_threads + MessageChannel。资源限制（maxOldGenerationSizeMb），超时终止 |
| **WebWorkerPool** | 浏览器 Web Worker 池 | `new Worker(blobUrl, { type: 'module' })`，结构化克隆通信 |
| **Token (类)** | 类型安全的服务标识符——`new Token<IService>('namespace:IService')` | 参考 Lumino Token 的简化自实现（避免引入 @lumino 依赖）。泛型携带服务接口类型 |
| **PluginManifest** | 插件元数据描述——id/name/version/token要求/提供/能力声明 | 对应 manifest.json 结构，替代现有松散 JSON |
| **PluginSandbox** | Worker内部执行环境——import代码、暴露安全的服务代理 | 通过 data: URL 加载插件代码。MessagePort 代理所有内核服务调用 |
| **内核服务接口层** | 现有子系统（CommandBus/EventBus 等）实现 Token 化接口 | 每个现有子系统实现一个 IService 接口并注册到 ServiceRegistry。向下兼容 |
| **ExtensionPoints** | 前端扩展点抽象——classroomTools/tabs/views 等基于 Token 注册 | 插件通过 Token 获取 IUIExtensionService 来注册 UI 扩展 |

## 推荐项目结构

```
packages/
├── core/
│   ├── kernel/index.ts                # Kernel — 仅组装（不变，但减少耦合）
│   ├── service-registry/index.ts      # ★ NEW: Token DI 容器
│   ├── service-registry/token.ts      # ★ NEW: Token<T> 实现
│   ├── services/                      # ★ NEW: Token 化接口定义
│   │   ├── interfaces.ts             # IService, ICommandBusService, IEventBusService...
│   │   └── tokens.ts                 # Token 实例导出（ICommandBusServiceToken 等）
│   ├── plugin-host/                   # ★ NEW: 替代 plugin-runtime/
│   │   ├── index.ts                  # PluginHost 主类
│   │   ├── manifest.ts              # PluginManifest 解析与验证
│   │   ├── sandbox-node.ts          # Node.js Worker Thread 沙箱
│   │   ├── sandbox-browser.ts       # 浏览器 Web Worker 沙箱
│   │   ├── ipc-protocol.ts          # Worker ↔ 主线程 IPC 协议定义
│   │   └── hot-reload.ts            # 热重载监视器（chokidar + WebSocket）
│   ├── command-bus/index.ts          # 实现 ICommandBusService
│   ├── event-bus/index.ts            # 实现 IEventBusService
│   ├── registry/index.ts             # 实现 IActionRegistryService
│   ├── capability-system/index.ts    # 实现 ICapabilityGuardService
│   ├── process-manager/index.ts      # 实现 IProcessManagerService
│   ├── storage/index.ts              # ★ NEW: 实现 IStorageService（提取自 plugin-runtime）
│   ├── ai/index.ts                   # ★ NEW: 实现 IAIService（提取自 plugin-runtime）
│   ├── db/index.ts                   # 扩展 plugins 表 schema
│   └── db/educational_os.db
├── plugins/                           # 内联插件（直接 import，非 Worker 隔离）
│   ├── builtin.ts                     # 改造：返回 PluginManifest + activate/deactivate
│   ├── management.ts
│   ├── vfs.ts
│   ├── process.ts
│   ├── ai-planner.ts
│   └── ai-submit-injector.ts
src/                                    # 前端
├── plugin-host/                        # ★ NEW: 前端插件宿主
│   ├── PluginHost.ts                  # 前端 ServiceRegistry + WebWorker 管理
│   ├── WebWorkerSandbox.ts            # 浏览器 Worker 封装
│   └── extension-points.ts            # 前端扩展点 Token 定义
├── services/                           # ★ NEW: 前端服务接口
│   └── browser-services.ts            # 浏览器特有服务（DOM API 等）
└── App.tsx                             # 从 PluginHost 获取 classroomTools 等
```

### 结构原则

- **`service-registry/`** 独立于 plugin-host/：DI 容器是核心基础设施，不耦合插件执行细节
- **`services/`** 分离接口定义与实现：接口在 `interfaces.ts` 和 `tokens.ts`，实现在各子系统模块中
- **`plugin-host/`** 拆分为多个职责单一的文件：避免现有 plugin-runtime/index.ts 的 517 行单一文件问题
- **`sandbox-node.ts` / `sandbox-browser.ts`** 分离运行时：相同 IPC 协议，不同传输实现
- **内联插件保持 `packages/plugins/`**：可信内置插件直接 import，无需 Worker 开销

## 架构模式

### 模式 1：Token 依赖注入（参考 JupyterLab Lumino Token）

**是什么：** 使用 `Token<T>` 类作为类型安全的服务标识符。插件在 manifest 中声明 `requires`（必需）和 `optional`（可选）的 Token 列表，由宿主在激活时将服务实例注入。

**何时使用：** 所有插件与内核服务的交互，包括 CommandBus、EventBus、ActionRegistry、ProcessManager、Storage、AI、前端扩展点。

**权衡：**
- 优点：编译时类型检查，显式依赖声明，可测试（mock Token），依赖图可视化，循环依赖检测
- 缺点：增加概念层，需要学习 Token 范式

**示例：**
```typescript
// packages/core/services/tokens.ts
import { Token } from '../service-registry/token.js';

// 定义服务接口
export interface ICommandBusService {
  execute<T>(command: PlatformCommand<T>): Promise<any>;
  registerHandler(type: string, handler: CommandHandler): void;
  unregisterHandler(type: string): void;
}

// 创建 Token（泛型携带接口类型）
export const ICommandBusServiceToken = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService',
  '命令总线服务 — 执行命名空间命令并路由到注册的处理器'
);

// 类似地定义所有服务的 Token
export const IEventBusServiceToken = new Token<IEventBusService>(
  '@openlearn/core:IEventBusService'
);
export const IActionRegistryServiceToken = new Token<IActionRegistryService>(
  '@openlearn/core:IActionRegistryService'
);
export const IStorageServiceToken = new Token<IStorageService>(
  '@openlearn/core:IStorageService'
);
export const IAIServiceToken = new Token<IAIService>(
  '@openlearn/core:IAIService'
);
export const ICapabilityGuardServiceToken = new Token<ICapabilityGuardService>(
  '@openlearn/core:ICapabilityGuardService'
);
export const IProcessManagerServiceToken = new Token<IProcessManagerService>(
  '@openlearn/core:IProcessManagerService'
);
```

```typescript
// 插件 manifest.json 中声明依赖
{
  "id": "@ext/quiz-generator",
  "name": "Quiz Generator",
  "version": "1.0.0",
  "requires": [
    "@openlearn/core:ICommandBusService",
    "@openlearn/core:IEventBusService",
    "@openlearn/core:IStorageService"
  ],
  "optional": [
    "@openlearn/core:IAIService"
  ],
  "capabilitiesProposed": ["lesson:write", "quiz:write"]
}
```

```typescript
// 插件 activate 接收注入的服务
export async function activate(ctx: PluginContext) {
  const { commandBus, eventBus, storage, ai } = ctx.services;
  // commandBus 类型自动推导为 ICommandBusService
  // ai 类型为 IAIservice | null（因为是 optional）
  commandBus.registerHandler('quiz.generate', {
    execute: async (cmd) => { /* ... */ }
  });
}
```

### 模式 2：Proxy-based IPC 服务代理

**是什么：** 在 Worker 线程中运行的插件代码不能直接访问内核服务。PluginHost 通过 MessagePort 提供代理对象：插件调用 `ctx.services.commandBus.execute(cmd)` 时，代理将调用序列化为 IPC 消息，主线程执行实际逻辑，结果返回。

**何时使用：** Worker 隔离模式（第三方插件）。内联模式（内置插件）不需要代理。

**权衡：**
- 优点：真正的内存隔离，Worker 崩溃不影响主线程，结构化克隆确保数据边界安全
- 缺点：额外的序列化开销，不能传递函数/类实例作为参数或返回值（结构化克隆限制）

**示例：**
```typescript
// plugin-host/ipc-protocol.ts — 协议消息定义
type IPCMessage =
  | { type: 'invoke'; id: string; token: string; method: string; args: any[] }
  | { type: 'result'; id: string; value?: any; error?: string }
  | { type: 'event'; token: string; eventType: string; payload: any };

// plugin-host/sandbox-node.ts — 创建服务代理
function createServiceProxy(token: string, port: MessagePort): any {
  return new Proxy({}, {
    get(_target, method: string) {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          const id = uuidv7();
          const handler = (msg: IPCMessage) => {
            if (msg.type === 'result' && msg.id === id) {
              port.off('message', handler);
              msg.error ? reject(new Error(msg.error)) : resolve(msg.value);
            }
          };
          port.on('message', handler);
          port.postMessage({ type: 'invoke', id, token, method, args });
        });
      };
    }
  });
}
```

### 模式 3：双层插件执行模式

**是什么：** 插件根据来源分为两种执行模式：
- **内联模式（Inline Mode）**：内置/可信插件在 `packages/plugins/` 中作为 TS 文件，直接 import 后调用 `activate(services)`，与内核共享同一 V8 隔离区。
- **Worker 隔离模式（Worker Mode）**：第三方插件在独立 Worker Thread 中执行，通过 IPC 代理访问服务。

**何时使用：**
- 内联模式：所有现有 `packages/plugins/*.ts`，以及任何通过 `npm install` 安装的受信任插件
- Worker 模式：用户通过插件中心 UI 上传/安装的第三方 `.zip` 插件包

**权衡：**
- 内联模式零 IPC 开销、可直接调试、类型安全。但插件崩溃会影响主进程。
- Worker 模式提供真正的隔离、资源限制、崩溃隔离。但需要 IPC 序列化开销。

**决策逻辑：**
```typescript
// plugin-host/index.ts
async activatePlugin(manifest: PluginManifest, sourceCode: string, options?: {
  mode?: 'auto' | 'inline' | 'worker'
}) {
  const mode = options?.mode ?? (manifest.trusted ? 'inline' : 'worker');
  if (mode === 'inline') {
    return this.activateInline(manifest, sourceCode);
  } else {
    return this.activateInWorker(manifest, sourceCode);
  }
}
```

### 模式 4：生命周期中间件管道

**是什么：** 在插件生命周期的关键节点（激活前、激活后、停用前、停用后）插入中间件函数。参考 Express/Koa 的洋葱模型，允许拦截和处理。

**何时使用：** 需要在插件激活/停用时执行全局逻辑（如：权限校验、资源预分配、日志、性能测量、依赖可用性检查）。

**示例：**
```typescript
type LifecycleHook = 'beforeActivate' | 'afterActivate' | 'beforeDeactivate' | 'afterDeactivate';

class PluginHost {
  private middleware: Map<LifecycleHook, Array<(ctx: PluginContext) => Promise<void>>> = new Map();

  use(hook: LifecycleHook, fn: (ctx: PluginContext) => Promise<void>) {
    if (!this.middleware.has(hook)) this.middleware.set(hook, []);
    this.middleware.get(hook)!.push(fn);
  }

  private async runMiddleware(hook: LifecycleHook, ctx: PluginContext) {
    const fns = this.middleware.get(hook) || [];
    for (const fn of fns) {
      await fn(ctx);
    }
  }

  async activatePlugin(manifest: PluginManifest) {
    const ctx = this.createContext(manifest);
    await this.runMiddleware('beforeActivate', ctx);  // 拦截点
    const result = await this.executeActivate(ctx);     // 实际激活
    await this.runMiddleware('afterActivate', ctx);     // 拦截点
    return result;
  }
}
```

### 模式 5：Hot Reload 热重载（开发模式）

**是什么：** 使用 chokidar（Node.js 端）或 Vite HMR WebSocket（浏览器端）监听插件源码目录变更。变更时：先 deactivate 旧插件，再 activate 新代码。

**何时使用：** 插件开发中。生产环境不启用。

**示例：**
```typescript
// plugin-host/hot-reload.ts
import chokidar from 'chokidar';

export function enableHotReload(host: PluginHost, pluginDir: string, wsServer: WebSocketServer) {
  const watcher = chokidar.watch(pluginDir, {
    ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
    persistent: true,
  });

  watcher.on('change', async (filePath) => {
    const pluginId = resolvePluginId(filePath);
    console.log(`[HMR] Plugin ${pluginId} changed, reloading...`);
    try {
      await host.deactivatePlugin(pluginId);
      const sourceCode = await fs.promises.readFile(filePath, 'utf-8');
      await host.activatePlugin(parseManifest(sourceCode), sourceCode);
      console.log(`[HMR] Plugin ${pluginId} reloaded successfully`);
      wsServer.emit('plugin:reloaded', { pluginId });
    } catch (e) {
      console.error(`[HMR] Failed to reload plugin ${pluginId}:`, e);
      wsServer.emit('plugin:error', { pluginId, error: e.message });
    }
  });
}
```

## 数据流

### 主请求流：插件命令执行（Worker 隔离模式）

```
用户 (浏览器) → POST /api/agent/chat
    ↓
server.ts → handleAgentChat()
    ↓
AI API 返回 tool_call
    ↓
executeAgentToolCall()
    ↓
kernelContainer.commandBus.execute(cmd)
    ↓
CommandBus 拦截器 → 能力检查
    ↓
CommandHandler.execute(cmd)  ← 注册该命令的插件（Worker 中）
    │
    │  // 跨 Worker 边界：
    │  // 1. 主线程找到注册该命令的插件 workerId
    │  // 2. 通过该 Worker 的 MessagePort 发送 invoke
    │  // 3. Worker 中 execute(cmd) 执行
    │  // 4. 结果通过 result 消息返回
    │
    ↓
结果 → 返回 AI → AI 生成响应 → 前端展示
    ↓（同时）
EventBus.publish(event) → Socket.IO 广播 → 前端实时更新
```

### 前端插件扩展流

```
用户打开 App.tsx
    ↓
PluginHost（前端）解析所有已安装插件
    ↓
对每个插件 → 检查 requires/optional → 解析 Token
    ↓
插件 activate(ctx) 被调用
    │  插件在 activate 中调用：
    │  ctx.services.ui.registerClassroomTool({ id, label, component })
    │  ctx.services.ui.registerTeacherTab({ id, label, component })
    ↓
UIExtensionService 收集所有注册的扩展点
    ↓
App.tsx 从 PluginHost 获取 classroomTools[]、teacherTabs[] 等
    ↓
渲染 UI（现有工具 + 插件注册的工具）
```

### 热重载流

```
文件系统变更（chokidar）
    ↓
plugin-host/hot-reload.ts 检测变更
    ↓
PluginHost.deactivatePlugin(pluginId)
    │  → 插件停用中间件管道
    │  → 取消注册 commands/actions/events/processes
    │  → 如果 Worker 模式：worker.terminate()
    ↓
重新解析源码 → 新 PluginManifest
    ↓
PluginHost.activatePlugin(manifest, newSourceCode)
    │  → 激活中间件管道
    │  → Worker 创建/代码加载
    │  → inject services → activate(ctx)
    ↓
WebSocket → 前端通知 'plugin:reloaded'
    ↓
前端 PluginHost 重新加载对应插件
```

## 与现有内核子系统的集成

### 集成策略：轻量 Token 化，不重写子系统

现有的 CommandBus、EventBus、ActionRegistry、CapabilityGuard、ProcessManager 保持其内部实现不变。每个子系统实现对应的 IService 接口，并在启动时注册到 ServiceRegistry。

```
启动时序（server.ts startServer()）：

1. kernelContainer 实例化（不变）
   → 内部创建 CommandBus、EventBus 等

2. ★ NEW → ServiceRegistry 初始化
   → 将各子系统包装为服务提供者注册：
     serviceRegistry.register(ICommandBusServiceToken, kernelContainer.commandBus)
     serviceRegistry.register(IEventBusServiceToken, kernelContainer.eventBus)
     ...

3. ★ NEW → PluginHost 初始化
   new PluginHost(serviceRegistry, { defaultMode: 'auto' })

4. 内联插件加载（packages/plugins/*.ts）
   → 直接 import activate 函数
   → pluginHost.activateInline(manifest, activate)

5. DB 插件加载（plugins 表中的第三方插件）
   → pluginHost.activateWorker(manifest, sourceCode)
   → 创建 Worker Thread → 加载代码 → 注入服务代理 → activate

6. 完成 → HTTP 服务器启动
```

### Kernel 类改造

```typescript
// packages/core/kernel/index.ts（改造后）
export class Kernel {
  public readonly serviceRegistry: ServiceRegistry;  // ★ NEW
  public readonly pluginHost: PluginHost;             // ★ NEW
  public readonly eventBus: EventBus;
  public readonly commandBus: CommandBus;
  // ... 其余子系统

  constructor() {
    // 1. 创建 ServiceRegistry（DI 容器）
    this.serviceRegistry = new ServiceRegistry();

    // 2. 创建核心子系统（不变）
    this.eventBus = new EventBus();
    this.commandBus = new CommandBus(this.eventBus);
    this.actionRegistry = new ActionRegistry();
    this.capabilityGuard = new CapabilityGuard();
    this.processManager = new ProcessManager(/* ... */);

    // 3. 注册 Token 化服务
    this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus);
    this.serviceRegistry.register(IEventBusServiceToken, this.eventBus);
    this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry);
    this.serviceRegistry.register(ICapabilityGuardServiceToken, this.capabilityGuard);
    this.serviceRegistry.register(IProcessManagerServiceToken, this.processManager);
    // Storage 和 AI 从现有 PluginRuntime 中提取为独立服务
    this.serviceRegistry.register(IStorageServiceToken, new StorageService(this.db));
    this.serviceRegistry.register(IAIServiceToken, new AIService(this.db));

    // 4. 创建 PluginHost（替代 PluginRuntime）
    this.pluginHost = new PluginHost(this.serviceRegistry);

    // 5. 命令拦截器（不变）
    this.commandBus.setInterceptor(/* ... */);
  }
}
```

### 向下兼容策略

现有代码（server.ts、App.tsx）通过 `kernelContainer.commandBus` 直接访问子系统的方式不变，因为子系统对象仍然作为 Kernel 的 public readonly 属性暴露。新插件通过 Token 系统访问，已有代码通过直接属性访问——两者共存，渐进迁移。

| 访问方式 | 使用者 | 优先级 |
|----------|------|--------|
| `kernelContainer.commandBus` | 现有 server.ts 路由、Socket.IO 处理器 | 保持兼容，后续逐步迁移 |
| `ctx.services.commandBus`（Token DI） | 所有新插件（内联 + Worker） | 推荐方式 |

## 扩展性考量

| 关注点 | 当前（10个插件） | 未来（50个插件） | 未来（200+插件） |
|--------|---------------|---------------|----------------|
| Worker 内存 | 10 Workers ~500MB | 需要 Worker Pool 复用（50 Workers ~2.5GB） | 必须实现 Worker Pool + 闲置回收 |
| 启动时间 | 10 插件顺序激活 ~2s | 需并行激活（依赖顺序允许时） | 需延迟激活（Lazy Activation） |
| 服务注册 | Map 直接查找 O(1) | Fine | Fine |
| Token 解析 | 按 requires 数组迭代 O(n) | 缓存解析结果 | 缓存解析结果 |

## 反模式识别

### 反模式 1：ServiceRegistry 成为新的 God Object

**问题：** ServiceRegistry 承担太多职责（注册、解析、生命周期、中间件、事件分发）
**避免：** ServiceRegistry 仅负责 Token → 实例的注册与查找。生命周期管理在 PluginHost，中间件在 MiddlewarePipeline（独立类）。

### 反模式 2：IPC 代理层暴露过多细节

**问题：** 为每个服务方法创建代理，导致 IPC 消息类型爆炸
**避免：** 使用通用 invoke 协议（token + method + args），而非为每个方法定义独立消息类型。服务接口方法只接收和返回可序列化的数据。

### 反模式 3：Worker Thread 无限创建

**问题：** 每安装一个插件创建一个 Worker，插件数量增长导致内存耗尽
**避免：** 实现 WorkerPool 上限（默认 CPU 核心数 * 2）。超限时排队/复用。Long-idle Workers 自动回收（如 5 分钟无命令执行则 terminate）。

### 反模式 4：Token 版本不兼容静默失败

**问题：** 插件声明依赖 `ICommandBusService@^1.0` 但运行时注册的是 `2.0`（breaking change），行为未定义
**避免：** Token 实例携带 semver 版本。ServiceRegistry 解析时做版本兼容检查。不兼容时明确报错而非静默。

## 构建顺序建议（供 Roadmap 参考）

组件依赖图：

```
Token + ServiceRegistry (最底层，无依赖)
    ↓
IService 接口定义 (依赖 Token)
    ↓
现有子系统实现接口 (依赖接口定义)
    ↓
IPC 协议定义 (独立)
    ↓
PluginSandbox (Node) + PluginSandbox (Browser) (依赖 IPC 协议)
    ↓
PluginHost (依赖 ServiceRegistry + Sandbox + IPC)
    ↓
Lifecycle Middleware Pipeline (依赖 PluginHost)
    ↓
Hot Reload (依赖 PluginHost + chokidar/ws)
    ↓
前端 PluginHost + WebWorkerPool (依赖 IPC 协议)
    ↓
Extension Points 前端 (依赖前端 PluginHost)
```

推荐构建阶段：
1. **Phase 1: DI 基础** — Token、ServiceRegistry、IService 接口（不涉及插件加载，先铺基础设施）
2. **Phase 2: 沙箱 + IPC** — 两份 Sandbox 实现（Node Worker + Browser Worker）、IPC 协议
3. **Phase 3: PluginHost** — 插件生命周期管理、内联+Worker 双模式、activate/deactivate
4. **Phase 4: 中间件 + 热重载** — 生命周期中间件管道、开发模式热重载
5. **Phase 5: 前端集成** — 前端 PluginHost、WebWorker、Extension Points
6. **Phase 6: 迁移** — 内联插件按新格式重写、DB Schema 迁移

---

## 来源

- JupyterLab 插件系统架构：Token-based DI、`JupyterFrontEndPlugin<T>` 接口、`requires`/`optional`/`provides` 声明模式 — [DeepWiki: jupyterlab/jupyterlab 3.2-plugin-system](https://deepwiki.com/jupyterlab/jupyterlab/3.2-plugin-system) — HIGH
- Lumino Token 类设计：`new Token<T>(name, description)` 类型安全的服务标识符 — [DeepWiki: jupyter/notebook 2.2-plugin-system](https://deepwiki.com/jupyter/notebook/2.2-plugin-system) — HIGH
- VS Code Extension Host 架构：独立进程隔离、激活事件、vscode API 代理 — [vscode-docs: Our Approach to Extensibility](https://vscode-docs.readthedocs.io/en/latest/extensions/our-approach/) — HIGH
- Node.js `worker_threads` — MessageChannel、postMessage、结构化克隆 — [Node.js 官方文档](https://nodejs.org/api/worker_threads.html) — HIGH
- Node.js `data:` URL ESM import — `import("data:text/javascript,...")` 作为动态代码加载机制 — 社区验证 — MEDIUM
- Zach Leatherman `import-module-string` — 跨运行时动态 ESM 模块加载方案 — [GitHub: javascript-eval-modules](https://github.com/zachleat/javascript-eval-modules) — MEDIUM
- 现有代码库分析：`packages/core/plugin-runtime/index.ts`、`packages/core/kernel/index.ts`、`packages/core/command-bus/index.ts`、`packages/core/event-bus/index.ts` — HIGH（一手源码）

---

*架构研究完成日期：2026-06-17*
