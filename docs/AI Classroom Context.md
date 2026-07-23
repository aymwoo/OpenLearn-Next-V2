# OpenLearn AI Classroom Context Specification (AI 课堂只读上下文规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P5-01 中，成功构建了 **Unified Read-Only AI Classroom Context**（位于 `src/features/ai-classroom-context/`）。

AI 课堂只读上下文为 AI 助教与智能 Agent 提供统一、隔离的只读视图快照（Read-only Snapshot），涵盖 11 大核心课堂维度 (`Lesson`, `Teacher`, `Students`, `Groups`, `Resources`, `Whiteboard`, `Activities`, `Workspace`, `Analytics Summary`, `Plugins`, `Permissions`)。AI 无法直接访问或调用内部可变服务逻辑，确保了极高的安全性与数据流向可控性。官方组件与第三方插件统一使用 `IAIContextProvider` 扩充快照数据。

---

## 2. Read-Only Context Snapshot Topology (11 大只读上下文维度)

```
====================================================================
 AIClassroomContextSnapshot (Immutable Read-Only Object)
   ├── lesson (LessonId, Title, Stage)
   ├── teacher (TeacherId, Name, Status)
   ├── students (Roster, Online status)
   ├── groups (Group names, Student assignments)
   ├── resources (Loaded resource titles & types)
   ├── whiteboard (Element count, Active tool)
   ├── activities (Active quizzes & teaching activities)
   ├── workspace (Active layout regions, Visible widgets)
   ├── analyticsSummary (Telemetry metric summary, Engagement score)
   ├── plugins (Active plugin IDs)
   ├── permissions (Allowed AI Capability boundaries)
   └── extensionData (Plugin custom context contributions)
====================================================================
```

---

## 3. Provider Interface & Extension Example (Provider 接口与扩展范例)

```typescript
import {
  AIContextProviderRegistry,
  registerDefaultAIContextProviders,
  IAIContextProvider,
} from './src/features/ai-classroom-context/index.js';

const registry = new AIContextProviderRegistry();

// 1. Register 11 default official providers
registerDefaultAIContextProviders(registry);

// 2. Register Third-party Plugin AI Context Provider
const pluginProvider: IAIContextProvider = {
  id: 'provider_plugin_homework_hub',
  name: 'Homework Hub AI Provider',
  provideContext: (classroomCtx) => ({
    extensionData: {
      pendingAssignmentsCount: 5,
      topScorerStudentId: 'stu_01',
    },
  }),
};

registry.registerProvider(pluginProvider);

// 3. Build Immutable Read-only Snapshot for AI
const aiSnapshot = registry.buildSnapshot();
console.log('Classroom ID for AI:', aiSnapshot.classroomId);
console.log('Analytics Engagement:', aiSnapshot.analyticsSummary.averageEngagementScore);
```
