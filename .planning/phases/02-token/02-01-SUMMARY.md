---
phase: 02-token
plan: 01
type: execute
subsystem: di
tags: [interfaces, token, service, barrel, type-safety]
requires: [PLUG-04]
provides: [PLUG-06, PLUG-11]
affects:
  - packages/core/di/interfaces.ts
  - packages/core/di/storage-service.ts
  - packages/core/di/ai-service.ts
  - packages/core/di/index.ts
tech-stack:
  added: [IService 接口层, Token 实例, StorageService, AIService]
  patterns: [构造函数注入, export type vs export, Promise<T> 统一返回, phantom type Token]
key-files:
  created:
    - packages/core/di/interfaces.ts (317 lines - 7 IService 接口 + 7 Token 实例)
    - packages/core/di/storage-service.ts (51 lines - IStorageService 的 SQLite 实现)
    - packages/core/di/ai-service.ts (119 lines - IAIService 的 Gemini/OpenAI 兼容实现)
  modified:
    - packages/core/di/index.ts (+32 lines - barrel 导出新增模块)
decisions:
  - 所有 IService 方法返回 Promise<T>（D-10），为跨运行时（Worker Thread）准备
  - 参数类型使用 unknown 替代 any（D-11），渐进式收紧类型
  - StorageService 使用 `'__kernel__'` plugin_id，per-plugin 隔离由 PluginRuntime wrapper 提供
  - AIService 不添加 console.error/try-catch，错误冒泡到 PluginRuntime 包装层处理
  - interfaces.ts 作为单一导入点，插件开发者无需分别导入接口和 Token
duration: 00:03
completed_date: "2026-06-18"
---

# Phase 2 Plan 1: IService 接口定义 + Token 实例 + 独立服务类

建立插件开发者可通过单一文件 `import { ICommandBusService, ICommandBusServiceToken } from '.../di/interfaces.js'` 获取类型安全服务标识符的基础设施层。纯 TypeScript 类型层，不修改任何现有运行时行为。

## Tasks Executed

### Task 1: 创建 IService 接口定义文件 (interfaces.ts)

创建 `packages/core/di/interfaces.ts`，包含 7 个 IService 接口定义和 7 个 Token 实例导出。

**7 个接口：**
- `ICommandBusService` — 5 个方法（execute, registerHandler, unregisterHandler, createCommand, setInterceptor）
- `IEventBusService` — 3 个方法（publish, subscribe, unsubscribe）
- `IActionRegistryService` — 6 个方法（register, unregister, getAllActions, getAgentTools, getActionByToolName, getActionByCommandType）
- `ICapabilityService` — 3 个方法（grant, revokeAll, check）
- `IProcessService` — 6 个方法（spawn, kill, registerHandler, unregisterHandler, registerInterval, restore）
- `IStorageService` — 3 个方法（get, set, delete）
- `IAIService` — 1 个方法（generateText）

**设计要点：**
- 所有方法签名返回 `Promise<T>`（D-10）
- 参数类型从 `any` 收紧为 `unknown` 或具体类型（D-11）
- 泛型参数名为 `T`，与现有代码模式一致
- JSDoc 文件头注释说明设计决策

**7 个 Token 实例：**
- 命名格式 `IServiceNameToken`（D-13）
- 标识符 `@openlearn/core:IServiceName`
- 所有 Token 名称通过 `TOKEN_NAME_RE` 正则验证

**提交：** `8401448` — `feat(02-token): 创建 7 个 IService 接口定义和 7 个 Token 实例`

### Task 2: 创建 StorageService 和 AIService 独立实现类

**StorageService (`packages/core/di/storage-service.ts`):**
- `implements IStorageService`
- 使用 SQLite `plugin_storage` 表，`plugin_id` 固定为 `'__kernel__'`
- 构造函数注入 `BetterSqlite3.Database`
- 无 try-catch 包装，错误冒泡到 PluginRuntime 包装层

**AIService (`packages/core/di/ai-service.ts`):**
- `implements IAIService`
- 两级 fallback：第三方 AI provider (DB `ai_providers` 表) → Gemini SDK (`@google/genai`)
- 动态 `import('@google/genai')` 延迟加载
- 无 console.error 或 try-catch，纯粹业务逻辑

**提交：** `aef1f23` — `feat(02-token): 创建 StorageService 和 AIService 独立实现类`

### Task 3: 更新 di/index.ts barrel 导出新增模块

修改 `packages/core/di/index.ts`，保留现有内容，追加 4 个导出块：
1. IService 接口类型导出（`export type { ... }`）
2. Token 实例导出（`export { ... }`）
3. StorageService 类导出
4. AIService 类导出

**提交：** `c1fb9e8` — `feat(02-token): 更新 di/index.ts barrel 导出新增模块`

## Verification Summary

| Check | Result |
|-------|--------|
| `tsc --noEmit` di/ directory | 0 errors |
| interfaces.ts exists and contains 7 IService interfaces | PASS |
| interfaces.ts contains 7 Token instances with @openlearn/core: prefix | PASS |
| Token name format validation (TOKEN_NAME_RE) | 7/7 PASS |
| storage-service.ts exports `class StorageService implements IStorageService` | PASS |
| ai-service.ts exports `class AIService implements IAIService` | PASS |
| StorageService uses `'__kernel__'` plugin_id | PASS |
| AIService contains provider -> Gemini fallback logic | PASS |
| index.ts barrel includes all new exports | PASS |
| No `any` in interface method parameter types (except inherited patterns) | PASS |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all methods have complete implementations, no placeholder values.

## Threat Flags

None — IService interfaces are pure TypeScript compile-time types with no runtime attack surface. StorageService and AIService use existing SQLite infrastructure and environment variable patterns, introducing no new network endpoints or file access patterns.

## Commits

- `8401448`: feat(02-token): 创建 7 个 IService 接口定义和 7 个 Token 实例
- `aef1f23`: feat(02-token): 创建 StorageService 和 AIService 独立实现类
- `c1fb9e8`: feat(02-token): 更新 di/index.ts barrel 导出新增模块
