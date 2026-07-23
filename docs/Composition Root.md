# OpenLearn Platform Composition Root Specification (平台组合根规范)

## 1. Executive Summary (概述)

在 Platform Adoption Sprint A1 Step 2 中，扩展了 **Composition Root**（位于 `packages/core/bootstrap/composition/`），新增 `AICompositionModule` (`ai-composition-module.ts`)。

Composition Root 是 OpenLearn 平台内核集中进行基础设施与子系统依赖装配的**唯一合法位置**，切断了底层子系统直接硬编码相互依赖的隐患。

---

## 2. Registered Composition Modules (注册组合模块清单)

1. **`AICompositionModule` (`mod_ai_composition`)**:
   - 托管 AI Runtime 服务 (`srv_ai_runtime`, `srv_ai_provider_registry`) 注册至 `PlatformServiceRegistry`。
   - 托管 7 大现存 AI 能力（`ChatCapability`, `CompletionCapability`, `ToolCapability`, `AnalyticsAICapability`, `LessonAICapability`, `PluginAICapability`, `WhiteboardAICapability`）注册至 `CapabilityRegistry`。
   - 托管 AI 基础设施生命周期事件 (`AIInitialized`, `ProviderLoaded`, `RuntimeStarted`) 的发布。

---

## 3. Usage Example (使用方法)

```typescript
import {
  PlatformCompositionRoot,
  AICompositionModule,
} from './packages/core/bootstrap/index.js';

const root = PlatformCompositionRoot.create();
root.registerModule(new AICompositionModule());

const result = root.compose({ environment: 'development' });
console.log('Composition Status:', root.state); // 'Composed'
```
