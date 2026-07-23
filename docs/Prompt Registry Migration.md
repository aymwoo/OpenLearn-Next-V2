# OpenLearn Prompt Registry Migration Guide (Prompt 注册表迁移指南)

## 1. Overview (概述)

经审计发现，系统在 `server.ts` 与 `ai-interface.ts` 中存在多处硬编码 Prompt。本指南说明如何将其平滑迁移至集中式 `PromptRegistry` 中统一维护。

---

## 2. Migrated Prompts Catalog (已迁移 Prompt 目录)

| Prompt ID | 分类 | 版本 | 用途 |
|---|---|---|---|
| `agent_system_instruction_zh` | `agent` | 1 | OS Agent 中文系统提示词 |
| `agent_system_instruction_en` | `agent` | 1 | OS Agent 英文系统提示词 |
| `stage_quiz_generation` | `lesson` | 1 | 阶段 Quiz 选择题生成 Prompt |
| `activity_summary` | `lesson` | 1 | 教学环节 100 字总结 Prompt |
| `lesson_plan_generation` | `lesson` | 1 | 5 阶段教案规划 Prompt |

---

## 3. Migration Example (迁移前后对比)

### 迁移前（硬编码）：
```typescript
const prompt = `Based on the teaching stage "${stage.title}" with knowledge points [${stage.knowledgePoints.join(', ')}]...`;
```

### 迁移后（统一 PromptRegistry）：
```typescript
const prompt = promptRegistry.buildPrompt('stage_quiz_generation', {
  title: stage.title,
  knowledgePoints: stage.knowledgePoints.join(', '),
  count: 3
});
```
