# OpenLearn Product SDK Specification (产品层 SDK 扩展规范)

## 1. Overview (概述)

Product SDK 整合了 OpenLearn V2 产品层的所有功能扩展点，为开发团队与插件作者提供统一的入口机制。

---

## 2. Product Layer Extension Entrypoints (产品层扩展入口)

```typescript
// Product Layer Subsystems
export * from './src/features/workspace/index.js';
export * from './src/features/whiteboard/tool-system/index.js';
export * from './src/features/command-palette/index.js';
export * from './src/features/quick-insert/index.js';
export * from './src/features/interaction-runtime/index.js';
export * from './src/features/resource-runtime/index.js';
export * from './src/features/lesson-workflow/index.js';
export * from './src/features/activity-workflow/index.js';
export * from './src/features/classroom-runtime/index.js';
export * from './src/features/ai-classroom-context/index.js';
export * from './src/features/ai-action-api/index.js';
export * from './src/features/ai-skill-registry/index.js';
export * from './src/features/ai-teaching-workflow/index.js';
export * from './src/features/ai-prompt-registry/index.js';
export * from './src/features/ai-teacher-workspace/index.js';
export * from './src/features/student-workspace/index.js';
```

---

## 3. Student Workspace (学生工作台, P6-01)

The Student Workspace is part of the Product SDK. It reuses the same
`workspace`, `classroom-runtime`, `resource-runtime`, `activity-workflow` and
`ai-teacher-workspace` subsystems listed above — it does **not** introduce a
parallel stack.

```typescript
import { StudentWorkspace, StudentWorkspaceContext, StudentWidgetRegistry } from './src/features/student-workspace/index.js';

// Render for a student inside an existing classroom session
<StudentWorkspace
  student={{ id: 's1', name: 'Alice' }}
  lessonId="les_1"
  pluginHost={frontendPluginHost}
/>;
```

Public surface (all reuse existing seams, no duplication):

- `StudentWorkspace` — React component composing the shared Workspace Shell + Classroom Runtime.
- `StudentWorkspaceContext` — restricted Student View over `ClassroomRuntimeKernel` (`getView()`, `hasPermission()`, `subscribe()`, `takeSnapshot()`/`restoreSnapshot()`).
- `StudentWidgetRegistry` — registers the default student widgets into the shared `WorkspaceSlotRegistry` (`registerWidget()`, `registerDefaultWidgets()`, `unregisterWidget()`, `listWidgets()`, `clear()`).
- `StudentWorkspaceSession` — per-student localStorage session persistence with auto-restore.
- `StudentWorkspaceInit` / `StudentView` — public init & view types.

Plugins extend the Student Workspace through the `student.view` /
`student.lesson.tool` / `student.fullscreen` extension points — the same
`ExtensionPointRenderer` mechanism as the Teacher Workspace.

See [`Student Workspace.md`](Student Workspace.md) and
[`Workspace Guide.md`](Workspace Guide.md) for details.
