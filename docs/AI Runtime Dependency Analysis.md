# OpenLearn AI Runtime Dependency Analysis (AI 运行时依赖分析报告)

## 1. Executive Summary (概述)

本报告审查 AI Runtime 子系统内部组件依赖方向以及与 Platform Kernel、数据库、外部 SDK 的耦合关系。

---

## 2. Dependency Matrix (依赖拓扑与耦合分析)

```
====================================================================
 Component                   | Dependencies                | Coupling
====================================================================
 AIRuntimeEngine             | Provider, Conversation      | Loose (Interface-based)
 GeminiProvider              | `@google/genai`, crypto     | External SDK
 OpenAICompatibleProvider    | `fetch`, crypto             | Standard HTTP
 ToolDispatcher              | CommandBus, ActionRegistry  | Kernel Core
 ConversationManager         | Database (SQLite)           | DB Direct Access
 PromptRegistry              | Memory / Constants          | Low
====================================================================
```

---

## 3. Coupling & Circular Dependency Inspection (耦合与循环引用检查)

- **Incoming Dependencies (入向依赖)**: `server.ts` 路由与 `LessonSession` 运行时通过局部变量或 API Endpoint 访问 AI 功能。
- **Outgoing Dependencies (出向依赖)**: AI Subsystem 依赖 SQLite DB 存储 AI Provider API Key 与提示词，依赖 `@google/genai` 外部包。
- **Circular Dependencies (循环依赖)**: **0 Detected**（子系统模块间均基于类型定义隔离）。
- **Hidden Coupling (隐式耦合项)**: `buildAgentSystemInstruction` 目前存在于 `server.ts` 中，后续在平台接入阶段宜统一收拢至 `packages/core/ai/prompt/` 之中。
