# AI Capability Layer & Skill Registry

`AICapabilityKernel` 位于 `packages/core/ai-capability/`，为 AI Agent 提供交互能力接口（Chat, Completion, Tool Calling, Whiteboard Drawing, Lesson Control）。

---

## 核心接口契约 (`ai-capability/index.ts`)

`AICapabilityKernel` 导出以下能力子项：

```typescript
export interface IAICapability {
  chat: IChatCapability;
  completion: ICompletionCapability;
  tool: IToolCapability;
  lesson: ILessonCapability;
  whiteboard: IWhiteboardCapability;
  analytics: IAnalyticsCapability;
}
```

---

## AI Tool & Skill 自动化分发

AI Agent 可根据用户发起的自然语言指令（例如 `"帮我在白板画一个半径为5的圆"`），自动解析 Function Calling 契约并触发白板或课程指令：

```typescript
const toolResult = await aiCapability.tool.executeTool('draw_circle', {
  radius: 5,
  color: '#4F46E5',
});
```
