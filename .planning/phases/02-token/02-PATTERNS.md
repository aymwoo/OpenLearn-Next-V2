# Phase 2: 现有能力 Token 化 - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 8 (5 new + 3 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/core/di/interfaces.ts` | model (接口定义) | request-response | `packages/core/di/token.ts`（同目录文件结构）+ `packages/core/command-bus/index.ts`（接口结构） | role-match |
| `packages/core/di/storage-service.ts` | service | CRUD | `packages/core/di/service-registry.ts`（DI 目录实现类）+ `packages/core/plugin-runtime/index.ts:327-362`（业务逻辑来源） | role-match |
| `packages/core/di/ai-service.ts` | service | request-response | `packages/core/di/service-registry.ts`（DI 目录实现类）+ `packages/core/plugin-runtime/index.ts:365-440`（业务逻辑来源） | role-match |
| `packages/core/di/__tests__/interfaces.test.ts` | test | n/a | `packages/core/di/__tests__/token.test.ts` + `packages/core/di/__tests__/service-registry.test.ts` | exact |
| `packages/core/di/__tests__/storage-service.test.ts` | test | n/a | `packages/core/di/__tests__/service-registry.test.ts`（测试风格） | role-match |
| `packages/core/di/__tests__/ai-service.test.ts` | test | n/a | `packages/core/di/__tests__/service-registry.test.ts`（测试风格） | role-match |
| `packages/core/di/index.ts` (修改) | config (barrel) | n/a | 自身（已有 barrel 结构，仅新增导出） | exact |
| `packages/core/kernel/index.ts` (修改) | controller (内核) | request-response | 自身（已有构造函数，仅新增注册逻辑） | exact |

## Pattern Assignments

### 1. `packages/core/di/interfaces.ts` (接口定义 + Token 实例)

**角色:** IService 接口 + Token 实例集中定义文件。包含 7 个 Interface 和 7 个 const Token 导出。
**数据流:** 不涉及运行时数据流——纯 TypeScript 编译时类型 + 模块作用域常量。

**类比文件 A — 接口结构:** `packages/core/command-bus/index.ts`（IService 方法签名来源于现有子系统的 public API）

**类比文件 B — 文件头文档注释样式:** `packages/core/di/token.ts`（第 1-23 行）
```typescript
/**
 * Token<T> — a type-safe service identifier for the DI container.
 *
 * Inspired by the JupyterLab/Lumino Token design pattern.  The generic
 * parameter `T` is a **phantom type**: it carries the service interface
 * type at compile time but is never used at runtime.
 *
 * ## Naming convention
 * ...
 */
import { TokenError } from './errors.js';
```

**类比文件 C — Token 创建模式:** `packages/core/di/token.ts`（第 32-58 行）
```typescript
export class Token<T> {
  private readonly _phantomService!: T;
  public readonly name: string;

  constructor(name: string) { ... }
}
```
使用模式（测试文件中）:
```typescript
const token = new Token<ICommandBusService>('@openlearn/core:ICommandBusService');
```

**核心模式提取：**

IService 接口方法签名从现有子系统类中提取（D-02：暴露全部 public 方法，D-10：统一 async 签名）:

**来自 CommandBus (`packages/core/command-bus/index.ts` 第 24-82 行):**
```typescript
// 现有签名（同步）:
public setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>) { ... }
public registerHandler(commandType: string, handler: CommandHandler) { ... }
public unregisterHandler(commandType: string) { ... }
public async execute<T extends PlatformCommand>(command: T): Promise<any> { ... }
public createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): PlatformCommand<T> { ... }

// IService 接口映射（全部改 async Promise 返回）:
export interface ICommandBusService {
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;
  registerHandler(commandType: string, handler: CommandHandler): Promise<void>;
  unregisterHandler(commandType: string): Promise<void>;
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): Promise<void>;
}
```

**来自 EventBus (`packages/core/event-bus/index.ts` 第 12-37 行):**
```typescript
// 现有签名:
public subscribe(eventType: string, subscriber: EventSubscriber) { ... }  // 同步 void
public unsubscribe(eventType: string, subscriber: EventSubscriber) { ... } // 同步 void
public async publish(event: PlatformEvent) { ... }  // 已是 async

// IService 接口映射:
export interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
  unsubscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
}
```

**来自 ActionRegistry (`packages/core/registry/index.ts` 第 10-58 行):**
```typescript
// 现有签名（全部同步）:
public register(descriptor: ActionDescriptor): void { ... }
public unregister(id: string): void { ... }
public getAllActions(): ActionDescriptor[] { ... }
public getAgentTools(): any[] { ... }
public getActionByToolName(toolName: string): ActionDescriptor | undefined { ... }
public getActionByCommandType(commandType: string): ActionDescriptor | undefined { ... }

// IService 接口映射:
export interface IActionRegistryService {
  register(descriptor: ActionDescriptor): Promise<void>;
  unregister(id: string): Promise<void>;
  getAllActions(): Promise<ActionDescriptor[]>;
  getAgentTools(): Promise<unknown[]>;
  getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined>;
}
```

**来自 CapabilityGuard (`packages/core/capability-system/index.ts` 第 1-51 行):**
```typescript
// 现有签名（全部同步）:
public grant(actorId: string, cap: string) { ... }
public revokeAll(actorId: string) { ... }
public check(actorId: string, requiredCap: string): boolean { ... }

// IService 接口映射:
export interface ICapabilityService {
  grant(actorId: string, cap: string): Promise<void>;
  revokeAll(actorId: string): Promise<void>;
  check(actorId: string, requiredCap: string): Promise<boolean>;
}
```

**来自 ProcessManager (`packages/core/process-manager/index.ts` 第 13-157 行):**
```typescript
// 现有签名:
public registerHandler(taskType: string, handler: ProcessHandler) { ... }
public unregisterHandler(taskType: string) { ... }
public restore() { ... }
public spawn(name: string, taskType: string, payload: any): string { ... }
public kill(processId: string) { ... }
public registerInterval(name: string, intervalMs: number, tickFn: ...): string { ... }

// IService 接口映射:
export interface IProcessService {
  spawn(name: string, taskType: string, payload: unknown): Promise<string>;
  kill(processId: string): Promise<void>;
  registerHandler(taskType: string, handler: ProcessHandler): Promise<void>;
  unregisterHandler(taskType: string): Promise<void>;
  registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): Promise<string>;
  restore(): Promise<void>;
}
```

**来自 PluginRuntime wrappedStorage + wrappedAI (`packages/core/plugin-runtime/index.ts` 第 327-440 行):**
```typescript
// IStorageService — 基于 wrappedStorage API (D-12):
export interface IStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// IAIService — 基于 wrappedAI.generateText API (D-12):
export interface IAIService {
  generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number }
  ): Promise<string>;
}
```

**Token 实例导出模式（D-13：命名格式 `IServiceNameToken`，标识符 `@openlearn/core:IServiceName`）：**
```typescript
export const ICommandBusServiceToken = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService'
);
// ... 其他 6 个 Token 相同模式
```

**导入外部类型（需从各子系统导出类型）：**
```typescript
import { Token } from './token.js';
import type { PlatformCommand, CommandHandler, CommandMetadata } from '../command-bus/index.js';
import type { PlatformEvent, EventSubscriber } from '../event-bus/index.js';
import type { ActionDescriptor } from '../registry/index.js';
import type { ProcessHandler } from '../process-manager/index.js';
```

---

### 2. `packages/core/di/storage-service.ts` (独立 IService 实现类)

**角色:** service 实现类，实现 IStorageService 接口。
**数据流:** CRUD（SQLite plugin_storage 表的 get/set/delete）。

**类比文件 A — DI 目录中实现类的导入风格:** `packages/core/di/service-registry.ts`（第 24-31 行）
```typescript
import type { RegisterOptions, ServiceEntry, DepEdge } from './types.js';
import { Token } from './token.js';
import {
  DuplicateRegistrationError,
  MissingDependencyError,
  CircularDependencyError,
  HasDependentError,
} from './errors.js';
```

**类比文件 B — 业务逻辑来源:** `packages/core/plugin-runtime/index.ts`（第 327-362 行）
```typescript
// wrappedStorage 的核心 DB 操作:
// get: this.kernel.db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?').get(manifest.id, key)
// set: INSERT ... ON CONFLICT(plugin_id, key) DO UPDATE SET value = ...
// delete: DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?
```

**核心模式提取：**
```typescript
// 文件头注释（从 token.ts 第 1-23 行模仿）:
/**
 * StorageService — kernel-level persistent key-value storage.
 *
 * Implements IStorageService using SQLite `plugin_storage` table.
 * Uses '__kernel__' as the plugin_id namespace; per-plugin isolation
 * is provided by PluginRuntime's wrappedStorage wrapper layer.
 */

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

**构造函数模式（来自插件系统构造函数传参）：**
- `ProcessManager` 构造函数接收 `Kernel` 实例：`constructor(private kernel: Kernel) {}`（`packages/core/process-manager/index.ts` 第 17 行）
- `CommandBus` 构造函数接收 `EventBus` 实例：`constructor(private eventBus: EventBus) {}`（`packages/core/command-bus/index.ts` 第 28 行）
- StorageService 构造函数接收 `BetterSqlite3.Database` 实例（与 Phase 2 D-15 一致：Layer 0，无 Token 级依赖）

---

### 3. `packages/core/di/ai-service.ts` (独立 IService 实现类)

**角色:** service 实现类，实现 IAIService 接口。
**数据流:** request-response（通过 HTTP fetch 调用第三方 AI API 或 Gemini SDK）。

**类比文件 A — 文件结构:** 同 storage-service.ts（DI 目录实现类模式）。

**类比文件 B — 业务逻辑来源:** `packages/core/plugin-runtime/index.ts`（第 364-440 行）
```typescript
// wrappedAI.generateText 的完整逻辑：
// 1. 从 ai_providers 表查找配置的第三方 AI：db.prepare('SELECT ... FROM ai_providers WHERE api_key IS NOT NULL ...')
// 2. 如果存在，发送 OpenAI 兼容 POST 请求到 provider.api_url + '/chat/completions'
// 3. 如果不存在，fallback 到 Gemini via GoogleGenAI SDK
// 4. 如果没有配置任何 provider，抛出异常
```

**核心模式提取：**
```typescript
/**
 * AIService — kernel-level AI text generation.
 *
 * Implements IAIService with a two-tier fallback:
 * 1. Third-party AI providers (OpenAI-compatible) configured in the DB
 * 2. Google Gemini via the @google/genai SDK
 *
 * Mirrors the wrappedAI logic from PluginRuntime (plugin-runtime/index.ts:364-440).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { IAIService } from './interfaces.js';

export class AIService implements IAIService {
  constructor(private db: BetterSqlite3.Database) {}

  async generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number }
  ): Promise<string> {
    // 1. Try third-party AI provider from db
    const provider = this.db.prepare(
      'SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != \'\' LIMIT 1'
    ).get() as { api_url: string; api_key: string; model_name: string } | undefined;

    if (provider) {
      // ... OpenAI-compatible API call (复用 wrappedAI 逻辑)
    }

    // 2. Fallback to Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      // ... Gemini API call (复用 wrappedAI 逻辑)
    }

    throw new Error('No AI providers or Gemini API key configured in the system.');
  }
}
```

**错误处理模式（来自 wrappedAI 和现有子系统）：**
- `throw new Error(...)` — 项目不使用自定义错误类（`packages/core/command-bus/index.ts` 第 36、57 行）
- `console.error(...)` 标签前缀：`[Plugin:${manifest.id}]` — AIService 使用 `[AIService]` 标签

---

### 4. `packages/core/di/__tests__/interfaces.test.ts` (测试 — Token 命名格式 + Kernel 注册流程)

**角色:** vitest 单元测试/集成测试。
**数据流:** 不适用（测试文件）。

**类比文件 A — 测试风格和导入模式:** `packages/core/di/__tests__/token.test.ts`（完整文件，95 行）

**核心模式提取：**

**导入模式（第 12-13 行）：**
```typescript
import { describe, it, expect } from 'vitest';
import { Token } from '../token.js';
import { TokenError } from '../errors.js';
```

**describe/it 结构（第 16-94 行）：**
```typescript
describe('Token<T>', () => {
  it('should ...', () => { ... });
  it.each([...])('should ...', (param) => { ... });  // 参数化测试
});
```

**类比文件 B — 集成测试模式 (resolve + 断言):** `packages/core/di/__tests__/service-registry.test.ts`（完整文件，397 行）

**注册/解析模式（第 54-65 行）：**
```typescript
describe('ServiceRegistry — basic register and resolve', () => {
  it('should register and resolve a service instance (SC-2)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');
    const instance = makeService('serviceA');

    await registry.register(token, instance);
    const resolved = await registry.resolve(token);

    expect(resolved).toBe(instance);
    expect(resolved.name).toBe('serviceA');
  });
});
```

**list() 内省测试模式（第 331-345 行）：**
```typescript
it('should list all registered tokens (D-10)', async () => {
  const registry = new ServiceRegistry();
  // ... register ...
  const list = registry.list();
  expect(list).toHaveLength(2);
  expect(list.map((e) => e.name).sort()).toEqual([...]);
});
```

**测试文件导入路径约定（使用 `.js` 扩展名）：**
```typescript
import { Token } from '../token.js';                           // 相对路径 + .js 扩展名
import { ServiceRegistry } from '../service-registry.js';      // 同目录模块
import { ... } from '../errors.js';                            // 错误类
import { describe, it, expect } from 'vitest';                 // vitest 框架
```

**关键测试用例结构（需实现 3 个 describe 块）：**
1. `describe('IService Token 命名格式')` — it.each 验证 7 个 Token.name 格式 + 唯一性
2. `describe('Kernel IService 注册')` — 创建 Kernel 实例，通过 serviceRegistry.resolve 获取所有 7 个服务，验证实例一致性
3. `describe('Kernel IService 内省')` — serviceRegistry.list() 验证包含全部 7 个 Token name

---

### 5. `packages/core/di/__tests__/storage-service.test.ts` (测试 — StorageService 单元测试)

**角色:** vitest 单元测试。
**数据流:** 不适用（测试文件）。

**类比文件:** `packages/core/di/__tests__/service-registry.test.ts`（测试风格）

**核心模式提取：**
- 导入风格相同：`import { describe, it, expect, beforeEach, afterEach } from 'vitest';`
- 可能需要 `better-sqlite3` 内存数据库（`:memory:`）来独立测试
- `beforeEach` 创建表结构 + StorageService 实例
- `afterEach` 清理
- 测试 get/set/delete 三个方法的正常路径和边界情况（key 不存在返回 null，覆盖写入等）

---

### 6. `packages/core/di/__tests__/ai-service.test.ts` (测试 — AIService 单元测试)

**角色:** vitest 单元测试。
**数据流:** 不适用（测试文件）。

**类比文件:** `packages/core/di/__tests__/service-registry.test.ts`（测试风格）

**核心模式提取：**
- 同上导入风格
- AIService 依赖 `better-sqlite3` db + `process.env.GEMINI_API_KEY` + 网络 fetch
- 单元测试应 mock fetch 和 @google/genai：使用 `vi.mock()` 或 `vi.fn()`
- 测试场景：无 provider 无 Gemini key → 抛异常；有 provider → 调用 fetch；有 Gemini key → 调用 genai SDK

---

### 7. `packages/core/di/index.ts` (修改 — barrel 导出更新)

**角色:** barrel 导出文件。
**数据流:** 不适用（模块重导出）。

**类比文件:** `packages/core/di/index.ts`（第 1-19 行）自身。

**现有内容：**
```typescript
/**
 * DI (Dependency Injection) subsystem barrel export.
 *
 * Provides:
 * - Token<T> — type-safe service identifier
 * - ServiceRegistry — register / resolve / unregister container
 * - Error classes — named error hierarchy for all DI failure paths
 * - Types — shared type definitions
 */
export { Token } from './token.js';
export { ServiceRegistry } from './service-registry.js';
export {
  DuplicateRegistrationError,
  MissingDependencyError,
  CircularDependencyError,
  HasDependentError,
  TokenError,
} from './errors.js';
export type { RegisterOptions, ServiceEntry, DepEdge } from './types.js';
```

**修改模式 — 在现有导出后新增（遵循相同格式）：**
```typescript
// 新增 IService 接口导出
export type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
} from './interfaces.js';

// 新增 Token 实例导出
export {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from './interfaces.js';

// 新增服务实现类导出
export { StorageService } from './storage-service.js';
export { AIService } from './ai-service.js';
```

**注意:** `export type { ... }` vs `export { ... }` 的区分——接口类型使用 `export type`，Token 实例和服务类使用 `export`。

---

### 8. `packages/core/kernel/index.ts` (修改 — 注册 IService)

**角色:** Kernel 构造函数——添加 IService 注册逻辑。
**数据流:** 构造函数初始化顺序。

**类比文件:** `packages/core/kernel/index.ts`（第 11-81 行）自身。

**现有构造函数结构（第 21-57 行）：**
```typescript
constructor() {
  this.serviceRegistry = new ServiceRegistry();          // 第 22 行
  this.eventBus = new EventBus();                        // 第 23 行
  this.commandBus = new CommandBus(this.eventBus);       // 第 24 行
  this.actionRegistry = new ActionRegistry();            // 第 25 行
  this.capabilityGuard = new CapabilityGuard();          // 第 26 行
  this.pluginRuntime = new PluginRuntime(this);          // 第 27 行
  this.processManager = new ProcessManager(this);        // 第 28 行

  // 拦截器设置（第 31-57 行）
  this.commandBus.setInterceptor(async (command) => { ... });
}
```

**修改模式（D-14：在 ServiceRegistry 初始化后、拦截器设置前注册）：**

**导入新增（添加在文件顶部）：**
```typescript
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';
```

**Kernel 类新增属性（第 11-18 行区域，与现有属性声明并列）：**
```typescript
public readonly storageService: StorageService;
public readonly aiService: AIService;
```

**构造函数修改（D-15：按依赖层级顺序注册）：**
```typescript
constructor() {
  this.serviceRegistry = new ServiceRegistry();

  // Layer 0 — 无依赖
  this.eventBus = new EventBus();
  this.capabilityGuard = new CapabilityGuard();
  this.storageService = new StorageService(this.db);

  // Layer 1 — 依赖 Layer 0
  this.commandBus = new CommandBus(this.eventBus);
  this.actionRegistry = new ActionRegistry();

  // Layer 2 — 依赖 Kernel/db
  this.processManager = new ProcessManager(this);
  this.aiService = new AIService(this.db);

  this.pluginRuntime = new PluginRuntime(this);

  // ── IService 注册（D-14: ServiceRegistry 初始化后、拦截器前）──
  // D-16: 不声明 requires/optional
  // D-09: 现有子系统实例直接注册 + 类型断言
  // Layer 0 registrations
  this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
  this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
  this.serviceRegistry.register(IStorageServiceToken, this.storageService);

  // Layer 1 registrations
  this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus as any);
  this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as any);

  // Layer 2 registrations
  this.serviceRegistry.register(IProcessServiceToken, this.processManager as any);
  this.serviceRegistry.register(IAIServiceToken, this.aiService);

  // Capability check interceptor（不变）
  this.commandBus.setInterceptor(async (command) => { ... });
}
```

**关键注意事项：**
- `ServiceRegistry.register()` 是 async 方法——但构造函数不能是 async。Phase 2 使用 `.register()` 返回的 Promise 在构造函数中不会被 await——这是设计中已知的 tradeoff。由于 7 个注册都是同步完成的（无异步操作），实际上安全。如果后续需要 await，需要将初始化提取为 async factory 函数。
- `as any` 类型断言用于 5 个现有子系统实例（D-09：不创建适配器类）。StorageService 和 AIService 已是 `implements IService`，无需断言。
- `this.pluginRuntime = new PluginRuntime(this)` 移到 Layer 2 创建之后——PluginRuntime 构造时可能需要访问已注册的服务（通过 kernel 属性）。

---

## Shared Patterns

### 认证/授权
**Phase 2 不涉及。** IService 接口定义和 Token 注册是纯架构层，不改变现有认证逻辑。CapabilityGuard 的 grant/revokeAll/check 方法通过 ICapabilityService 接口暴露，但现有的拦截器逻辑（`kernel/index.ts` 第 31-57 行）保持不变。

### 错误处理
**来源:** `packages/core/di/errors.ts`（第 1-84 行）
**应用范围:** `interfaces.test.ts` 中的 Token 命名格式测试（调用 `new Token(invalidName)` 应抛出 `TokenError`）

```typescript
// 测试中验证 Token 格式无效时抛出 TokenError:
import { TokenError } from '../errors.js';
expect(() => new Token('invalid-name')).toThrow(TokenError);
```

StorageService 和 AIService 中的错误处理遵循现有惯例：
```typescript
// 来自 command-bus/index.ts 第 36 行和 plugin-runtime/index.ts 第 434 行:
throw new Error(`Command handler for ${commandType} is already registered.`);
throw new Error('No AI providers or Gemini API key configured in the system.');
```

### 日志
**来源:** `packages/core/command-bus/index.ts` 第 60 行、`packages/core/plugin-runtime/index.ts` 第 335 行
**应用范围:** StorageService 和 AIService 中的 console.error

```typescript
// 现有日志惯例 (子系统标签前缀):
console.log(`[CommandBus] Executing: ${normalizedCommand.type} (ID: ${normalizedCommand.id}) by ${normalizedCommand.actorId}`);
console.error(`[Plugin:${manifest.id}] Error getting storage key "${key}":`, e);

// StorageService/AIService 应该使用:
console.error(`[StorageService] Error getting key "${key}":`, e);
console.error(`[AIService] Error in generateText:`, e);
```

### 验证
**Token 名称格式验证:** `packages/core/di/token.ts` 第 30 行的 `TOKEN_NAME_RE` 正则
```typescript
const TOKEN_NAME_RE = /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/;
```
Token 构造函数自动执行此验证——Phase 2 创建的 7 个 Token 实例在模块加载时即通过验证。

### 测试模式 (vitest)
**来源:** `packages/core/di/__tests__/token.test.ts` 和 `packages/core/di/__tests__/service-registry.test.ts`
**应用范围:** 所有 3 个新增测试文件

**通用模式：**
- 导入：`import { describe, it, expect, beforeEach } from 'vitest';`
- 后端 ESM 路径：相对路径 + `.js` 扩展名（如 `from '../token.js'`）
- 异步测试：`it('should ...', async () => { ... })`
- 参数化测试：`it.each([...])('...', (param) => { ... })`
- 异常断言：`await expect(promise).rejects.toThrow(/pattern/)`
- 配置文件：`vitest.config.ts`（第 1-8 行），include 路径 `packages/core/di/__tests__/**/*.test.ts`

**vitest 运行命令：**
```bash
npx vitest run packages/core/di/__tests__/interfaces.test.ts    # 单个测试文件
npx vitest run packages/core/di/__tests__/                       # DI 全部测试
npx vitest run                                                   # 全部测试
```

### 文件头注释模式
**来源:** `packages/core/di/token.ts`（第 1-23 行）、`packages/core/di/service-registry.ts`（第 1-23 行）
**应用范围:** interfaces.ts, storage-service.ts, ai-service.ts

```typescript
/**
 * FileName — brief one-line description.
 *
 * Multi-paragraph description covering purpose, design decisions,
 * and key architectural context.
 *
 * ## Subsection (optional)
 *
 * More details...
 */
```

## No Analog Found

无。所有 8 个文件在代码库中都有明确的类比文件——Phase 2 的变更完全建立在 Phase 1 的 DI 基础设施和现有子系统 API 之上。

## Metadata

**Analog search scope:**
- `packages/core/di/` — 所有 Phase 1 DI 文件（token, service-registry, errors, types, index, __tests__/）
- `packages/core/kernel/index.ts` — Kernel 构造函数
- `packages/core/command-bus/index.ts` — CommandBus 完整 API
- `packages/core/event-bus/index.ts` — EventBus 完整 API
- `packages/core/registry/index.ts` — ActionRegistry 完整 API
- `packages/core/capability-system/index.ts` — CapabilityGuard 完整 API
- `packages/core/process-manager/index.ts` — ProcessManager 完整 API
- `packages/core/plugin-runtime/index.ts:327-440` — wrappedStorage + wrappedAI

**Files scanned:** 14 (10 源文件 + 2 测试文件 + 2 上下文文件)
**Pattern extraction date:** 2026-06-18
