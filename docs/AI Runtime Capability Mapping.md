# OpenLearn AI Runtime Capability Mapping (AI 运行时能力映射分析)

## 1. Executive Summary (概述)

本报告基于当前代码库 `packages/core/ai-capability/capabilities/` 已有的实现，分析 AI Runtime 暴露给 `CapabilityRuntime` 的能力清单。

**不凭空捏造任何能力，严格映射代码库中现存能力定义**。

---

## 2. Existing AI Capabilities Mapping (现存能力映射清单)

```
====================================================================
 Capability ID              | Category   | Implementation File
====================================================================
 cap_ai_chat                | AI / Chat  | capabilities/chat-capability.ts
 cap_ai_completion          | AI / Text  | capabilities/completion-capability.ts
 cap_ai_streaming           | AI / Stream| capabilities/streaming-capability.ts
 cap_ai_tool_calling        | AI / Tool  | capabilities/tool-calling-capability.ts
 cap_ai_embedding           | AI / Vector| capabilities/embedding-capability.ts
 cap_ai_planning            | AI / Agent | capabilities/planning-capability.ts
 cap_ai_vision              | AI / Vision| capabilities/vision-capability.ts
 cap_ai_reasoning           | AI / Model | capabilities/reasoning-capability.ts
====================================================================
```

---

## 3. Capability Governance Integration (能力治理集成)

上述 8 大能力均已继承标准 `CapabilityDescriptor` 契约，具备统一的状态管理（`Active` / `Disabled`）、版本标识（`1.0.0`）与监控日志支持，未来可无缝由 `CapabilityRuntime` 托管调度。
