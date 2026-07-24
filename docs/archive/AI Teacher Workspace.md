# OpenLearn AI Teacher Workspace Specification (AI 教师工作台组件规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P5-05 中，成功构建了 **AI Teacher Workspace**（位于 `src/features/ai-teacher-workspace/`）。

将 AI UI 完整转化为 Classroom Workspace 的**一等公民 Widget (`AITeacherWorkspaceWidget`)**。AI 从独立的 Chat 窗口升级为真正的全流程授课助手，支持隐藏/显示/固定/解钉/浮动/左右 Dock/全屏/折叠/恢复，并划分为 8 大功能分区（`Lesson Assistant`, `Whiteboard Assistant`, `Resource Assistant`, `Activity Assistant`, `Student Assistant`, `Assessment Assistant`, `Summary Assistant`, `Plugin Assistant`）。

---

## 2. Widget Control & Layout (Widget 控制与布局图谱)

```
===================================================================
 [🤖 AI Teacher Assistant]      [📌 Unpin] [🌊 Float] [⛶ Fullscreen] [➖ Collapse]
-------------------------------------------------------------------
 [Lesson] [Whiteboard] [Resource] [Activity] [Student] [Assessment] [Summary] [Plugin]
-------------------------------------------------------------------
 Active Assistant: Whiteboard Assistant
 [📝 Summarize Content]  [🎨 Explain Visuals]  [⚡ Generate Quiz]
===================================================================
```

---

## 3. Usage & Integration Example (使用与注册范例)

```typescript
import {
  AITeacherWorkspaceRegistry,
  AITeacherWorkspaceWidget,
} from './src/features/ai-teacher-workspace/index.js';

// Register into Workspace Widget Registry
const registry = new AITeacherWorkspaceRegistry();
registry.registerDefaultAIWidget();
```
