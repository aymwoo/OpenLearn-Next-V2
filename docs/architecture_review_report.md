# OpenLearnV2 核心架构与设计

## 目录

1. [设计理念](#1-设计理念)
2. [系统架构总览](#2-系统架构总览)
3. [核心子系统](#3-核心子系统)
4. [插件生命周期管理](#4-插件生命周期管理)
5. [命令-事件-Action 三件套](#5-命令-事件-action-三件套)
6. [依赖注入体系](#6-依赖注入体系)
7. [Worker Thread 隔离模式](#7-worker-thread-隔离模式)
8. [前端插件系统](#8-前端插件系统)
9. [安全与权限模型](#9-安全与权限模型)
10. [数据存储方案](#10-数据存储方案)

---

## 1. 设计理念

OpenLearnV2 采用 **插件驱动的命令-事件总线架构**（Plugin-Driven Command-Event Bus Architecture）。灵感来源于操作系统内核设计：一个精简的核心内核（Kernel）提供基础能力，所有业务功能——包括课程管理、白板交互、AI 规划、作业评估——全部通过插件实现。

核心设计原则：

- **内核只做转发，不做业务**：Kernel 提供 CommandBus、EventBus、ServiceRegistry、PluginHost 等基础子系统，不包含任何领域逻辑。
- **一切皆插件**：课程管理（builtin）、虚拟文件系统（vfs）、AI 规划器（ai-planner）、作业评估（assignment-eval）等均为插件，享有相同的生命周期和权限模型。
- **Command → Event → Audit**：所有数据写入通过 CommandBus 进行，执行完毕后由 EventBus 发布事件，事件自动写入 SQLite 审计日志，形成完整的因果链。
- **安全纵深防御**：Worker Thread 隔离 + CapabilityGuard 权限控制 + 高危操作审批网关 + 命名空间防欺骗，四层安全防护。

---

## 2. 系统架构总览

```                                                                 
┌──────────────────────────────────────────────────────────────────┐
│                      OpenLearnV2 Kernel                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   AI Agent (Shell)                         │  │
│  │     Gemini / OpenAI 兼容模型作为智能控制器                   │  │         
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │ 自然语言 → functionCall                 │   
│  ┌──────────────────────▼─────────────────────────────────────┐  │
│  │                  CommandBus (内核管线)                      │  │   
│  │  interceptor → JSON Schema 校验 → CapabilityGuard →       │  │   
│  │  高危审批闸门 → Handler 执行                               │  │        
│  └──┬──────────┬──────────┬──────────┬──────────┬─────────┘  │    
│     │          │          │          │          │              │  
│  ┌──▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼────────┐      │     
│  │builtin│  │ VFS  │  │管理  │  │ AI   │  │ 第三方插件  │      │         
│  │ 插件  │  │ 插件 │  │ 插件 │  │规划器│  │ (Plugin)   │      │            
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  └──────┬──────┘      │       
│     │        │        │        │              │              │    
│  ┌──▼────────▼────────▼────────▼──────────────▼──────┐      │     
│  │                   EventBus                         │      │    
│  │        所有事件写入 SQLite 审计日志表                 │      │            
│  └──────────────────────┬─────────────────────────────┘      │    
│                         │                                     │   
│  ┌──────────────────────▼─────────────────────────────┐      │    
│  │              SQLite Database (30+ 表)               │      │    
│  └─────────────────────────────────────────────────────┘      │   
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              ServiceRegistry (依赖注入容器)                 │  │     
│  │   Token 驱动 | 有向无环图 | 依赖验证 | SemVer 版本检查      │  │              
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```                                                                 

---

## 3. 核心子系统

所有核心子系统位于 `packages/core/` 目录下，由 `Kernel` 类统一组装。

### 3.1 Kernel — 全局单例容器

Kernel 是系统的「操作系统内核」，采用分层初始化策略（Layer 0 → Layer 1 → Layer 2 → Layer 3），从无依赖的子系统开始逐层构建：

```
Layer 0: EventBus, CapabilityGuard, ServiceRegistry, StorageService, AIService
Layer 1: CommandBus(EventBus), ActionRegistry
Layer 2: ProcessManager(Kernel), PluginHost(ServiceRegistry, EsmLoader, db)
Layer 3: WorkerManager(ServiceRegistry, CapabilityGuard, db)
```

Kernel 通过 lazy-evaluated Proxy 暴露全局单例 `kernelContainer`，避免测试导入时的瞬时创建。所有子系统间不存在循环依赖——WorkerManager 通过 setter 注入到 PluginHost 以打破循环。

**系统启动流程**（`bootstrapSystemPlugins()`）:

1. `migratePluginsToFilesystem()` — 将数据库中存有 source_code 的旧插件迁移到文件系统（幂等）
2. 按优先级顺序启动系统插件——关键插件失败则硬崩溃退出：
   - VFS → Process → Management → Builtin（关键，失败即 `process.exit(1)`）
   - AI Planner → AI Submit Injector → Assignment Eval（非关键，失败仅警告）
3. `restoreActivePlugins()` — 恢复数据库中标记为 active 的第三方 ESM 插件
4. 开发模式（`NODE_ENV=development`）启动 `HotReloadController` 文件监听

### 3.2 CommandBus — 命令执行管线

命令总线是所有数据写入的**唯一入口**。将所有 mutation 路由通过 CommandBus 实现了权限校验、payload 格式校验、高危操作审批的统一控制点——这是教科书级别的 CQRS 模式。

**执行管线（interceptor chain）**:

```
execute(command):
  1. 标准化 actorId（空值默认 "agent-system-0"）
  2. 拦截器链：
     ├─ JSON Schema 校验（基于 ActionRegistry 中的 inputSchema）
     ├─ CapabilityGuard 权限检查（非 admin actor 时校验 capabilityRequired）
     └─ 高危审批闸门（isHighRisk + 非 admin → 写入 pending_commands 表 + 抛出异常）
  3. Handler 查找（modern 优先，legacy 降级）
  4. Handler.execute() 执行业务逻辑
  5. 返回结果
```

支持 modern 和 legacy 双通道处理器（D-11）：`registerHandler()` 注册到 modern Map，`registerLegacyHandler()` 注册到 legacy Map。execute 时优先匹配 modern，未命中则 fallback 到 legacy。

### 3.3 EventBus — 事件发布/订阅

轻量级发布/订阅模式，支持通配符 `*` 订阅所有事件。事件发布为异步并行——所有订阅者通过 `Promise.all` 并发触发，单个订阅者异常仅记录 console.error，不影响其他订阅者。

```typescript
interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly type: string;          // 过去式命名，如 "lesson.created"
  readonly source: string;        // 来源插件/模块
  readonly payload: T;
  readonly timestamp: number;
  readonly correlationId?: string; // 关联命令 ID，用于因果追踪
}
```

**审计日志**：Kernel 启动后通过 `initAuditLog()` 注册 `*` 通配符订阅者，将所有事件写入 SQLite `events` 表，形成不可篡改的审计日志。

**前端桥接**：前端 `FrontendEventBus` 通过 SocketBridge 将 `whiteboard.`、`courseware.`、`quiz.`、`rollcall.` 前缀的事件自动转发到服务端 EventBus，实现前后端事件的统一审计。

### 3.4 ActionRegistry — AI Agent 工具注册表

插件通过 `ActionRegistry.register()` 注册 AI Agent 可发现的工具。每个 Action 包含：

| 字段 | 说明 |
|------|------|
| `id` | 全局唯一标识 |
| `commandType` | 对应的命令类型（关联到 CommandBus handler） |
| `description` | AI Agent 理解工具用途的关键描述（建议中文） |
| `capabilityRequired` | 调用所需的权限字符串 |
| `isHighRisk` | 是否高危操作（需教师审批） |
| `inputSchema` | JSON Schema（Google GenAI 兼容格式） |

`getAgentTools()` 方法将所有 Action 转换为 Google GenAI `functionDeclarations` 格式，供 AI 模型的 functionCall 使用。这是 OpenLearnV2 的核心 AI 原生能力——插件无需额外集成即可被 AI Agent 自动发现和调用。

---

## 4. 插件生命周期管理

### 4.1 PluginHost — 生命周期管理器

PluginHost 是插件生命周期的核心管理者，负责插件的安装、激活、停用、卸载和热重载。关键组件如下：

| 组件 | 职责 |
|------|------|
| `pluginStates` | Map<pluginId, PluginState> 状态追踪 |
| `resourceTracker` | 按 pluginId 管理 Disposable 资源，保证精确清理 |
| `contributionRegistry` | V3.2 声明式 UI 贡献点存储 |
| `middlewareRegistry` | 按生命周期阶段分组的洋葱模型中间件管道 |
| `preloadedPlugins` | 内置插件内存预加载映射（跳过文件系统加载） |
| `pluginInstances` | 活跃实例引用（manifest + activate/deactivate + workerRef） |

### 4.2 状态机

```
INSTALLED ──→ ACTIVATING ──→ ACTIVE ──→ DEACTIVATING ──→ INACTIVE
                                  │                           │
                                  └──── ERROR ←───────────────┘
                                                        │
INACTIVE ──→ ACTIVATING（重新激活）                       │
ERROR ──→ ACTIVATING（重试）          UNINSTALLED ←──────┘
```

ACTIVATING 和 DEACTIVATING 是瞬态（transient），不应长时间停留。状态转换由 `validateStateTransition()` 强制执行,非法转换抛出 `IllegalStateTransitionError`。

### 4.3 激活流程（中间件管道）

`activatePlugin()` 的执行流程采用洋葱模型中间件管道：

```
beforeActivate 中间件 → 实际激活 → afterActivate 中间件

实际激活内部:
  1. 幂等守卫（已激活则跳过）
  2. validateTransition(INSTALLED/INACTIVE → ACTIVATING)
  3. setState(ACTIVATING)
  4. 解析 manifest + SemVer 兼容性检查
  5. 根据 execution_mode 分支：
     ├─ 'worker' → WorkerManager.createWorker()
     └─ 'inline' → ContextBuilder.buildContext() → plugin.activate(ctx)
  6. 注册 classroomTools → ContributionRegistry
  7. 授予 capabilitiesProposed 声明的权限
  8. setState(ACTIVE)
```

### 4.4 停用流程（强制清理保证）

`deactivatePlugin()` 使用多层 `finally` 块 + pipeline 安全 fallback 双重强制清理，保证即使在停用过程中抛出异常，资源也能正确回收：

```
deactivate 流程:
  1. 状态验证 + resolvePluginUuid
  2. worker 模式 → deactivateWorker()（超时保护）
  3. inline 模式 → 洋葱管道:
     beforeDeactivate 中间件
     → instance.deactivate()（超时保护，抛出仅记录警告不阻断）
       → finally:
         resourceTracker.disposeAll(pluginId)    ← 强制清理
         contributionRegistry.unregister()        ← 移除 UI 贡献
         capability.revokeAll(actorId)            ← 收回权限
         hotReloadController.unregisterPlugin()   ← 热重载注销
         DB status = 'inactive'
     → afterDeactivate 中间件
  4. 管道崩溃安全 fallback: 直接执行 resourceTracker.disposeAll + revokeAll
```

### 4.5 ResourceTracker — 确定性资源清理

`ResourceTracker` 确保所有插件资源（命令处理器、事件订阅、定时器、后台进程）在插件停用时被确定性清理。通过 `Disposable` 接口统一管理可清理资源，防止内存泄漏和僵尸订阅。

### 4.6 生命周期中间件

PluginHost 支持在 6 个生命周期阶段注册中间件（洋葱模型）：

| 阶段 | 触发时机 |
|------|---------|
| `beforeActivate` | 插件激活前 |
| `afterActivate` | 插件激活后 |
| `beforeDeactivate` | 插件停用前 |
| `afterDeactivate` | 插件停用后 |
| `beforeCommand` | 命令执行前 |
| `afterCommand` | 命令执行后 |

### 4.7 热重载机制

开发模式（`NODE_ENV=development`）下，`HotReloadController` 通过 `chokidar` 监听 `plugins/` 目录的文件变更（300ms debounce）。检测到变更后调用 `PluginHost.reloadPlugin()` 执行原子替换：停用旧版本 → 清除中间件 → 激活新版本，无需重启服务器。

---

## 5. 命令-事件-Action 三件套

这是 OpenLearnV2 插件开发的核心模式。每个业务功能需要三样东西协同工作：

```
┌─────────────────────┐
│  Action (AI 可调用)  │  → actionRegistry.register()
│  描述 + JSON Schema  │     供 AI Agent 发现和调用
└────────┬────────────┘
         │ 关联 commandType
┌────────▼────────────┐
│  Command (业务执行)  │  → commandBus.registerHandler()
│  Handler + 逻辑      │     权限检查 → 数据写入 → 返回结果
└────────┬────────────┘
         │ 执行完毕后发布
┌────────▼────────────┐
│  Event (状态通知)    │  → eventBus.publish()
│  过去式命名 + 载荷    │     审计日志 + Socket.IO 推送
└─────────────────────┘
```

**命名规范**：

- 命令类型：点号分隔，动词原形 + 资源名 — `lesson.create`、`poll.vote`、`whiteboard.query`
- 事件类型：点号分隔，过去式 — `lesson.created`、`poll.vote_cast`、`whiteboard.element_drawn`
- Action ID：手写唯一标识 — `core-lesson-create`、`poll-create`

---

## 6. 依赖注入体系

### 6.1 ServiceRegistry

Token 驱动的依赖注入容器，构建所有内核服务间的显式依赖图：

- **依赖图验证**：注册时验证所有 required 依赖已存在，缺失时抛出 `MissingDependencyError`
- **反向依赖追踪**：维护双向依赖图（requires ← → dependents），卸载时检查 `HasDependentError` 防止级联崩溃
- **SemVer 版本检查**：Token 携带版本号，插件 manifest 中的 `requires` 声明版本范围
- **原子替换**：`registerOrReplace()` 支持原子替换已注册的服务实例

### 6.2 内核服务 Token

Kernel 初始化时向 ServiceRegistry 注册 10 个 IService 实例：

| Token 常量 | 标识符 | 暴露类型 | 用途 |
|-----------|--------|---------|------|
| `ICommandBusServiceToken` | `@openlearn/core:ICommandBusService` | ICommandBusService | 命令执行、注册、拦截器 |
| `IEventBusServiceToken` | `@openlearn/core:IEventBusService` | IEventBusService | 事件发布/订阅 |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` | IActionRegistryService | AI 工具注册 |
| `ICapabilityServiceToken` | `@openlearn/core:ICapabilityService` | ICapabilityService | 权限管理 |
| `IProcessServiceToken` | `@openlearn/core:IProcessService` | IProcessService | 后台进程/定时任务 |
| `IStorageServiceToken` | `@openlearn/core:IStorageService` | IStorageService | K-V 存储 |
| `IAIServiceToken` | `@openlearn/core:IAIService` | IAIService | AI 文本生成 |
| `IDatabaseToken` | `@openlearn/core:IDatabase` | better-sqlite3 Database | 原始 SQL 访问 |
| `IPluginHostToken` | `@openlearn/core:IPluginHost` | PluginHost | 插件主机管理 |
| `ISemesterGradeServiceToken` | `@openlearn/core:ISemesterGradeService` | ISemesterGradeService | 学期成绩管理 |

---

## 7. Worker Thread 隔离模式

### 7.1 三层隔离体系

在生产环境中，插件可在独立 Node.js Worker Thread 中运行：

| 层次 | 机制 | 说明 |
|------|------|------|
| 物理隔离 | Worker Thread | 独立 V8 线程，崩溃不影响主进程 |
| 通信隔离 | RPC Proxy | 所有内核服务调用通过 `postMessage` 序列化传递，Worker 无法直接引用主进程对象 |
| 权限隔离 | CapabilityGuard | Worker 内每个 RPC 调用在主线程侧重新经过能力检查 |

### 7.2 服务代理实现

`createServicesProxy()` 为 Worker 端构建完整的服务代理对象，核心组件：

| 组件 | 职责 |
|------|------|
| `MethodProxy` | 将 Worker 端方法调用序列化为 RPC invoke 消息，通过 `pendingCalls` Map 等待主线程响应 |
| `EventBusProxy` | 管理 Worker 端事件订阅，通过 subscribe/unsubscribe 消息与主线程 `EventForwarder` 同步 |
| `dispose` | 清理所有 pending calls 和订阅，Worker 终止时必须调用 |

### 7.3 结构化错误层次

```
WorkerRuntimeError            // 基类
├── WorkerActivateError       // 插件在 Worker 内激活失败
├── WorkerTimeoutError        // RPC 调用或激活/停用超时
├── WorkerTransportError      // postMessage 通信层失败
├── WorkerCapabilityError     // 跨边界能力检查拒绝
└── WorkerNotSupportedError   // 运行时不支持的功能
```

### 7.4 前端 Worker 模式

前端同样支持 Worker 模式，通过 `BrowserWorkerManager` 将插件运行在 Web Worker 中。前端 Worker 激活流程：创建 Web Worker → 发送 activate-request → Worker 端加载源码 → ServiceHost 建立 RPC 通道 → 返回 activated 确认。

---

## 8. 前端插件系统

### 8.1 FrontendPluginHost

前端插件运行在浏览器中，通过动态 `import()` 加载 ESM 模块。`FrontendPluginHost` 管理前端插件的完整生命周期，支持 inline 和 worker 两种执行模式。

**激活流程**：

1. 判断 executionMode：`worker` → `activateWorkerPlugin()`, `inline` → 正常流程
2. 通过 `moduleLoader` 动态加载插件源码（Blob URL 或 fetch + eval）
3. 验证 manifest.id 一致性
4. 自动注册 `classroomTools` 声明为 `classroom.tool` 扩展点
5. `buildContext()` 构建前端上下文（含 FrontendServiceRegistry 解析）
6. 5 秒超时保护 → `plugin.activate(ctx)`

### 8.2 前端服务 Token

`FrontendServiceRegistry` 注册 5 个前端专用服务：

| Token | 服务接口 | 说明 |
|-------|---------|------|
| `FRONTEND_API_TOKEN` | IFrontendAPI | RESTful HTTP API（get/post/del） |
| `SOCKET_SERVICE_TOKEN` | ISocketService | WebSocket 通信（emit/on/off/disconnect） |
| `UI_SERVICE_TOKEN` | IUIService | Toast/Modal/文件下载 |
| `STORAGE_SERVICE_TOKEN` | IStorageService | 客户端 K-V 存储 |
| `SEMESTER_GRADE_SERVICE_TOKEN` | ISemesterGradeService | 学期成绩保存 |

### 8.3 扩展点系统

插件通过 `ctx.ui.registerExtensionPoint(slot, config)` 注册 UI 组件到预定义槽位：

| Slot | 用途 |
|------|------|
| `teacher.tab` | 教师导航标签页 |
| `teacher.panel` | 教师独立全宽管理面板（v3.2） |
| `teacher.dashboard.widget` | 教师仪表盘小部件 |
| `student.view` | 学生视图 |
| `student.fullscreen` | 学生全屏视图/考试模式（v3.2） |
| `student.lesson.tool` | 学生学习工具 |
| `classroom.tool` | 课堂工具 |
| `global.setting` | 全局设置页扩展（v3.2） |

**学生端 `slotProps` 注入**：宿主渲染 `student.view` 扩展点时，自动通过 `slotProps` 注入当前登录学生 ID：

```tsx
// 插件前端组件直接通过 props 获取
export default function MyPlugin({ studentId }: { studentId?: string }) {
  // studentId 由宿主自动注入，无需额外请求
}
```

`ExtensionPointRenderer` 是宿主渲染扩展点的统一入口——`App`、`NavigationSidebar`、`Dashboard` 等宿主组件通过它按 slot 动态渲染所有已注册扩展，每个扩展被独立包裹在 `ExtensionErrorBoundary` 中隔离崩溃。

### 8.4 宿主依赖共享网关

为避免每个第三方插件前端重复打包庞大的基础库，OpenLearnV2 通过 `window.HostSharedDeps` 全局对象提供共享依赖。插件前端构建时必须将这些库标记为 external：

| 全局对象 | NPM 包 |
|----------|--------|
| `HostSharedDeps.React` | react |
| `HostSharedDeps.ReactDOM` | react-dom |
| `HostSharedDeps.Recharts` | recharts |
| `HostSharedDeps.LucideReact` | lucide-react |

> **⚠️ JSX 运行时**：HostSharedDeps 仅提供经典 React 运行时，不包含 `react/jsx-runtime`。插件前端必须使用 `"jsx": "react"`（经典模式），不能使用 `"jsx": "react-jsx"`（automatic runtime）。

---

## 9. 安全与权限模型

### 9.1 四层防护体系

| 层 | 机制 | 说明 |
|----|------|------|
| 1. 命名空间隔离 | 命名空间前缀 + UUID 防欺骗 | 裸字符命令自动加 `{pluginId}.` 前缀；注册时检测 UUID 跨插件劫持 |
| 2. 权限声明 | `capabilitiesProposed` | 安装时声明，运行时强制检查 |
| 3. 物理隔离 | Worker Thread | 可选的生产环境强化隔离 |
| 4. 审批闸门 | 高危操作审批 | `isHighRisk` Action 需教师审批后执行 |

### 9.2 权限格式

```
格式: {resource}:{action}
示例:
  lesson:read       — 读取课程
  lesson:write      — 创建/编辑课程
  lesson:delete     — 删除课程
  whiteboard:*      — 白板所有操作（通配符）
  vfs:read          — 读取虚拟文件系统
  vfs:write         — 写入虚拟文件系统
```

管理员角色（`actorId` 包含 `:administrator` 或 `:admin`）自动绕过高危审批和权限检查。

### 9.3 高危操作审批流程

```
AI Agent 调用 isHighRisk Action
  → CommandBus 拦截器检测到非 admin actor
  → 命令写入 pending_commands 表（pending 状态）
  → EventBus 发布 approval.requested 事件
  → Socket.IO 推送到教师客户端
  → 教师在审批面板批准/拒绝/修改参数
  → 批准后执行原始命令
```

---

## 10. 数据存储方案

### 10.1 SQLite 单文件数据库

系统使用 SQLite 作为主数据库，文件位于 `packages/core/db/educational_os.db`。通过 better-sqlite3 进行同步访问，适合教育场景的单服务器部署。

### 10.2 插件数据库隔离

每个插件通过 `ctx.db` API 获得命名空间隔离的数据库操作能力：

- `ctx.db.ensureTable(name, schema)` — 在 `plugin_{pluginId}_{name}` 命名空间创建表（幂等）
- `ctx.db.table(name)` — 返回带命名空间前缀的完整表名
- `ctx.db.migrate(targetVersion, upgradeFn)` — 声明式数据库版本迁移
- `ctx.db.dropAllTables()` — 删除插件创建的所有表（卸载时自动调用）

### 10.3 核心数据表

| 表名 | 用途 |
|------|------|
| `lessons` | 课程信息（含 timeline JSON、Markdown 内容） |
| `whiteboard_elements` | 白板元素（含 segmentId/page 上下文字段） |
| `plugins` | 插件元信息（含 execution_mode、file_path、loader_version） |
| `events` | 审计日志（EventBus `*` 通配符订阅者自动写入） |
| `pending_commands` | 高危操作审批队列 |
| `plugin_storage` | 插件 K-V 存储（按 namespace 隔离） |

---

## 附录 A：内置系统插件

| 插件 ID | 源文件 | 关键性 | 职责 |
|---------|--------|--------|------|
| `@openlearn/plugin-vfs` | vfs.ts | 关键 | 虚拟文件系统（读写/目录管理） |
| `@openlearn/plugin-process` | process.ts | 关键 | 后台进程和定时任务管理 |
| `@openlearn/plugin-management` | management.ts | 关键 | LMS 管理（班级/学生/作业/成绩） |
| `@openlearn/plugin-builtin` | builtin.ts | 关键 | 课堂核心（课程 CRUD / 白板 CRUD / 时间线） |
| `@openlearn/plugin-ai-planner` | ai-planner.ts | 非关键 | AI 教案生成与推荐 |
| `@openlearn/plugin-ai-submit-injector` | submit-injector.ts | 非关键 | AI 提交注入器 |
| `@openlearn/plugin-assignment-eval` | assignment-eval.ts | 非关键 | 作业评估与同伴互评 |

关键插件启动失败会触发 `process.exit(1)` 硬崩溃；非关键插件失败仅记录警告。

---

## 附录 B：完整数据流

```
用户发送消息 → POST /api/agent/chat
  → AI 模型返回 functionCall（如 lesson.create）
  → executeAgentToolCall() 通过 ActionRegistry.getActionByToolName() 查找 action
  → CommandBus.execute() 执行拦截器管线:
    ├─ JSON Schema payload 校验（基于 action.inputSchema）
    ├─ CapabilityGuard 权限检查（非 admin actor）
    └─ 高危操作 → 写入 pending_commands 审批表 + 抛出异常中断
  → Handler 执行业务逻辑（db.prepare().run()）
  → EventBus.publish() 发布事件（异步并行通知所有订阅者）
  → `*` 通配符订阅者写入 events 审计日志表
  → Socket.IO 推送给在线客户端（教师/学生实时更新）
  → 返回结果给 AI Agent（继续对话或结束）
```

---

> 本文档基于 OpenLearnV2 最新代码库（`main` 分支）通过 Codegraph 知识图谱分析生成。
> 最后更新：2026-07-14
