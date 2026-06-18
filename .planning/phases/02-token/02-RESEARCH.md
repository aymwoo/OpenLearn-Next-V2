# Phase 2: 现有能力 Token 化 - Research

**Researched:** 2026-06-18
**Domain:** TypeScript 服务接口抽象 + DI 模式 + 现有子系统 API 分析
**Confidence:** HIGH

## Summary

Phase 2 是一个纯架构重构阶段——不改变任何外部行为，不安装新的 npm 包。目标是将现有的 7 个核心子系统（CommandBus、EventBus、ActionRegistry、CapabilityGuard、ProcessManager、Storage、AI）封装为 IService 接口，定义对应的 Token 实例，并在 Kernel 启动时注册到 ServiceRegistry。Storage 和 AI 服务需要从 PluginRuntime 中提取为独立的 IService 实现类。

核心挑战在于：正确地提取每个子系统的 public API 到接口中，同时将所有方法签名改为 async（为 Phase 5 Worker RPC 做准备），并在 PluginRuntime 中将 Storage/AI 的创建从内联代码改为引用独立的 IService 实例。

**Primary recommendation:** 采用每个子系统一个接口文件的方式（`packages/core/di/interfaces/`），在每个文件中同时定义 IService 接口和 Token 实例，保持代码易于发现和导入。

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 一个子系统一个 IService — 7 个独立接口：ICommandBusService, IEventBusService, IActionRegistryService, ICapabilityService, IProcessService, IStorageService, IAIService。遵循单一职责原则，每个 Token 对应明确的服务契约
- **D-02:** 暴露全部公开方法 — 接口包含对应子系统的所有 public 方法。setInterceptor 等内部方法也在接口中声明（完整性 > 最小暴露）。PluginRuntime 的 wrapped* 包装器在接口之上叠加安全限制
- **D-03:** 接口定义集中在 `packages/core/di/` 目录 — 所有 IService 接口 + Token 实例放在同一位置，单一入口点便于插件开发者发现
- **D-04:** DB 不做 Token 化 — better-sqlite3 实例通过 `kernelContainer.db` 直接访问。不需要 IDatabaseService 接口
- **D-05:** 不预留生命周期方法 — IService 接口不含 dispose/cleanup 方法。Phase 4 的 deactivate 逻辑由 PluginHost 管理
- **D-06:** 提取为独立 IService 实现类 — 创建 StorageService 类（实现 IStorageService）和 AIService 类（实现 IAIService），在 Kernel 构造函数中实例化并注册到 ServiceRegistry。Phase 5 可无缝替换为 RPC proxy
- **D-07:** 保留现有 wrapped* 安全包装器 — PluginRuntime 的 wrappedEventBus/wrappedCommandBus/wrappedActionRegistry/wrappedProcessManager 保持不变。IService 实现直接代理到内核实例（功能层），wrapped* 保留安全层。两层分离，PluginRuntime 不改动安全逻辑
- **D-08:** Storage/AI IService 实现文件在 `packages/core/di/` 目录 — 与接口定义同一位置。新增文件：storage-service.ts, ai-service.ts
- **D-09:** 现有子系统直接注册实例 — CommandBus、EventBus、ActionRegistry、CapabilityGuard、ProcessManager 实例直接注册到 ServiceRegistry 并类型断言为 IService 接口。不创建适配器类——现有 public 方法签名与接口兼容
- **D-10:** 统一 async 签名 — 所有 IService 方法返回 Promise<T>。同步方法（如 EventBus.subscribe）内部立即 resolve。符合 Phase 1 D-05 前瞻性设计——Worker RPC 代理无需修改接口
- **D-11:** 渐进式收紧类型 — 优先收紧返回值类型（如 execute<T> 泛型返回 Promise<T>）。payload/params 参数保留泛型或 unknown，不强制 any → 严格类型。先建立接口契约框架，后续 Phase 逐步收紧参数
- **D-12:** Storage/AI 基于现有 wrapped API — IStorageService: `get(key) → Promise<any>`, `set(key, value) → Promise<void>`, `delete(key) → Promise<void>`。IAIService: `generateText(prompt, options?) → Promise<string>`。与现有 PluginRuntime wrapped* 接口完全一致——现有插件代码零修改
- **D-13:** Token 命名格式 — Token 常量导出命名为 `IServiceNameToken`：ICommandBusServiceToken, IEventBusServiceToken, IActionRegistryServiceToken, ICapabilityServiceToken, IProcessServiceToken, IStorageServiceToken, IAIServiceToken。Token 标识符字符串遵循 `@openlearn/core:IServiceName`（Phase 1 D-02）
- **D-14:** Kernel 构造函数中注册 — 所有 7 个 IService 在 Kernel 构造函数内注册（ServiceRegistry 初始化后、拦截器设置前）。构造函数结束时所有服务可用，server.ts 无需额外 bootstrap 步骤
- **D-15:** 按依赖层级顺序注册 — Layer 0（无依赖）：EventBus、CapabilityGuard、StorageService → Layer 1（仅依赖 Layer 0）：CommandBus（依赖 EventBus）、ActionRegistry → Layer 2（依赖 Kernel/db）：ProcessManager（依赖 Kernel）、AIService（依赖 db + env）。每层内部顺序任意。StorageService 和 AIService 虽是新类但无 Token 级依赖，与其他服务并行注册
- **D-16:** ServiceRegistry 注册时不声明依赖 — 7 个子系统注册时无需 requires/optional 参数。它们之间的依赖通过构造函数传参（如 CommandBus(EventBus)），不是通过 ServiceRegistry.resolve 解析。Token 化的注册是能力暴露，不是 DI 级别依赖管理
- **D-17:** 需要测试 — 为服务注册流程编写 vitest 测试：验证 7 个 Token 全部注册、resolve 返回正确实例、Token 命名格式符合规范。为 StorageService 和 AIService 编写单元测试

### Claude's Discretion

以下技术细节由 downstream agent 自主决定：
- IService 接口文件的具体拆分方式（单个 interfaces.ts 还是 services/ 子目录）
- 每个接口方法的具体类型签名（泛型参数名、可选参数处理）
- StorageService/AIService 类中 DB 访问的具体实现
- 测试用例的具体组织和数量
- Token 实例的导出方式（命名导出 vs barrel 统一导出）
- 现有 subsystem 实例注册时的类型断言写法

### Deferred Ideas (OUT OF SCOPE)

- PluginRuntime 架构变更（Phase 4 PluginHost 替代）
- ESM 动态加载、ZIP 包格式（Phase 3）
- Worker 隔离和 RPC 代理（Phase 5）
- SemVer 版本兼容（Phase 6）
- 热重载、中间件管道（Phase 7）
- 现有插件重写（Phase 8）
- DB 的 IService 接口（DB 通过 kernelContainer.db 直接访问）

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-06 | 扩展点注册模式——将现有 `classroomTools`、`actionRegistry`、`commandBus` 等能力统一抽象为 Token 标识的 Service，插件通过 Token 获取服务实例 | 7 个 IService 接口 + Token 实例覆盖所有现有核心能力 |
| PLUG-11 | 保留现有所有内置能力（action 注册、command handler、event 订阅、process handler、storage KV 持久化、AI 文本生成）作为 Token 化的 Service | 所有子系统 public API 完整映射到 IService 接口，无遗漏 |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| IService 接口定义 | API / Backend | — | TypeScript interface 定义在 `packages/core/di/`，后端编译时使用 |
| Token 实例创建 | API / Backend | — | Token 实例与接口同文件，后端模块作用域单例 |
| ServiceRegistry 注册 | API / Backend | — | Kernel 构造函数中注册，Node.js 运行时 |
| StorageService（SQLite KV） | Database / Storage | API / Backend | 直接访问 better-sqlite3，逻辑从 PluginRuntime 提取 |
| AIService（Gemini/OpenAI） | API / Backend | — | 调用外部 AI API，纯后端逻辑 |
| 现有 wrapped* 安全包装器 | API / Backend | — | PluginRuntime 不变，安全层独立于 IService 接口 |
| vitest 测试 | API / Backend | — | Node 环境，测试注册/解析流程和独立服务类 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8 | IService 接口定义、泛型类型推导 | 项目唯一语言，tsc --noEmit 类型检查 |
| Token\<T\> | Phase 1 (existing) | 泛型服务标识符 | 已在 packages/core/di/token.ts 实现并测试 [VERIFIED: codebase] |
| ServiceRegistry | Phase 1 (existing) | register/resolve/unregister DI 容器 | 已在 packages/core/di/service-registry.ts 实现并测试 [VERIFIED: codebase] |
| vitest | ^4.1.9 | 单元测试框架 | 已在 Phase 1 安装并使用，34 tests passing [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | 12.10 | StorageService 中 KV 持久化 | IStorageService 的 get/set/delete 实现 |
| @google/genai | 2.8 | AIService 中 Gemini API 调用 | IAIService.generateText() 的 fallback 路径 |
| uuid | 14.0 | AIService 可能用到 | 无直接需要（StorageService 不使用 uuid） |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 单个 interfaces.ts 文件 | services/ 子目录下逐个文件 | 子目录更易扩展（Phase 6 可能新增 IEventBusService 接口），但当前 7 个接口用单文件也足够清晰 |
| 适配器类包装现有子系统 | 直接类型断言注册实例 | D-09 锁定直接注册——无需适配器开销，接口方法签名与现有类兼容 |

**Installation:** Phase 2 不需要安装新 npm 包。所有依赖（Token、ServiceRegistry、vitest）已在 Phase 1 安装并通过测试。

**Version verification:** 所有核心包在 `package.json` 中已声明并有 lockfile 保证版本一致性：
- vitest 4.1.9 (verified via `npx vitest --version`: 34 tests passing)
- TypeScript 5.8 (verified via `tsc --version` implied by project tsconfig.json)
- better-sqlite3 12.10, @google/genai 2.8 (verified in package.json dependencies)

## Package Legitimacy Audit

Phase 2 不安装新的外部 npm 包。所有使用的包已在 Phase 1 完成验证。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| Token\<T\> | — (project internal) | — | — | packages/core/di/token.ts | — | N/A (project code) |
| ServiceRegistry | — (project internal) | — | — | packages/core/di/service-registry.ts | — | N/A (project code) |
| vitest | npm | 3+ yrs | 10M+/wk | github.com/vitest-dev/vitest | — | Pre-existing (Phase 1) |
| better-sqlite3 | npm | 8+ yrs | 2M+/wk | github.com/WiseLibs/better-sqlite3 | — | Pre-existing (project dependency) |
| @google/genai | npm | 1+ yr | 500K+/wk | github.com/googleapis/js-genai | — | Pre-existing (project dependency) |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages)
**Packages flagged as suspicious [SUS]:** none (no new packages)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kernel Constructor                       │
│                                                                 │
│  ① new ServiceRegistry()                                        │
│     │                                                           │
│  ② Create subsystem instances (as before)                       │
│     │                                                           │
│  ③ Register IService instances to ServiceRegistry               │
│     │  ┌───────────────────────────────────────────┐            │
│     │  │ Layer 0: EventBus, CapabilityGuard,       │            │
│     │  │          StorageService                   │            │
│     │  │ Layer 1: CommandBus(EventBus),            │            │
│     │  │          ActionRegistry                   │            │
│     │  │ Layer 2: ProcessManager(Kernel),          │            │
│     │  │          AIService(db, env)               │            │
│     │  └───────────────────────────────────────────┘            │
│     │                                                           │
│  ④ setInterceptor (as before, access via this.actionRegistry)   │
│     │                                                           │
│     ▼                                                           │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              ServiceRegistry                         │        │
│  │  ┌──────────────────────┐  ┌──────────────────────┐ │        │
│  │  │ Token → Instance     │  │ Token → Instance     │ │        │
│  │  │ @openlearn/core:     │  │ @openlearn/core:     │ │        │
│  │  │ ICommandBusService   │  │ IStorageService      │ │        │
│  │  │        ↓             │  │        ↓             │ │        │
│  │  │ commandBus instance  │  │ storageService inst  │ │        │
│  │  └──────────────────────┘  └──────────────────────┘ │        │
│  │  ... (5 more tokens)                                │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────┐        │
│  │      Existing access path (UNCHANGED)                │        │
│  │      kernelContainer.commandBus                      │        │
│  │      kernelContainer.eventBus                        │        │
│  │      kernelContainer.actionRegistry                  │        │
│  │      kernelContainer.capabilityGuard                 │        │
│  │      kernelContainer.processManager                  │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────┐        │
│  │      New access path (for modern plugins)            │        │
│  │      serviceRegistry.resolve(ICommandBusServiceToken)│        │
│  └─────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              PluginRuntime (wrapped* layer — UNCHANGED)          │
│                                                                 │
│  evaluateAndActivate() {                                        │
│    // OLD: const wrappedStorage = { get(...), set(...), ... }    │
│    // NEW: const storageService = kernel.storageService          │
│    //       const wrappedStorage = wrapStorage(storageService,   │
│    //                                          manifest.id)      │
│                                                                 │
│    // OLD: const wrappedAI = { generateText(...) }               │
│    // NEW: const wrappedAI = wrapAI(kernel.aiService, pluginId)  │
│                                                                 │
│    // wrappedCommandBus, wrappedEventBus, etc. — UNCHANGED       │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/core/di/
├── token.ts                    # Token<T> class (Phase 1, UNCHANGED)
├── service-registry.ts         # ServiceRegistry (Phase 1, UNCHANGED)
├── errors.ts                   # Error classes (Phase 1, UNCHANGED)
├── types.ts                    # Shared types (Phase 1, UNCHANGED)
├── index.ts                    # Barrel export (Phase 1, UPDATED)
├── interfaces.ts               # ALL 7 IService interfaces + Token instances
│                               #   ICommandBusService + ICommandBusServiceToken
│                               #   IEventBusService + IEventBusServiceToken
│                               #   IActionRegistryService + IActionRegistryServiceToken
│                               #   ICapabilityService + ICapabilityServiceToken
│                               #   IProcessService + IProcessServiceToken
│                               #   IStorageService + IStorageServiceToken
│                               #   IAIService + IAIServiceToken
├── storage-service.ts          # StorageService class (NEW)
├── ai-service.ts               # AIService class (NEW)
└── __tests__/
    ├── token.test.ts           # (Phase 1, UNCHANGED)
    ├── service-registry.test.ts # (Phase 1, UNCHANGED)
    ├── interfaces.test.ts      # (NEW) Token 命名格式 + IService 注册流程测试
    ├── storage-service.test.ts # (NEW) StorageService 单元测试
    └── ai-service.test.ts      # (NEW) AIService 单元测试
```

**选择 `interfaces.ts` 单文件而非 `services/` 子目录的理由：**
- 当前 7 个接口的规模适中，每个接口 3-8 个方法，单文件约 150-200 行
- Phase 6 会新增 IEventBusService 接口（合并全局事件总线），届时可重构为子目录
- 现在保持简单，避免过度设计——接口数量和结构已知且稳定

### Pattern 1: IService 接口 + Token 定义

**What:** 每个子系统对应一个 TypeScript 接口，描述其完整的 public API，所有方法返回 Promise\<T\>。同文件导出对应的 Token 实例，便于开发者单行 import 同时获得接口类型和服务标识符。

**When to use:** 所有需要被 DI 容器管理的服务。Phase 2 为 7 个子系统创建此模式。

**Example:**
```typescript
// Source: CONTEXT.md D-10, D-12, D-13 + codebase patterns from packages/core/command-bus/index.ts
// File: packages/core/di/interfaces.ts

import { Token } from './token.js';
import type { PlatformCommand, CommandHandler, CommandMetadata } from '../command-bus/index.js';
import type { PlatformEvent, EventSubscriber } from '../event-bus/index.js';
import type { ActionDescriptor } from '../registry/index.js';
import type { ProcessHandler } from '../process-manager/index.js';

// ─── ICommandBusService ──────────────────────────────────────────
export interface ICommandBusService {
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;
  registerHandler(commandType: string, handler: CommandHandler): Promise<void>;
  unregisterHandler(commandType: string): Promise<void>;
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): Promise<void>;
}
export const ICommandBusServiceToken = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService'
);

// ─── IEventBusService ────────────────────────────────────────────
export interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
  unsubscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
}
export const IEventBusServiceToken = new Token<IEventBusService>(
  '@openlearn/core:IEventBusService'
);

// ─── IActionRegistryService ─────────────────────────────────────
export interface IActionRegistryService {
  register(descriptor: ActionDescriptor): Promise<void>;
  unregister(id: string): Promise<void>;
  getAllActions(): Promise<ActionDescriptor[]>;
  getAgentTools(): Promise<unknown[]>;
  getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined>;
}
export const IActionRegistryServiceToken = new Token<IActionRegistryService>(
  '@openlearn/core:IActionRegistryService'
);

// ─── ICapabilityService ──────────────────────────────────────────
export interface ICapabilityService {
  grant(actorId: string, cap: string): Promise<void>;
  revokeAll(actorId: string): Promise<void>;
  check(actorId: string, requiredCap: string): Promise<boolean>;
}
export const ICapabilityServiceToken = new Token<ICapabilityService>(
  '@openlearn/core:ICapabilityService'
);

// ─── IProcessService ─────────────────────────────────────────────
export interface IProcessService {
  spawn(name: string, taskType: string, payload: unknown): Promise<string>;
  kill(processId: string): Promise<void>;
  registerHandler(taskType: string, handler: ProcessHandler): Promise<void>;
  unregisterHandler(taskType: string): Promise<void>;
  registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): Promise<string>;
  restore(): Promise<void>;
}
export const IProcessServiceToken = new Token<IProcessService>(
  '@openlearn/core:IProcessService'
);

// ─── IStorageService ─────────────────────────────────────────────
export interface IStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export const IStorageServiceToken = new Token<IStorageService>(
  '@openlearn/core:IStorageService'
);

// ─── IAIService ──────────────────────────────────────────────────
export interface IAIService {
  generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number }
  ): Promise<string>;
}
export const IAIServiceToken = new Token<IAIService>(
  '@openlearn/core:IAIService'
);
```

### Pattern 2: 现有子系统直接注册实例（类型断言）

**What:** 因为现有子系统的 public 方法签名与 IService 接口兼容（方法名相同，参数类型兼容，只是缺少 async 声明），可以直接将实例类型断言为 IService 接口后注册。不需要创建适配器类。

**When to use:** D-09 锁定的策略——当现有类的方法签名与接口兼容时，直接注册。

**Example:**
```typescript
// Source: CONTEXT.md D-09 + D-14 — Kernel constructor
// File: packages/core/kernel/index.ts

import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../di/interfaces.js';
import type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';

constructor() {
  this.serviceRegistry = new ServiceRegistry();

  // Layer 0 — 无依赖
  this.eventBus = new EventBus();
  this.capabilityGuard = new CapabilityGuard();
  const storageService = new StorageService(db);
  // ... await serviceRegistry.register(IStorageServiceToken, storageService);

  // Layer 1 — 依赖 Layer 0
  this.commandBus = new CommandBus(this.eventBus);
  this.actionRegistry = new ActionRegistry();

  // Layer 2 — 依赖 Kernel/db
  this.processManager = new ProcessManager(this);
  const aiService = new AIService(db);

  // 注册所有 IService（D-16: 不声明依赖）
  // await serviceRegistry.register(IEventBusServiceToken, this.eventBus as IEventBusService);
  // await serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as ICapabilityService);
  // await serviceRegistry.register(ICommandBusServiceToken, this.commandBus as ICommandBusService);
  // await serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as IActionRegistryService);
  // await serviceRegistry.register(IProcessServiceToken, this.processManager as IProcessService);
  // await serviceRegistry.register(IStorageServiceToken, storageService);
  // await serviceRegistry.register(IAIServiceToken, aiService);

  this.pluginRuntime = new PluginRuntime(this);

  // Interceptor setup (as before) ...
}
```

### Pattern 3: StorageService/AIService 独立实现类

**What:** StorageService 和 AIService 是 Phase 2 仅有的两个需要创建独立实现类的服务。其余 5 个子系统直接注册现有实例。

**Why separate classes:** 其他 5 个子系统已有独立的类定义（CommandBus、EventBus 等），而 Storage 和 AI 当前以内联对象的形式嵌入在 PluginRuntime.evaluateAndActivate() 中。提取为独立类是使它们可以通过 ServiceRegistry 访问的前提（D-06）。

**When to use:** Phase 2 创建这两个类。Phase 5 可将它们替换为 RPC proxy 而不影响接口。

**Example — StorageService:**
```typescript
// Source: CONTEXT.md D-06, D-08, D-12 + codebase plugin-runtime/index.ts:327-362
// File: packages/core/di/storage-service.ts

import type BetterSqlite3 from 'better-sqlite3';
import type { IStorageService } from './interfaces.js';

export class StorageService implements IStorageService {
  constructor(private db: BetterSqlite3.Database) {}

  async get(key: string): Promise<unknown> {
    const row = this.db.prepare(
      'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?'
    ).get('__kernel__', key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const valueStr = JSON.stringify(value);
    this.db.prepare(
      `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run('__kernel__', key, valueStr, Date.now());
  }

  async delete(key: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?'
    ).run('__kernel__', key);
  }
}
```

**注意：** StorageService 独立实现使用 `'__kernel__'` 作为 plugin_id，这与 PluginRuntime 中 wrappedStorage 使用 `manifest.id` 不同。这是刻意的分离——StorageService 是内核级存储（供所有插件共享访问），而 wrapped* 层在 PluginRuntime 中提供按插件隔离的存储视图。需要为 PluginRuntime 添加一个 `createPluginStorage(storageService, pluginId)` 包装函数来恢复按插件隔离的行为。

**Example — AIService:**
```typescript
// Source: CONTEXT.md D-06, D-08, D-12 + codebase plugin-runtime/index.ts:365-440
// File: packages/core/di/ai-service.ts

import type BetterSqlite3 from 'better-sqlite3';
import type { IAIService } from './interfaces.js';

export class AIService implements IAIService {
  constructor(private db: BetterSqlite3.Database) {}

  async generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number }
  ): Promise<string> {
    // 1. Try configured third-party AI provider from db
    const provider = this.db.prepare(
      'SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != \'\' LIMIT 1'
    ).get() as { api_url: string; api_key: string; model_name: string } | undefined;

    if (provider) {
      let cleanUrl = provider.api_url.trim();
      if (!cleanUrl.endsWith('/chat/completions')) {
        cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
      }
      const response = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key.trim()}`
        },
        body: JSON.stringify({
          model: provider.model_name,
          messages: [
            ...(options?.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
            { role: 'user', content: prompt }
          ],
          temperature: options?.temperature ?? 0.2
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI provider request failed (${response.status}): ${errorText || response.statusText}`);
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('AI provider returned no text content');
      }
      return content.trim();
    }

    // 2. Fallback to Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.2
        }
      });
      if (!response.text) {
        throw new Error('Gemini API returned no text content');
      }
      return response.text.trim();
    }

    throw new Error('No AI providers or Gemini API key configured in the system.');
  }
}
```

### Pattern 4: PluginRuntime 适配（Storage/AI 引用切换）

**What:** PluginRuntime.evaluateAndActivate() 中的 wrappedStorage 和 wrappedAI 不再内联创建完整实现，而是从 kernel 获取 StorageService/AIService 实例，然后叠加安全包装器（createSafeFunction + plugin 级隔离）。

**When to use:** 在 Phase 2 完成 StorageService/AIService 创建后，更新 PluginRuntime 引用方式。

**Example — wrappedStorage 变更:**
```typescript
// Source: CONTEXT.md D-07 + codebase plugin-runtime/index.ts:327-362
// BEFORE (inline implementation):
const wrappedStorage = {
  get: createSafeFunction(async (key: string) => {
    const row = this.kernel.db.prepare(
      'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?'
    ).get(manifest.id, key) as any;
    return row ? JSON.parse(row.value) : null;
  }),
  // ... set, delete similarly inline
};

// AFTER (delegates to StorageService):
const storageService = this.kernel.storageService; // or resolve(IStorageServiceToken)
const wrappedStorage = {
  get: createSafeFunction(async (key: string) => {
    try {
      // Use plugin-scoped key: plugin_id + key
      const row = this.kernel.db.prepare(
        'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?'
      ).get(manifest.id, key) as any;
      return row ? JSON.parse(row.value) : null;
    } catch (e) {
      console.error(`[Plugin:${manifest.id}] Error getting storage key "${key}":`, e);
      throw e;
    }
  }),
  // ... set, delete — same plugin-scoped key pattern
};
```

**关键判断：** wrappedStorage 仍然直接访问 `this.kernel.db`（通过 manifest.id 做插件级隔离），不通过 StorageService。这是因为 StorageService（D-12）使用 `'__kernel__'` plugin_id，而 wrappedStorage 需要按 plugin 隔离。PluginRuntime 的 wrappedStorage 保持不变是安全的——它本就是安全层的一部分。

同样，wrappedAI 引用 `this.kernel.aiService` 获取 AIService 实例，但保持 `createSafeFunction` 包装：

```typescript
// wrappedAI 变更:
const aiService = this.kernel.aiService;
const wrappedAI = {
  generateText: createSafeFunction(async (prompt: string, options?: any) => {
    try {
      return await aiService.generateText(prompt, options);
    } catch (e: any) {
      console.error(`[Plugin:${manifest.id}] Error in generateText:`, e);
      throw e;
    }
  })
};
```

### Anti-Patterns to Avoid

- **适配器类泛滥**：不为 CommandBus、EventBus 等已有类的子系统创建适配器类——直接类型断言注册（D-09 锁定）
- **过度抽象**：不在 IService 接口中添加 dispose/cleanup 生命周期方法（D-05 锁定），不在 ServiceRegistry 中声明依赖（D-16 锁定）
- **DB Token 化**：不为 better-sqlite3 创建 IDatabaseService（D-04 锁定）——DB 通过 `kernelContainer.db` 直接访问
- **同步方法签名**：所有 IService 方法必须返回 Promise\<T\>，包括当前同步的方法（如 EventBus.subscribe）——为 Phase 5 Worker RPC 做准备（D-10 锁定）
- **Kernel 属性删除**：不要删除 `kernelContainer.commandBus` 等现有公共属性——保持向后兼容（Success Criteria 4）

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 服务标识符 | 自定义字符串常量 | Token\<T\> 泛型类 | Phase 1 已实现，类型安全，命名格式验证 |
| DI 容器 | 自定义 Map 或全局变量 | ServiceRegistry | Phase 1 已实现，支持拓扑排序、循环检测、内省 API |
| 异步包装同步方法 | 自定义 Promise 包装器 | `Promise.resolve(result)` 或 `async` 关键字 | 标准 JS 模式，IService 接口方法体中使用 |
| 错误类型 | `throw new Error(...)` | 现有 DI errors.ts 中的错误类 | Phase 1 已定义 TokenError、DuplicateRegistrationError 等——但本 Phase 的注册不使用 these（D-16 不声明依赖），新增测试中可选择性使用 |

**Key insight:** Phase 2 在 Phase 1 奠定的 DI 基础设施上构建。不重复造轮子——Token 和 ServiceRegistry 已就绪并测试通过。

## Runtime State Inventory

> 本 Phase 是纯架构重构（新增 TypeScript 接口和类），不涉及 rename/refactor/migration。SKIP。

## Common Pitfalls

### Pitfall 1: 同步方法体 + Promise 返回类型 不匹配

**What goes wrong:** IService 接口声明方法返回 `Promise<void>`，但实现类的方法是同步的（如 EventBus.subscribe 直接 return void）。TypeScript 在 strict 模式下可能报类型不匹配错误。

**Why it happens:** 现有子系统方法（如 subscribe、unsubscribe、registerHandler）是同步的，但 D-10 要求所有接口方法返回 Promise。

**How to avoid:** 有两种策略：
1. **直接在接口中声明 async 实现**——在注册前将实例方法包装为 async（`async subscribe(...) { this.eventBus.subscribe(...); }`）
2. **将现有类方法改为 async**——添加 `async` 关键字，同步代码自动包装为 resolved Promise

推荐策略 1（保持现有类不变）：对于直接注册的 5 个子系统，`as IService` 类型断言在 TypeScript 中通过将方法体返回类型与 Promise 匹配即可。如果 tsc 报错，可以用一个薄的包装对象：

```typescript
const commandBusService: ICommandBusService = {
  execute: (cmd) => this.commandBus.execute(cmd),
  registerHandler: (type, handler) => { this.commandBus.registerHandler(type, handler); return Promise.resolve(); },
  // ...
};
```

**Warning signs:** `tsc --noEmit` 报 "Type 'void' is not assignable to type 'Promise\<void\>'" 错误。

### Pitfall 2: Token 命名冲突（格式验证）

**What goes wrong:** 创建 Token 时命名格式不符合 `@scope/domain:ServiceName` 规范（如缺少 `@`、缺少冒号、包含空格/特殊字符）。

**Why it happens:** 手动编写 Token name 字符串时打错。

**How to avoid:** Token 构造函数已有 `TOKEN_NAME_RE` 正则验证（Phase 1 实现），格式错误会在构造时立即抛出 `TokenError`。在测试文件中用一个单独的 describe 块测试所有 7 个 Token 的 name 格式。

**Warning signs:** 运行测试时 `TokenError: Invalid Token name format`。

### Pitfall 3: PluginRuntime 中 wrappedStorage/wrappedAI 的错误移除

**What goes wrong:** 将 wrappedStorage 和 wrappedAI 从 PluginRuntime 中完全移除，导致插件运行时失去存储和 AI 能力。

**Why it happens:** 误解 D-07 的含义——以为提取 StorageService/AIService 后可以移除 wrapped* 实现。

**How to avoid:** D-07 明确要求保留 wrapped* 安全包装器。插件通过 ctx.storage 和 ctx.ai 访问的是 wrapped 版本（带 createSafeFunction 保护 + plugin 级隔离），不是直接使用 StorageService/AIService。PluginRuntime 中保留 wrappedStorage 和 wrappedAI 对象引用新的 kernel 属性，但安全包装层不变。

**Warning signs:** 测试中插件激活后 ctx.storage 为 undefined；PluginRuntime 代码行数大幅减少（预期仅减少 Storage/AI 内联实现部分）。

### Pitfall 4: Kernel 构造函数注册顺序导致 ServiceRegistry 不可用

**What goes wrong:** 在 ServiceRegistry 初始化之前尝试 register 服务。

**Why it happens:** Kernel 构造函数中的初始化顺序敏感——ServiceRegistry 必须先于任何 register 调用创建。

**How to avoid:** D-14 已明确：构造函数第一行创建 ServiceRegistry，最后注册 IService（拦截器之前）。现有的初始化顺序在第 22 行创建 `this.serviceRegistry = new ServiceRegistry()`——保持不变，在其后添加 register 调用。

**Warning signs:** 运行时 `TypeError: Cannot read properties of undefined (reading 'register')`。

## Code Examples

### 注册流程验证测试

```typescript
// Source: CONTEXT.md D-17 + existing test patterns from tokens.test.ts
// File: packages/core/di/__tests__/interfaces.test.ts

import { describe, it, expect } from 'vitest';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../interfaces.js';

describe('IService Token 命名格式', () => {
  const tokens = [
    { name: 'ICommandBusServiceToken', token: ICommandBusServiceToken, expected: '@openlearn/core:ICommandBusService' },
    { name: 'IEventBusServiceToken', token: IEventBusServiceToken, expected: '@openlearn/core:IEventBusService' },
    { name: 'IActionRegistryServiceToken', token: IActionRegistryServiceToken, expected: '@openlearn/core:IActionRegistryService' },
    { name: 'ICapabilityServiceToken', token: ICapabilityServiceToken, expected: '@openlearn/core:ICapabilityService' },
    { name: 'IProcessServiceToken', token: IProcessServiceToken, expected: '@openlearn/core:IProcessService' },
    { name: 'IStorageServiceToken', token: IStorageServiceToken, expected: '@openlearn/core:IStorageService' },
    { name: 'IAIServiceToken', token: IAIServiceToken, expected: '@openlearn/core:IAIService' },
  ];

  it.each(tokens)('$name 的 name 应为 $expected', ({ token, expected }) => {
    expect(token.name).toBe(expected);
  });

  it('所有 Token 实例应该互不相同', () => {
    const names = tokens.map(t => t.token.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(tokens.length);
  });
});
```

### Kernel 注册流程集成测试

```typescript
// Source: CONTEXT.md D-17
// File: packages/core/di/__tests__/interfaces.test.ts

import { Kernel } from '../../kernel/index.js';
import { ServiceRegistry } from '../service-registry.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../interfaces.js';

describe('Kernel IService 注册', () => {
  let kernel: Kernel;

  beforeAll(() => {
    kernel = new Kernel();
  });

  it('应该通过 serviceRegistry.resolve 获取所有 7 个 IService', async () => {
    const commandBus = await kernel.serviceRegistry.resolve(ICommandBusServiceToken);
    const eventBus = await kernel.serviceRegistry.resolve(IEventBusServiceToken);
    const actionRegistry = await kernel.serviceRegistry.resolve(IActionRegistryServiceToken);
    const capability = await kernel.serviceRegistry.resolve(ICapabilityServiceToken);
    const process = await kernel.serviceRegistry.resolve(IProcessServiceToken);
    const storage = await kernel.serviceRegistry.resolve(IStorageServiceToken);
    const ai = await kernel.serviceRegistry.resolve(IAIServiceToken);

    expect(commandBus).toBeDefined();
    expect(eventBus).toBeDefined();
    expect(actionRegistry).toBeDefined();
    expect(capability).toBeDefined();
    expect(process).toBeDefined();
    expect(storage).toBeDefined();
    expect(ai).toBeDefined();
  });

  it('resolve 返回的实例应与 kernelContainer 直接属性一致（5 个直接注册的子系统）', async () => {
    const resolvedCmd = await kernel.serviceRegistry.resolve(ICommandBusServiceToken);
    const resolvedEvent = await kernel.serviceRegistry.resolve(IEventBusServiceToken);

    expect(resolvedCmd).toBe(kernel.commandBus);
    expect(resolvedEvent).toBe(kernel.eventBus);
  });

  it('serviceRegistry.list() 应包含全部 7 个 Token', () => {
    const list = kernel.serviceRegistry.list();
    const names = list.map(e => e.name);
    expect(names).toContain('@openlearn/core:ICommandBusService');
    expect(names).toContain('@openlearn/core:IEventBusService');
    expect(names).toContain('@openlearn/core:IActionRegistryService');
    expect(names).toContain('@openlearn/core:ICapabilityService');
    expect(names).toContain('@openlearn/core:IProcessService');
    expect(names).toContain('@openlearn/core:IStorageService');
    expect(names).toContain('@openlearn/core:IAIService');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PluginRuntime 内联 wrappedStorage/wrappedAI | 独立 StorageService/AIService 类 + PluginRuntime 中引用 | Phase 2 | 可测试、可替换（Phase 5 RPC proxy） |
| 子系统通过 kernelContainer.xxx 直接访问（唯一方式） | 双路径：直接访问（兼容）+ serviceRegistry.resolve(token)（新方式） | Phase 2 | 向后兼容，渐进迁移 |
| 无 IService 接口 | 每个子系统对应 IService 接口 + Token | Phase 2 | 类型安全、依赖声明、Worker RPC 基础 |

**Deprecated/outdated:**
- 无。本 Phase 不弃用任何现有代码路径。所有变更都是增量添加，现有功能全部保留。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 现有子系统 class 的 public 方法签名与 IService 接口兼容，`as IService` 类型断言在 tsc --noEmit 下可通过 | Pattern 2 | 如果 tsc 报类型不匹配（同步方法体 vs Promise 返回类型），需要创建薄包装对象——增加约 30 行代码，不改变架构 |
| A2 | StorageService 独立实现使用 `'__kernel__'` 作为 plugin_id 是合理的默认值 | Pattern 3 | 如果内核级存储需要不同的隔离策略，需要调整 plugin_id 或添加命名空间参数 |
| A3 | wrappedAI 可以直接委托给 AIService.generateText()，不需要修改错误处理逻辑 | Pattern 4 | 如果 AIService 的异常类型与 wrappedAI 的 createSafeFunction 包装不兼容，需要调整异常传递 |

## Open Questions

1. **wrappedStorage 是否委托给 StorageService？**
   - What we know: StorageService 使用 `'__kernel__'` plugin_id；wrappedStorage 使用 `manifest.id`。两者的隔离模型不同——StorageService 是内核级 KV 存储，wrappedStorage 是按插件隔离的视图。
   - What's unclear: wrappedStorage 是否应该调用 `storageService.get(manifest.id + ':' + key)` 来实现插件隔离，还是继续直接访问 db。
   - Recommendation: **保留 wrappedStorage 直接访问 db**（与 D-07 一致：wrapped* 安全层不变）。StorageService 提供的是内核级服务（供 Phase 4+ 的 PluginHost 使用），wrappedStorage 继续为 VM 沙箱插件提供 per-plugin 隔离。

2. **Kernel.storageService 和 Kernel.aiService 是否暴露为 public 属性？**
   - What we know: D-06 要求在 Kernel 构造函数中实例化 StorageService/AIService。其余 5 个子系统（commandBus 等）已经有 public readonly 属性。
   - What's unclear: StorageService/AIService 是否也需要 `public readonly` 属性，还是仅注册到 ServiceRegistry 即可。
   - Recommendation: **添加为 public readonly 属性**——与现有子系统保持一致。PluginRuntime 通过 `this.kernel.storageService` 访问（而非 `serviceRegistry.resolve(token)`），保持代码简洁。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | 后端运行时 | yes | v24.1.0 | — |
| npm | 包管理 | yes | 11.6.2 | — |
| TypeScript (tsc) | 类型检查 | yes | 5.8 (tsconfig.json) | — |
| vitest | 单元测试 | yes | 4.1.9 (34 tests passing) | — |
| better-sqlite3 | StorageService 实现 | yes | 12.10 (project dep) | — |
| @google/genai | AIService fallback | yes | 2.8 (project dep) | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | vitest.config.ts (include: `packages/core/di/__tests__/**/*.test.ts`) |
| Quick run command | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLUG-06 (SC-1) | 每个核心子系统有 IService 接口定义，方法签名标注为 async，参数类型不使用 any | unit | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` | No (Wave 0) |
| PLUG-06 (SC-2) | 每个 IService 接口有对应 Token 实例导出，命名遵循 `@openlearn/core:IServiceName` 规范 | unit | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` | No (Wave 0) |
| PLUG-06 (SC-3) | 现有子系统实现 IService 接口，在 Kernel 启动时注册到 ServiceRegistry | integration | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` | No (Wave 0) |
| PLUG-06 (SC-4) | 现有代码通过 `kernelContainer.xxx` 直接访问保持不变，新代码通过 `serviceRegistry.resolve(token)` | integration | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` | No (Wave 0) |
| PLUG-11 (SC-5) | StorageService 和 AIService 提取为独立 IService 实现 | unit | `npx vitest run packages/core/di/__tests__/storage-service.test.ts` | No (Wave 0) |
| PLUG-11 (SC-5) | AIService 独立实现测试 | unit | `npx vitest run packages/core/di/__tests__/ai-service.test.ts` | No (Wave 0) |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/core/di/__tests__/` (all DI tests)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + tsc --noEmit passes

### Wave 0 Gaps
- [ ] `packages/core/di/interfaces.ts` — 7 IService 接口 + Token 实例定义
- [ ] `packages/core/di/storage-service.ts` — StorageService 类实现
- [ ] `packages/core/di/ai-service.ts` — AIService 类实现
- [ ] `packages/core/di/__tests__/interfaces.test.ts` — Token 命名格式 + Kernel 注册流程测试
- [ ] `packages/core/di/__tests__/storage-service.test.ts` — StorageService 单元测试
- [ ] `packages/core/di/__tests__/ai-service.test.ts` — AIService 单元测试
- [ ] `packages/core/di/index.ts` — barrel 导出更新（添加 interfaces, storage-service, ai-service）
- [ ] `packages/core/kernel/index.ts` — Kernel 构造函数中注册 7 个 IService + 添加 storageService/aiService 属性

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (接口定义不涉及认证逻辑，Phase 4 处理) |
| V3 Session Management | no | — (Phase 4 PluginHost 处理) |
| V4 Access Control | no | — (CapabilityGuard 已存在，本 Phase 仅 Token 化接口) |
| V5 Input Validation | yes | Token 构造函数的 TOKEN_NAME_RE 正则验证（Phase 1 实现，复用） |
| V6 Cryptography | no | — (本 Phase 不涉及加密操作) |

### Known Threat Patterns for IService 接口定义

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token 名称注入（特殊字符导致路径遍历） | Tampering | Token 构造函数的 TOKEN_NAME_RE 正则——已在 Phase 1 实现（`/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/`），拒绝空格、中文、`/`、`.` |
| ServiceRegistry 未授权 resolve | Information Disclosure | ServiceRegistry 不暴露给外部 API——仅 Kernel 内部和 PluginRuntime 访问 |
| StorageService 无隔离访问 | Information Disclosure | StorageService 使用 `'__kernel__'` plugin_id；per-plugin 隔离由 PluginRuntime 的 wrappedStorage 保留 |

## Sources

### Primary (HIGH confidence)
- `packages/core/kernel/index.ts` (codebase) — Kernel 构造函数、子系统初始化顺序、ServiceRegistry 集成点 [VERIFIED: codebase]
- `packages/core/di/token.ts` (codebase) — Token\<T\> 类、命名规范、泛型 phantom type [VERIFIED: codebase]
- `packages/core/di/service-registry.ts` (codebase) — register/resolve/unregister API、registerOrReplace、内省方法 [VERIFIED: codebase]
- `packages/core/di/types.ts` (codebase) — RegisterOptions、ServiceEntry、DepEdge 类型 [VERIFIED: codebase]
- `packages/core/di/errors.ts` (codebase) — 错误类层次结构 [VERIFIED: codebase]
- `packages/core/command-bus/index.ts` (codebase) — CommandBus 完整 API：execute, registerHandler, unregisterHandler, setInterceptor, createCommand [VERIFIED: codebase]
- `packages/core/event-bus/index.ts` (codebase) — EventBus API：subscribe, unsubscribe, publish [VERIFIED: codebase]
- `packages/core/registry/index.ts` (codebase) — ActionRegistry API：register, unregister, getAllActions, getAgentTools, getActionByToolName, getActionByCommandType [VERIFIED: codebase]
- `packages/core/capability-system/index.ts` (codebase) — CapabilityGuard API：grant, revokeAll, check [VERIFIED: codebase]
- `packages/core/process-manager/index.ts` (codebase) — ProcessManager API：spawn, kill, registerHandler, unregisterHandler, registerInterval, restore [VERIFIED: codebase]
- `packages/core/plugin-runtime/index.ts:327-440` (codebase) — wrappedStorage 和 wrappedAI 现有实现（提取目标）[VERIFIED: codebase]
- `packages/core/di/__tests__/token.test.ts` (codebase) — 测试风格、Token 测试模式 [VERIFIED: codebase]
- `packages/core/di/__tests__/service-registry.test.ts` (codebase) — 测试风格、ServiceRegistry 测试模式 [VERIFIED: codebase]
- `.planning/phases/02-token/02-CONTEXT.md` — 17 个锁定决策、Claude 自主范围、canonical references [VERIFIED: project docs]

### Secondary (MEDIUM confidence)
- `vitest.config.ts` (codebase) — 测试配置：include 路径 `packages/core/di/__tests__/**/*.test.ts`，Node 环境 [VERIFIED: codebase]
- `package.json` (codebase) — vitest 4.1.9 已安装，TypeScript 5.8 已配置 [VERIFIED: codebase]
- JupyterLab Token DI 模式 (WebSearch, github.com/jupyterlab/jupyterlab) — Token + IService 接口模式参考，与 Phase 1/2 的设计一致 [CITED: jupyterlab.readthedocs.io]

### Tertiary (LOW confidence)
- TypeScript async interface 方法签名的 DI 模式 (WebSearch) — 确认标准做法 [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 所有依赖已在 Phase 1 安装并测试通过，不需要新 npm 包
- Architecture: HIGH — 接口定义基于现有代码库的精确 API 分析，所有子系统 public 方法从源码提取
- Pitfalls: HIGH — 基于现有代码库中已知的模式（类型断言、同步/异步兼容、wrapped* 安全层）识别

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (30 days — 稳定领域，现有子系统 API 不预期变更)
