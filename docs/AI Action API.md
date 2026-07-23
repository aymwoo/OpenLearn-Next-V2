# OpenLearn AI Action API Specification (AI 课堂动作接口规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P5-02 中，成功构建了 **AI Action API**（位于 `src/features/ai-action-api/`）。

AI 动作注册表 (`AIActionRegistry`) 统一收拢所有可由 AI 发起的课堂动作，**严格禁止 AI 直接调用业务模块内部逻辑**，所有 AI 动作必须委托给已有的 Capability APIs。官方动作与第三方插件动作统一使用相同的 `registerAction` 接口进行扩展，并提供符合大模型 Function Calling / Tool Calling 规范的 Schema 导出功能。

---

## 2. AI Action Interface (AI Action 契约接口)

```typescript
export interface AIActionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parametersSchema?: Record<string, unknown>;
  readonly permissions?: ReadonlyArray<string>;
  readonly execute: (params: Record<string, unknown>, context?: unknown) => Promise<unknown> | unknown;
}

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
```

---

## 3. Official Default Actions (官方默认 AI 动作)

| Action ID | 名称 | 描述 | 委托底座 |
|---|---|---|---|
| `ai_summarize_lesson` | 总结课堂内容 | 提取当前授课重点与核心知识点 | `CapabilityRuntime` (Lesson) |
| `ai_explain_whiteboard` | 解释白板内容 | 解析白板公式与板书图形 | `CapabilityRuntime` (Whiteboard) |
| `ai_generate_quiz` | 生成随堂测验 | 自动生成 3 道课堂互动测试题 | `CapabilityRuntime` (Activity) |
| `ai_track_analytics` | 检索学情指标 | 检索学生课堂专注度与参与度洞察 | `CapabilityRuntime` (Analytics) |

---

## 4. Usage & Plugin Extension Example (使用与插件扩展范例)

```typescript
import {
  AIActionRegistry,
  registerDefaultAIActions,
  AIActionDescriptor,
} from './src/features/ai-action-api/index.js';

const registry = new AIActionRegistry();

// 1. Register official actions
registerDefaultAIActions(registry);

// 2. Register Third-Party Plugin AI Action
const pluginAction: AIActionDescriptor = {
  id: 'ai_plugin_auto_grade',
  name: 'Auto Grade Homework',
  description: 'Grades student submissions via AI assistant',
  execute: async (params) => {
    // Strictly delegate to Capability API
    return { graded: true, params };
  },
};

registry.registerAction(pluginAction);

// 3. Export LLM Tool Definitions for LLM Function Calling
const toolDefs = registry.getToolDefinitions();
console.log('LLM Tool Calling Schemas:', toolDefs);
```
