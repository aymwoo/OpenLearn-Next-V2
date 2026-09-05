# 能力 Provider 框架（Capability Invocation Framework）开发指南

> **适用范围**：`@openlearn/plugin-sdk@3.5.2`
> 本页说明"通用能力 Provider 框架"（`packages/core/capability/`）——它按**角色**鉴权，与 `resource:action` 权限字符串（见[能力权限矩阵](plugin-capability-matrix)）是**两套互不相干的机制**，请勿混淆。

---

## 1. 三套 "capability" 机制辨析

| 机制 | 鉴权方式 | 插件如何用 |
|---|---|---|
| **权限 / RBAC**（`CapabilityGuard`） | `resource:action` 字符串（`lesson:read` 等） | manifest `capabilitiesProposed` 声明 |
| **AI 能力层**（`ai-capability/`） | `capability_*` 功能 ID | `IPluginCapabilityGatewayToken` |
| **通用能力 Provider 框架**（本页，`capability/`） | `CapabilityRole[]` 角色数组 | `ICapabilityRuntimeServiceToken` → 运行时内核 |

---

## 2. 获取运行时内核

插件通过 `ICapabilityRuntimeServiceToken` 拿到能力运行时内核（`CapabilityRuntimeKernel`），它是框架注册表、执行管线、调用引擎、事件总线的统一编排者：

```typescript
import { ICapabilityRuntimeServiceToken, type PluginContext } from '@openlearn/plugin-sdk';

export async function activate(ctx: PluginContext) {
  const svc = await ctx.resolve(ICapabilityRuntimeServiceToken);
  const kernel = await svc.getRuntimeKernel(); // CapabilityRuntimeKernel
  // kernel.registry / kernel.pipeline / kernel.engine / kernel.eventBus / kernel.sdk
}
```

---

## 3. 注册自定义能力 Provider

自定义能力需实现 `ICapabilityProviderHandler` 并注册到 `kernel.registry`：

```typescript
const handler = {
  descriptor: {
    id: 'ext-report:student_progress',
    name: '学生进度报告',
    category: 'analytics',
    provider: 'ext-report',
    permission: ['Teacher'],           // 按角色鉴权（CapabilityRole[]）
    inputSchema: { type: 'object', properties: { studentId: { type: 'string' } } },
    outputSchema: { type: 'object' },
    metadata: {},
    tags: ['report', 'progress'],
    version: '1.0.0',
  },
  async execute(request) {
    // request.payload / request.context
    return { /* 结果 */ };
  },
};

kernel.registry.register(handler);
```

---

## 4. 核心类型

### `CapabilityDescriptor`（描述符）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 全局唯一 ID |
| `name` | `string` | 展示名 |
| `category` | `CapabilityCategory` | `lesson` / `whiteboard` / `notebook` / `plugin` / `analytics` / `ai` / 自定义 |
| `provider` | `string` | 提供方（插件 ID） |
| `permission` | `CapabilityRole[]` | 允许的角色：`Teacher` / `Student` / `Plugin` / `AI` / `Observer` / `System` |
| `inputSchema` / `outputSchema` | `Record<string, unknown>` | 输入/输出 schema |
| `metadata` | `Record<string, unknown>` | 元数据 |
| `tags` | `string[]` | 检索标签 |
| `version` | `string` | 语义版本 |

### `ICapabilityProviderHandler`（处理器）

```typescript
interface ICapabilityProviderHandler {
  readonly descriptor: CapabilityDescriptor;
  execute(request: InvocationRequest): Promise<unknown>;
}
```

### `InvocationRequest` / `CapabilityContext` / `CapabilityResult`

```typescript
interface InvocationRequest {
  readonly id: string;
  readonly capabilityId: string;
  readonly payload: Record<string, unknown>;
  readonly context: CapabilityContext;   // { lessonId?, whiteboardId?, studentId?, teacherId?, ..., actorRole }
  readonly timeoutMs?: number;
}

interface CapabilityResult<T = unknown> {
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly resultType: ResultType;   // teaching_object / markdown / quiz / code / image / analytics_insight / plugin_data / generic ...
  readonly data: T;
  readonly executionTimeMs: number;
  readonly success: boolean;
  readonly error?: string;
}
```

---

## 5. `CapabilityFrameworkRegistry` 全方法

`kernel.registry` 提供：

```typescript
register(handler: ICapabilityProviderHandler): void;  // id 缺失抛异常
resolve(capabilityId: string): ICapabilityProviderHandler;  // 找不到抛异常
has(capabilityId: string): boolean;
list(category?: string): ReadonlyArray<CapabilityDescriptor>;
discover(tagFilter: string): ReadonlyArray<CapabilityDescriptor>;
clear(): void;
```

---

## 6. 事件类型（`CapabilityEventMap`）

框架事件总线（`kernel.eventBus`）发布的事件：`CapabilityRequested` / `CapabilityStarted` / `CapabilityFinished` / `CapabilityCancelled` / `CapabilityFailed` / `CapabilityPublished`。

---

## 7. 何时用哪套能力机制

- 要**拦截/放行命令** → 用 `resource:action` 权限 + `capabilitiesProposed`。
- 要**调用 AI 能力**（聊天/补全/工具/课程/白板/分析）→ 用 `IPluginCapabilityGatewayToken`（AI 能力层）。
- 要**注册自定义"按角色鉴权"的能力提供方** → 用本页的 `ICapabilityRuntimeServiceToken` → `kernel.registry.register(handler)`。

> 最后更新：2026-08-29
