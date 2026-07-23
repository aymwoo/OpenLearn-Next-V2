# OpenLearn AI Refactor Plan (AI 基础设施重构方案)

## 1. Executive Summary (概述)

本重构方案旨在**重用现有成熟能力、保持 100% 向后兼容性**的前提下，将 OpenLearn 散落在各处的 AI Provider HTTP 请求、Prompt 模板、Context 构建、Tool 转换与 Conversation 管理无感下沉收拢至 `packages/core/ai/` 统一基础设施中。

重构严格遵循：
- **Reuse First**（优先重用已有实现，如 `@google/genai` 与 OpenAI fetch）
- **Compatibility First**（保留 `AIService` 与现有 REST API 契约，插件无感运行）
- **Incremental Refactor**（渐进式 4 阶段迁移，禁止推倒重算）
- **Non-breaking Change**（无破坏性变更，不新增 UI 按钮或新对话窗口）

---

## 2. Refactoring Scope & Phases (重构范围与阶段)

### Phase 1: 建立 `packages/core/ai/` 基础设施
- 统一 `types/`、`event/` (AIEventBus)、`provider/` (AIProviderGateway)、`prompt/` (PromptRegistry)、`context/` (AIContextService)、`tool/` (ToolRegistry)、`conversation/` (ConversationService)、`streaming/` (StreamingService)、`memory/` (MemoryService)、`runtime/` (AIRuntimeKernel)。

### Phase 2: AIService 门面适配器重构
- 重构 `packages/core/di/ai-service.ts` 的 `AIService.generateText`，内部委托给 `AIProviderGateway`，对外保持 100% 相同接口签名。

### Phase 3: 渐进式平滑迁移 (Migration)
- 阶段性将 `server.ts` 路由与 `LessonAIInterface` 中的 Prompt 构建和 Tool 转换逐步对接 `AIRuntimeKernel`。

### Phase 4: 文档与校验
- 生成全套迁移指南与兼容性防割裂方案。
