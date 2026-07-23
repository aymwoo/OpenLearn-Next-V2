# Workspace Guide (工作台指南)

> How the OpenLearn Workspace Shell works and how to extend it — for both the
> Teacher and Student Workspaces (they share the same infrastructure).

---

## 1. The Workspace Shell

Location: `src/features/workspace/`. The shell is a **slot-based** layout
framework. It is intentionally generic — Teacher and Student Workspaces are
just different compositions of the same pieces.

### Core pieces

| Piece | File | Role |
|---|---|---|
| `WorkspaceSlotRegistry` | `workspace-slot-registry.ts` | Stores slot providers; `register()` / `unregister()` / `getProviders(slot)` (sorted by descending `priority`). |
| `WorkspaceProvider` | `workspace-context.tsx` | React context exposing the registry + register/unregister helpers. |
| `WorkspaceLayout` | `workspace-layout.tsx` | Renders the fixed grid (`TopBar`, `LeftSidebar`, `MainCanvas`, `RightSidebar`, `BottomPanel`, `StatusBar`, `FloatingArea`, `DialogArea`) by reading providers per slot. |
| `WorkspaceSlotType` / `WorkspaceSlotProvider` | `workspace-types.ts` | Slot enum + provider contract `{ id, slot, priority?, render }`. |

### Registering a widget

```ts
import { WorkspaceSlotRegistry } from './workspace/workspace-slot-registry.js';
import { WorkspaceProvider } from './workspace/workspace-context.js';
import { WorkspaceLayout } from './workspace/workspace-layout.js';

const slots = new WorkspaceSlotRegistry();
slots.register({
  id: 'widget_my_panel',
  slot: 'RightSidebar',
  priority: 10,
  render: () => React.createElement(MyPanel),
});

<WorkspaceProvider registry={slots}>
  <WorkspaceLayout />
</WorkspaceProvider>
```

---

## 2. Teacher vs Student Workspace

Both workspaces use the **same** `WorkspaceProvider` + `WorkspaceLayout` +
`WorkspaceSlotRegistry`. The difference is purely:

- **Which widgets** are registered (layout).
- **Which role** the runtime is initialized with (permissions).
- **What context** is exposed to widgets (Student View vs Teacher View).

| | Teacher Workspace | Student Workspace |
|---|---|---|
| Runtime role | `Teacher` | `Student` |
| Context wrapper | `ClassroomRuntimeKernel` (teacher) | `StudentWorkspaceContext` (restricted view) |
| Widget registry | ad-hoc / `AITeacherWorkspaceRegistry` | `StudentWidgetRegistry` |
| Default widgets | lesson editor, roster, broadcast send, AI Teacher | lesson view, whiteboard, resources, activities, assignments, AI Learning Assistant, broadcast receive, notifications |
| Plugin slot | `teacher.tab`, `teacher.dashboard.widget` | `student.view`, `student.lesson.tool`, `student.fullscreen` |

**Do not duplicate the shell or the runtime to add a new workspace** — compose a
new `WidgetRegistry` + context wrapper over the existing infrastructure.

---

## 3. Event integration

Widgets listen to the **shared Classroom Runtime event bus**
(`ClassroomRuntimeKernel.eventBus`) — there is no separate workspace event
system. Listen to `LessonStarted`, `StageChanged`, `ObjectUpdated`,
`QuizSubmitted`, `PluginLoaded`, `AIFinished`, `StudentJoined`,
`LifecycleChanged`, etc.

---

## 4. Persistence

- **Layout**: `LayoutStore` (`layout-store.ts`) persists region state to
  `localStorage` (`openlearn_workspace_layout_v1`).
- **Workspace session**: `StudentWorkspaceSession` persists per-student opened
  widgets / lesson / resources / activity / AI conversation and restores on
  mount.

---

## 5. Extending (plugins)

Plugins contribute UI via extension points (`student.view`, `teacher.tab`,
`teacher.dashboard.widget`, `classroom.tool`, …) rendered by
`ExtensionPointRenderer` (`src/plugin-host/extension-point-renderer.tsx`). The
host component must be wrapped in `PluginHostProvider` so `usePluginHost()`
resolves.

See [`Plugin SDK.md`](Plugin SDK.md) for the public plugin API, and
[`Student Workspace.md`](Student Workspace.md) for the Student composition.
