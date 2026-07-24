# RFC-002: Capability Runtime (能力运行时规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-002 |
| **Title** | Capability Runtime (能力运行时规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-002 定义了 OpenLearn Capability Runtime（能力运行时）的标准规范，涵盖 Capability Descriptor 定义、调用语义（Invocation）、上下文自动注入（Context）、统一结果转译（Result）、7 阶标准管道（Pipeline）及角色权限校验（Permission）。

---

## 2. Motivation & Context (背景与动因)

传统架构中各业务引擎（Lesson, Whiteboard, Analytics, Plugin）直接发起 HTTP 请求或写死硬编码逻辑。通过建立 Capability Runtime，平台实现了功能粒度的解耦调用与标准遥测。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Capability (能力定义)
能力是平台中最小可复用业务/AI 单元，必须声明标准 Descriptor：
```typescript
export interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: CapabilityCategory;
  readonly provider: string;
  readonly permission: ReadonlyArray<CapabilityRole>;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly tags: ReadonlyArray<string>;
  readonly version: string;
}
```

### 3.2 Invocation (调用语义)
`InvocationEngine` 必须支持以下 6 种标准调用模式：
1. **`invoke(request)`**: 同步/异步单次执行
2. **`stream(request)`**: 流式 SSE 增量输出
3. **`cancel(invocationId)`**: 运行期主动撤销
4. **`retry(request, maxRetries)`**: 自动失败指数重试
5. **`batch(requests)`**: 并行批处理
6. **`schedule(request, delayMs)`**: 延迟定时调度

### 3.3 Context (上下文自动注入)
管道必须自动收集并注入标准 `CapabilityContext`（包含 `lessonId`, `whiteboardId`, `studentId`, `teacherId`, `analyticsSessionId`, `conversationId`, `pluginId`, `actorRole`），禁止能力实现类自行维持全局状态。

### 3.4 Result (结果标准化)
所有 Capability 执行输出必须转译为下列标准结果类型之一：
`teaching_object` | `whiteboard_object` | `markdown` | `quiz` | `code` | `image` | `analytics_insight` | `plugin_data` | `generic`

### 3.5 7-Step Pipeline (7 阶段标准管道)
所有能力调用必须按顺序穿过 7 阶管道：
`Request` → `Validation` → `Permission` → `Context Injection` → `Capability Execution` → `Result Transform` → `Publish`

### 3.6 Permission (角色权限校验)
管道中自动引入 `PermissionChecker`，对 `Teacher`, `Student`, `Plugin`, `AI`, `Observer`, `System` 角色进行强校验。

---

## 4. Architecture & Design (架构与设计)

```
[ Capability Execution Flow ]
InvocationRequest
   ↓ (1. Request Event)
Validation (2. Schema Check)
   ↓ (3. Permission Check)
Context Injection (4. Auto-enrich Context)
   ↓ (5. Execution)
Capability Handler Execute
   ↓ (6. Result Transform)
CapabilityResult (7. Publish Event)
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

兼容适配器 `PluginCapabilityProviderHandler` 将现有的 `ActionRegistry` 命令自动转换为标准 Capability 暴露，确保已有的 `commandBus.execute()` 业务逻辑不受影响。
