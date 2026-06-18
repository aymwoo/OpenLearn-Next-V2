---
phase: 02-token
reviewed: 2026-06-18T15:30:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/core/di/__tests__/ai-service.test.ts
  - packages/core/di/__tests__/interfaces.test.ts
  - packages/core/di/__tests__/storage-service.test.ts
  - packages/core/di/ai-service.ts
  - packages/core/di/index.ts
  - packages/core/di/interfaces.ts
  - packages/core/di/storage-service.ts
  - packages/core/kernel/index.ts
  - packages/core/plugin-runtime/index.ts
findings:
  critical: 3
  warning: 6
  info: 3
  total: 12
status: issues_found
---

# Phase 02-token: Code Review Report

**Reviewed:** 2026-06-18T15:30:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

本次审查覆盖了 DI 子系统（Token, ServiceRegistry, 错误类型, 类型定义, IService 接口, StorageService, AIService）以及 Kernel 和 PluginRuntime 中的集成代码，外加 3 个测试文件。总体架构设计良好（Token 模式、Kahn 拓扑排序、错误层次结构），但发现了 **3 个 BLOCKER 问题**（ServiceRegistry 类型签名破坏 IService 接口契约、测试代码使用 `as any` 掩盖类型漏洞、Kernel IService 注册不声明依赖导致拓扑排序失效）、6 个警告（Kernel 构造函数中 promise 火焰、PluginRuntime 过时包装器与 DI 目标矛盾、`console.log` 调试残留、缺失 `package.json` exports 等）、3 个改进建议。

---

## Critical Issues

### CR-01: ServiceRegistry 的 register/resolve 错误地标记为 async — 破坏 IService 接口的跨运行时兼容性设计

**文件：** `packages/core/di/service-registry.ts:55-112`
**问题：**
`register<T>()` 和 `resolve<T>()` 方法声明为 `async`，但它们的函数体是 **完全同步的** —— 没有任何 `await` 表达式。这使得这两个方法返回 `Promise<void>` 和 `Promise<T>`，而所有 IService 接口的 `register` / `unregister` 方法在 Kernel 注册时被注册到 ServiceRegistry 中的实例是同步的原始子系统实例。

关键矛盾：
1. `interfaces.ts` 文档中反复声明 "made async for cross-runtime compatibility"（D-10, D-17），意味着未来跨 Worker Thread 时需要真正的 `async`。
2. 但 `Kernel` 构造函数（`kernel/index.ts:58-68`）直接调用 `this.serviceRegistry.register(...)` 而不 `await`，如果将来 register 变为真正的异步操作（网络调用），这会产生未处理的 Promise rejection 竞态条件。
3. 即使现在 register 和 resolve 同步执行，标记为 `async` 会消耗不必要的微任务 tick，对启动性能有轻微影响。

**修复：**
当前阶段保持方法签名同步，等 Phase 5 RPC proxy 阶段再引入 async：

```typescript
// service-registry.ts
register<T>(
  token: Token<T>,
  instance: T,
  options?: RegisterOptions
): void {
  // ... 同步逻辑保持不变
}

resolve<T>(token: Token<T>): T {
  // ... 同步逻辑保持不变
}
```

如果必须保留 async 签名（为 Phase 5 铺垫），则 Kernel 构造函数中的注册调用必须改为 `await`，但这会导致构造函数变为 async —— 需要重构 Kernel 为工厂模式。无论哪种选择，当前的混合状态是错误的。

---

### CR-02: 测试中 `as any` 类型断言掩盖 StorageService 和 AIService 的类型窄化 — 测试通过的假象

**文件：** `packages/core/di/__tests__/interfaces.test.ts:116-128`
**问题：**
测试 SC-5（StorageService 和 AIService 的独立实例验证）使用 `as any` 强制类型断言来检查 `get` 和 `generateText` 方法是否存在：

```typescript
expect(typeof (storage as any).get).toBe('function');     // line 116
const result = await (storage as any).get('__nonexistent_test_key__'); // line 118
expect(typeof (ai as any).generateText).toBe('function'); // line 127
```

`ServiceRegistry.resolve()` 返回 `T`（根据 `IStorageServiceToken` 推断为 `IStorageService`），而 `IStorageService` 接口在 `interfaces.ts:229-237` 中确实声明了 `get(key: string): Promise<unknown>`。**不需要 `as any`** —— 直接用 `storage.get(...)` 即可。

使用 `as any` 存在两个风险：
1. **类型检查失效**：如果未来有人修改 `IStorageService` 接口移除了 `get` 方法，编译器不会报错 —— `as any` 彻底绕过了类型系统。
2. **误导性测试覆盖**：这一行测试通过不意味着接口真的暴露了预期方法，它只是验证了 `any` 类型的任意属性访问。

**修复：**
移除 `as any` 断言，直接使用类型化接口：

```typescript
it('resolve 返回的 StorageService 应是独立实例（SC-5）', async () => {
  const storage = await kernel.serviceRegistry.resolve(IStorageServiceToken);
  expect(storage).toBe(kernel.storageService);
  expect(storage).toBeDefined();
  expect(typeof storage.get).toBe('function');
  const result = await storage.get('__nonexistent_test_key__');
  expect(result).toBeNull();
});

it('resolve 返回的 AIService 应是独立实例（SC-5）', async () => {
  const ai = await kernel.serviceRegistry.resolve(IAIServiceToken);
  expect(ai).toBe(kernel.aiService);
  expect(ai).toBeDefined();
  expect(typeof ai.generateText).toBe('function');
});
```

---

### CR-03: Kernel IService 注册不使用 requires/optional 参数 — 依赖图中没有任何边，拓扑排序永远无效

**文件：** `packages/core/kernel/index.ts:58-68`
**问题：**
文档注释（D-16）明确声明 "不声明 requires/optional"，动机似乎是此时没有 RPC 代理需要依赖检查。但这是设计缺陷：依赖图是 DI 容器的核心功能之一，如果 Kernel 自身都不使用拓扑排序来验证子系统初始化顺序，整个依赖图的 Kahn 算法就形同虚设。

具体后果：
- `ServiceRegistry.topologicalOrder()`（`service-registry.ts:218`）接收任意 token 名称列表，但当前 depGraph 中所有 7 个 IService 的 `requires` 和 `dependents` 均为空 Set —— 结果是**任何顺序拓扑排序都 "通过"**，没有实际的排序能力。
- 文档中 Layer 0 / Layer 1 / Layer 2 的初始化顺序是**手工硬编码的**（Kernel 构造函数 line 37-48），而不是由依赖图强制保证的。如果有人错误地调整了构造顺序（例如在 EventBus 之前创建 CommandBus），拓扑排序不会检测到。

这违反了 D-06 的设计决策："Register-time dependency validation (fail-fast)"。当前代码在 register 时没有任何验证，所有注册都是扁平的无依赖注册。

**修复：**
注册时声明实际的依赖关系：

```typescript
// kernel/index.ts 构造函数中
// Layer 0 registrations (无依赖)
this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
this.serviceRegistry.register(IStorageServiceToken, this.storageService);

// Layer 1 registrations (依赖 Layer 0)
this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus as any, {
  requires: [IEventBusServiceToken.name],
});
this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as any, {
  requires: [],
});

// Layer 2 registrations (依赖 Layer 1)
this.serviceRegistry.register(IProcessServiceToken, this.processManager as any, {
  requires: [IEventBusServiceToken.name],  // ProcessManager 使用 eventBus
});
this.serviceRegistry.register(IAIServiceToken, this.aiService, {
  requires: [],  // 只依赖 db，不是 IService
});
```

然后编写测试验证 `topologicalOrder()` 确实能检测顺序约束。

---

## Warnings

### WR-01: Kernel 构造函数中未处理异步 promise — `commandBus.setInterceptor` 返回未等待的 Promise

**文件：** `packages/core/kernel/index.ts:71-97`
**问题：**
`ICommandBusService.setInterceptor()` 接口声明返回 `Promise<void>`（`interfaces.ts:78`），实际的 `CommandBus.setInterceptor()` 是同步方法（`command-bus/index.ts:30`），返回 `void`。但 Kernel 构造函数中调用 `this.commandBus.setInterceptor(async (command) => ...)` 时没有 `await`：

```typescript
// kernel/index.ts:71
this.commandBus.setInterceptor(async (command) => {
  // ... 大量异步逻辑
});
```

如果将来 `setInterceptor` 变为真正的异步（为 Worker Thread 场景做准备），这个调用点会成为一个未处理的 Promise。严格来说这是技术债务，但因为当前同步实现不会出错，所以降级为 WARNING。

**修复：**
由于构造函数不能是 async，将拦截器设置移到 `init()` 工厂方法中，或在 Kernel 构造函数中用 `.catch()` 处理。

---

### WR-02: PluginRuntime 中的 `wrappedAI.generateText` 包装器多余 — 与 DI 架构目标矛盾

**文件：** `packages/core/plugin-runtime/index.ts:365-374`
**问题：**
`wrappedAI` 包装器仅做 try-catch 和日志标记，然后直接委托给 `this.kernel.aiService.generateText()`。架构设计文档说明 AIService 是独立的 DI 注册服务，插件应通过 `ctx.resolve(IAIServiceToken)` 获取。但当前 PluginRuntime 仍然暴露自定义的 `wrappedAI` 对象给插件的 `ctx.ai`。

这意味着：
1. 插件获取 AI 能力的路径不一致 —— 是通过 `ctx.ai`（PluginRuntime 手动暴露）还是 `ctx.resolve(IAIServiceToken)`（DI 容器）？
2. `wrappedAI` 与 `IAIService` 接口不完全一致 —— 没有类型安全保障。
3. `StorageService` 同样的问题：`wrappedStorage` 使用 `manifest.id` 作为 `plugin_id` 直接操作 DB 表并自己处理 try-catch，完全绕过了 `IStorageService` 接口。

**修复：**
PluginRuntime 应该在插件上下文中暴露 `resolve(token)` 函数，让插件通过 DI 容器获取所有 IService，而不是提供手工包装的子系统代理。

---

### WR-03: AIService 使用 `fetch` 作为全局函数 — 无超时控制，Node.js 18+ 虽支持但仍有风险

**文件：** `packages/core/di/ai-service.ts:67`
**问题：**
`fetch(cleanUrl, { ... })` 使用的是 Node.js 内置的全局 `fetch`（Node 18+），但没有设置超时。如果 AI provider 的 API 响应缓慢或无响应，这个 fetch 会永远挂起（或直到操作系统 TCP 超时）。

原始 PluginRuntime 的 `wrappedAI` 包装器虽然不做超时控制，但至少在外层有 try-catch 和日志。现在 AIService 没有任何超时保护。

**修复：**
使用 `AbortController` 设置合理的超时（如 30 秒）：

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30_000);
try {
  const response = await fetch(cleanUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ... }),
    signal: controller.signal,
  });
  // ...
} finally {
  clearTimeout(timeoutId);
}
```

---

### WR-04: `interfaces.test.ts` 创建两个 Kernel 实例 — 全局单例 `kernelContainer` 被初始化两次

**文件：** `packages/core/di/__tests__/interfaces.test.ts:70,136`
**问题：**
测试文件在 `beforeAll` 中分别创建了两个 `new Kernel()` 实例：
- 第71行（"Kernel IService 注册" describe block）
- 第137行（"Kernel IService 内省" describe block）

这导致 `kernel/index.ts:119` 的 `kernelContainer.initAuditLog()` 被调用了两次（模块导入时的单例 + 测试代码中的实例化），每个 Kernel 实例都会向 EventBus 注册 `*` 通配符审计日志订阅者。虽然 in-memory 隔离不会互相影响，但 `Kernel` 构造函数中的 `initAuditLog()` 调用（line 120）应该在测试中显式处理。

**修复：**
在测试中显式调用 `kernel.initAuditLog()` 或将其移到工厂方法中：

```typescript
beforeAll(() => {
  kernel = new Kernel();
  kernel.initAuditLog(); // 显式初始化
});
```

---

### WR-05: `console.log` 残留调试日志 — 生产环境中的信息泄露风险

**文件：** `packages/core/command-bus/index.ts:60`
**问题：**
```typescript
console.log(`[CommandBus] Executing: ${normalizedCommand.type} (ID: ${normalizedCommand.id}) by ${normalizedCommand.actorId}`);
```

在高并发生产环境下，每个命令执行都输出 `console.log` 会造成严重的 I/O 开销，并泄露内部执行状态信息。命令 ID 和 actor ID 是敏感操作信息。

**修复：**
使用条件日志或结构化日志库，在生产环境中降级为 debug 级别：

```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[CommandBus] Executing: ${normalizedCommand.type} (ID: ${normalizedCommand.id}) by ${normalizedCommand.actorId}`);
}
```

---

### WR-06: `di/index.ts` barrel 导出缺少 Re-export 路径 — ServiceRegistry 未作为具名导出

**文件：** `packages/core/di/index.ts:14`
**问题：**
`di/index.ts` 只导出了 `ServiceRegistry` 类本身（第14行），但没有导出 `ICommandBusServiceToken` 等 Token 实例的 handler 注册函数（`registerHandler`, `execute` 等）。这意味着外部使用者如果只从 `di/` barrel import，能拿到 Token 和 ServiceRegistry，但命令/事件的类型定义（`PlatformCommand`, `PlatformEvent` 等）需要别处导入。

这不直接导致功能问题，但增加了学习成本和导入路径碎片化。

**修复：**
在 `di/index.ts` 中添加关键类型 re-export：
```typescript
export type { PlatformCommand, CommandHandler } from '../command-bus/index.js';
export type { PlatformEvent, EventSubscriber } from '../event-bus/index.js';
```

---

## Info

### IN-01: `di/interfaces.ts` 中重复的设计文档注释 — JSDoc 和行内注释内容高度重复

**文件：** `packages/core/di/interfaces.ts:43-80`
**问题：**
每个接口方法的 JSDoc 注释格式为：
```
/**
 * 操作方法描述。
 * Corresponds to ClassName.methodName() — made async for cross-runtime compatibility.
 */
```

"Corresponds to" 和 "made async" 的重复出现了 20+ 次，增加了文件体积（260 行）却不提供新信息。可以提取到文件级文档注释中。

**修复：**
将通用说明移到文件头部，方法注释精简为业务语义描述。

---

### IN-02: `di/ai-service.ts` 和 `di/storage-service.ts` 导入了 `BetterSqlite3` 类型但使用了 `type` import — 冗余

**文件：** `packages/core/di/ai-service.ts:26` 和 `packages/core/di/storage-service.ts:20`
**问题：**
两处都写的是 `import type BetterSqlite3 from 'better-sqlite3';`，但 `BetterSqlite3.Database` 只在构造函数参数类型声明中使用。这已经是正确的 `type` import 用法，不产生运行时开销。不过，`ai-service.ts:42` 中的 `as` 类型断言使用了对象字面量类型，而不是从 `better-sqlite3` 导入的类型，导致类型窄化不一致。

**修复：**
从 `better-sqlite3` 导入对应的 Row 类型：

```typescript
import type BetterSqlite3, { Statement } from 'better-sqlite3';
```

---

### IN-03: 测试文件 `ai-service.test.ts` 第46行 — `Date.now()` 用于 `created_at` 和 `updated_at` 可能会导致测试排序不稳定

**文件：** `packages/core/di/__tests__/ai-service.test.ts:93-96`
**问题：**
```typescript
db.prepare('INSERT INTO ...').run('p1', ..., Date.now(), Date.now());
```

两个 `Date.now()` 调用之间有时间差，虽然在实际场景中影响极小，但在极少数情况下（Mock 系统时间、CI 慢速环境）可能产生不一致的时间戳。对于测试来说这不是功能性 bug，但是一个测试代码质量问题。

**修复：**
使用共享时间戳：

```typescript
const now = Date.now();
db.prepare('INSERT INTO ...').run('p1', ..., now, now);
```

---

_Reviewed: 2026-06-18T15:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
