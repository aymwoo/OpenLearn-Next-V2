# OpenLearn AI Skill Registry Specification (AI 技能注册表规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P5-03 中，成功构建了 **AI Skill Registry**（位于 `src/features/ai-skill-registry/`）。

AI 技能注册表 (`AISkillRegistry`) 统一收拢平台与插件的能力单元（Skill）。所有 AI 能力均表达为标准 Skill 接口，包含元数据结构 (`id`, `name`, `description`, `permissions`, `requiredContext`, `supportedModels`)。官方技能作为默认 Provider 提供，第三方插件使用完全相同的注册机制扩展自定义技能。**不包含 LLM 内部实现代码，复用现有 AI Runtime**。

---

## 2. AISkillMetadata & Provider (技能元数据契约)

```typescript
export interface AISkillMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: ReadonlyArray<string>;
  readonly requiredContext: ReadonlyArray<string>;
  readonly supportedModels: ReadonlyArray<string>;
}

export interface IAISkillProvider {
  readonly metadata: AISkillMetadata;
  readonly invoke?: (params: Record<string, unknown>, context?: unknown) => Promise<unknown> | unknown;
}
```

---

## 3. Official Default Skills (官方默认 AI 技能)

| Skill ID | 名称 | 依赖 Context | 支持模型 |
|---|---|---|---|
| `skill_tutor_assistant` | AI Tutor Assistant | `lesson`, `students` | `gemini-1.5-pro`, `gpt-4o`, `*` |
| `skill_whiteboard_explainer` | AI Whiteboard Visual Explainer | `whiteboard`, `resources` | `gemini-1.5-flash`, `*` |
| `skill_quiz_generator` | AI Quiz & Exercise Generator | `lesson`, `activities` | `*` |
| `skill_analytics_insight` | AI Student Engagement Insight | `analyticsSummary` | `*` |

---

## 4. Usage & Plugin Extension Example (使用与插件扩展范例)

```typescript
import {
  AISkillRegistry,
  registerDefaultAISkills,
  IAISkillProvider,
} from './src/features/ai-skill-registry/index.js';

const registry = new AISkillRegistry();

// 1. Register official default skills
registerDefaultAISkills(registry);

// 2. Register Plugin AI Skill
const pluginSkill: IAISkillProvider = {
  metadata: {
    id: 'skill_plugin_code_reviewer',
    name: 'AI Code Reviewer',
    description: 'Analyzes student code for bugs and lint violations',
    permissions: ['plugin:ai:code_review'],
    requiredContext: ['resources'],
    supportedModels: ['*'],
  },
};

registry.registerSkill(pluginSkill);
```
