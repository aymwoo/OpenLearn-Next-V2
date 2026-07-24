# RFC-004: Platform Event Bus (平台事件总线规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-004 |
| **Title** | Platform Event Bus (平台事件总线规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-004 定义了 OpenLearn 平台事件总线（Platform Event Bus）与事件分类规范，涵盖通用事件 Envelope 格式、领域事件（Domain Event）、平台事件（Platform Event）及插件事件（Plugin Event）的路由与广播机制。

---

## 2. Motivation & Context (背景与动因)

为了实现解耦与实时学情捕获，平台中的所有状态变更与过程数据均需通过事件总线进行发布/订阅（Pub/Sub），避免模块间直接调用引起的强耦合与性能瓶颈。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Standard Event Envelope (标准事件信封)
所有发布到 EventBus 的事件必须符合强类型信封契约：
```typescript
export interface EventEnvelope<T = unknown> {
  readonly id: string;           // 唯一事件 ID (UUIDv7 或 crypto.randomUUID)
  readonly type: string;         // 事件类型 (过去时命名，如 'lesson.created')
  readonly source: string;       // 触发源模块标识
  readonly payload: T;           // 事件载荷数据
  readonly timestamp: number;    // UTC 毫秒时间戳
  readonly correlationId?: string; // 关联 Command/Trace ID
}
```

### 3.2 Domain Event (领域事件)
- 由领域引擎（Lesson, Whiteboard, Presence, Collaboration, Analytics）在业务状态改变后发布。
- 命名范式：`<domain>.<past_tense_action>`（如 `lesson.created`, `whiteboard.element_updated`, `assignment.graded`）。

### 3.3 Platform Event (平台事件)
- 由平台内核与服务注册中心在基础设施生命周期变更时发布。
- 包括：
  - `ServiceRegistered`, `ServiceReady`, `ServiceStopped`, `ServiceDisposed`
  - `CapabilityRequested`, `CapabilityStarted`, `CapabilityFinished`, `CapabilityPublished`
  - `ModelStarted`, `ModelFinished`, `ToolCalled`, `PromptBuilt`

### 3.4 Plugin Event (插件事件)
- 由第三方插件发布，允许其他插件或学情分析引擎进行监听。
- 命名范式：`plugin.<plugin_id_snake>.<action_past_tense>`。

---

## 4. Architecture & Design (架构与设计)

```
[ Event Bus Architecture & Routing ]
Publisher (Engine / Plugin / Kernel)
   ↓ publish(eventEnvelope)
Master EventBus / Sub-EventBuses
   ├── Channel Subscribers (Specific event.type)
   └── Wildcard Subscribers ('*')
   ↓ Dispatch Parallel
Subscribers (Analytics Normalizer, Telemetry Logger, Socket.IO Relay)
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

`packages/core/event-bus/` 中的 `EventBus` 类作为核心 EventBus 保持零变动，所有新增的遥测 EventBus（如 `AIEventBus`, `CapabilityEventBus`, `ServiceEventBus`）通过通道订阅桥接至主 EventBus，确保学情收集与 Socket.IO 广播完全兼容。
