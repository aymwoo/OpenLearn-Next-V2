# OpenLearn AI Runtime Service Mapping (AI 运行时服务映射分析)

## 1. Executive Summary (概述)

本报告评估现存 AI Runtime 组件在平台接入阶段，哪些组件应注册至 `PlatformServiceRegistry`，哪些应作为内核服务（Kernel Services），哪些保持为子系统内部组件。

---

## 2. Platform Service Mapping Recommendation (服务映射推荐)

```
====================================================================
 AI Component                | Target Service Category | Lifetime
====================================================================
 AIRuntimeEngine             | Platform Service        | Singleton
 AIProviderRegistry          | Platform Service        | Singleton
 PromptRegistry              | Platform Service        | Singleton
 ConversationManager         | Platform Service        | Singleton
 ToolDispatcher              | Platform Service        | Singleton
 GeminiProvider              | Internal Provider       | Scoped/Transient
 OpenAICompatibleProvider    | Internal Provider       | Scoped/Transient
 AgentRunner                 | Internal Execution      | Transient
====================================================================
```

---

## 3. Recommended PlatformServiceRegistry Descriptors (服务描述符预设计)

```typescript
// Recommendation for future adoption:
registry.register({
  id: 'srv_ai_runtime',
  lifetime: 'Singleton',
  description: 'OpenLearn AI Runtime Central Service Engine',
});

registry.register({
  id: 'srv_ai_provider_registry',
  lifetime: 'Singleton',
  description: 'AI Provider Gateway & Key Management Service',
});
```
