---
phase: 02-token
plan: "03"
type: "test"
status: complete
completed: "2026-06-18T18:51:00Z"
duration: "~2m"
requirements:
  - PLUG-06
  - PLUG-11
tags:
  - vitest
  - unit-test
  - integration-test
  - DI-tokens
  - Kernel-registration
  - StorageService
  - AIService
summary: >
  为 Phase 02 的 IService 接口、Kernel 注册流程、StorageService 和 AIService
  编写 3 个 vitest 测试文件，覆盖 22 个测试用例，全部通过。验证 Token 命名格式
  符合规范、Kernel 构造函数正确注册 7 个服务、resolve 返回引用一致性、及
  StorageService/AIService 的 CRUD 和 AI 生成逻辑。
---

# Phase 2 Plan 3: IService 测试套件

为 Phase 02 的所有新增 DI 代码编写 vitest 单元测试和集成测试，满足
ROADMAP 成功标准 SC-1 至 SC-5 的自动化验证要求。

## 执行概述

- **测试文件**: 3 个（新增）
- **测试用例**: 22 个（14 + 5 + 3）
- **全部通过**: `npx vitest run` → 56 tests passed (5 files)
- **行数**: 334 行（interfaces: 153, storage: 66, ai: 115）

## 创建的文件

| 文件 | 行数 | 描述 |
|------|------|------|
| `packages/core/di/__tests__/interfaces.test.ts` | 153 | Token 命名格式验证 + Kernel 注册流程集成测试 |
| `packages/core/di/__tests__/storage-service.test.ts` | 66 | StorageService get/set/delete CRUD 单元测试 |
| `packages/core/di/__tests__/ai-service.test.ts` | 115 | AIService generateText 单元测试（3 种场景） |

## 完成的测试

### interfaces.test.ts（14 tests）

**Describe 1: IService Token 命名格式**
- `it.each` 参数化测试验证 7 个 Token 的 `.name` 均为 `@openlearn/core:IServiceName` 格式（SC-2）
- 验证所有 Token name 互不相同
- 验证所有 Token name 通过 TOKEN_NAME_RE 正则格式验证

**Describe 2: Kernel IService 注册**
- 通过 `serviceRegistry.resolve` 依次获取 7 个 IService，全部 `toBeDefined()`（SC-3）
- 验证 resolve 返回与 Kernel 直接属性为同一引用，使用 `toBe()`（SC-4）
- 验证 StorageService/AIService 实例身份 + 方法可调用（SC-5）

**Describe 3: Kernel IService 内省**
- 验证 `serviceRegistry.list()` 包含全部 7 个 Token name

### storage-service.test.ts（5 tests）
- get 不存在 key 返回 null
- set 后 get 返回相同值
- set 覆盖已有 key
- delete 后 get 返回 null
- delete 不存在的 key 不抛异常

### ai-service.test.ts（3 tests）
- 无 provider 且无 Gemini key 时抛 `No AI providers or Gemini API key` 异常
- 无 provider 但 Gemini key 存在时，mock `@google/genai` 返回 Gemini 响应
- DB 中存在 provider 时，mock `global.fetch` 返回 OpenAI 兼容响应

## 执行结果

```
npx vitest run
 Test Files  5 passed (5)
      Tests  56 passed (56)
   Start at  18:50:39
   Duration  237ms
```

（56 个测试 = 之前的 34 个 Phase 01 测试 + 本次新增的 22 个测试）

## 提交

| Commit | Message |
|--------|---------|
| `cd6d6c7` | test(02-token): 添加 interfaces.test.ts — Token 命名格式 + Kernel 注册流程集成测试 |
| `eb5c05e` | test(02-token): 添加 StorageService 和 AIService 单元测试 |

## 决策

| 决策 | 原因 |
|------|------|
| AIService 测试 mock 策略：顶层 `vi.mock` + 可变 `mockGeneratorFn` | `@google/genai` 的 `GoogleGenAI` 需要可 `new` 的构造函数；`vi.fn()` 不满足此要求，需用真实 `class` |
| 使用 `beforeAll` 共享 Kernel 实例 | 减少重复初始化开销（SQLite 连接等），每个 describe 块创建独立 Kernel |
| 测试使用 `toBe()` 验证引用相等 | SC-4 要求验证 resolve 返回与 Kernel 直接属性为同一引用，非值相等 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AIService Gemini mock 不可构造**
- **发现于:** Task 2
- **问题:** `vi.fn().mockImplementation()` 返回不可 `new` 的函数，`new GoogleGenAI()` 抛 TypeError
- **修复:** 将 `vi.mock` 提升到文件顶层，使用真实 `class` 语法替代 `vi.fn()`。引入可变 `mockGeneratorFn` 供不同测试配置不同行为
- **修改文件:** `packages/core/di/__tests__/ai-service.test.ts`
- **提交:** `eb5c05e`

## 覆盖的 ROADMAP 成功标准

| 标准 | 描述 | 验证方式 |
|------|------|---------|
| SC-1 | IService 接口定义 | interfaces.test.ts 导入并使用 7 个 Token 类型 |
| SC-2 | Token 命名格式 `@openlearn/core:IServiceName` | it.each 参数化测试验证 7 个 Token.name |
| SC-3 | Kernel 注册 7 个 IService 且可 resolve | 集成测试依次 resolve + list() 内省 |
| SC-4 | Kernel 直接属性与 resolve 返回一致 | `toBe()` 引用相等断言 |
| SC-5 | StorageService/AIService 独立实例 | `toBe(kernel.storageService)` + 方法可调用验证 |

## Self-Check

- [x] `packages/core/di/__tests__/interfaces.test.ts` 存在
- [x] `packages/core/di/__tests__/storage-service.test.ts` 存在
- [x] `packages/core/di/__tests__/ai-service.test.ts` 存在
- [x] `cd6d6c7` 提交存在
- [x] `eb5c05e` 提交存在
- [x] 全部 56 个测试通过（`npx vitest run`）
