# OpenLearn AI Extension Guide (AI 插件扩展开发指南)

## 1. Overview (概述)

OpenLearn V2 为第三方插件开放了 6 大 AI 扩展点（AI Extension Points），插件与官方模块使用完全一致的注册接口。

---

## 2. 6 AI Extension Points (6 大 AI 扩展点)

| 扩展点 | 注册表 / API | 描述 |
|---|---|---|
| **AI Context Provider** | `AIContextProviderRegistry` | 扩充 AI 只读快照维度 (`extensionData`) |
| **AI Action Extension** | `AIActionRegistry` | 扩展可被 AI 调用的课堂动作 (支持 Function Calling Schema) |
| **AI Skill Extension** | `AISkillRegistry` | 扩展 AI 技能与模型依赖配置 (`AISkillMetadata`) |
| **AI Prompt Extension** | `PromptRegistry` | 注册带版本号与权限的 Prompt 模板 |
| **AI Widget Extension** | `AITeacherWorkspaceRegistry` | 向 Workspace 挂载自定义 AI 侧边栏/浮动组件 |
| **AI Panel Extension** | `WorkspaceSlotRegistry` | 向 Workspace 8 大 Slot 插入 AI 扩展面板 |

---

## 3. Plugin Code Example (插件扩展完整范例)

```typescript
import { AIActionRegistry } from './src/features/ai-action-api/index.js';
import { PromptRegistry } from './src/features/ai-prompt-registry/index.js';

// 1. Register AI Action
const actionRegistry = new AIActionRegistry();
actionRegistry.registerAction({
  id: 'ai_plugin_auto_grade',
  name: 'Auto Grade Homework',
  description: 'Grades student homework via AI Assistant',
  execute: async (params) => ({ success: true, params }),
});

// 2. Register AI Prompt
const promptRegistry = new PromptRegistry();
promptRegistry.registerPrompt({
  metadata: {
    id: 'prompt_plugin_rubric',
    name: 'Grading Rubric',
    description: 'Generates grading rubric template',
    version: '1.0.0',
    category: 'Assessment',
    provider: 'plugin_homework',
  },
  template: 'Generate rubric for {{topic}}',
});
```
