# Student Workspace (学生工作台)

> **Sprint:** P6-01 · **Layer:** Product · **Module:** `src/features/student-workspace/`

The Student Workspace is built on the **same Workspace infrastructure** as the
Teacher Workspace. Teacher and Student Workspaces share the Workspace Shell
(`WorkspaceProvider` + `WorkspaceLayout` + `WorkspaceSlotRegistry`) and the
Classroom Runtime (`ClassroomRuntimeKernel`). Only **permissions, layout and
exposed capabilities** differ — no functionality is duplicated.

---

## 1. Architecture

```
StudentWorkspace (component)
   ├─ StudentWorkspaceContext   → wraps ClassroomRuntimeKernel (role: 'Student')
   │     • getView()            → restricted Student View
   │     • hasPermission()      → delegates to RuntimePermissionManager
   │     • subscribe()          → reuses the shared runtime event bus
   │     • takeSnapshot()/restoreSnapshot() → reuses kernel recovery
   ├─ WorkspaceSlotRegistry     → shared Shell slot registry
   ├─ StudentWidgetRegistry     → adapts widgets into the slot registry
   │     • registerDefaultWidgets()
   └─ StudentWorkspaceSession   → localStorage persistence (auto-restore)
```

### Key reuse points

| Concern | Reused module | Not duplicated |
|---|---|---|
| Workspace shell | `src/features/workspace/` | — |
| Runtime / context / permissions / events / snapshots | `packages/core/classroom-runtime/` | — |
| Widget registration | `WorkspaceSlotRegistry` (same as Teacher) | — |
| AI Learning Assistant | `AITeacherWorkspaceWidget` (existing AI widget) | — |
| Whiteboard | `LazyWhiteboard` | — |
| Assignments | `StudentAssignmentEvalPanel` | — |
| Notifications | `NotificationsDropdown` | — |
| Resources | `ResourceRegistry` | — |
| Activities | `ActivityRegistry` | — |
| Plugin widgets | `ExtensionPointRenderer` (`student.view`) | — |

---

## 2. Student Context (restricted view)

`StudentWorkspaceContext` wraps `ClassroomRuntimeKernel` and calls
`setUser({ role: 'Student' })`. `getView()` returns only permitted information
(`studentId`, `studentName`, `role`, `lessonId`, `courseId`, `permissions`) —
it is **derived**, never a duplicated state copy.

Permission gating is enforced by the shared `RuntimePermissionManager`. As of
P6-01 the `Student` role holds:

```
whiteboard:draw   // drawing / editing
quiz:submit       // activity & assessment submission
ai:invoke         // AI learning assistant access
plugin:execute    // student-facing plugin usage
```

Teacher-only permissions (`lesson:control`, `session:manage`, …) are **not**
granted to students.

---

## 3. Default Widgets & Layout

`StudentWidgetRegistry.registerDefaultWidgets()` registers the canonical
Student widgets into the shared slot registry:

| Widget | Slot | Reuses |
|---|---|---|
| Whiteboard | `MainCanvas` | `LazyWhiteboard` |
| Lesson | `LeftSidebar` | `StudentWorkspaceContext` |
| Resources | `LeftSidebar` | `ResourceRegistry` |
| Activities | `BottomPanel` | `ActivityRegistry` |
| Assignments | `RightSidebar` | `StudentAssignmentEvalPanel` |
| AI Learning Assistant | `RightSidebar` | `AITeacherWorkspaceWidget` |
| Teacher Broadcast | `BottomPanel` | runtime event bus |
| Notifications | `FloatingArea` | `NotificationsDropdown` |
| Plugin Widgets | `FloatingArea` | `ExtensionPointRenderer('student.view')` |

When a plugin host is provided, the **Plugin Widgets** entry is additionally
registered, rendering any plugin contributions to the `student.view` slot.

---

## 4. Events (reuse, no new system)

The Student Workspace subscribes to the **existing** Classroom Runtime event
bus. On `LessonStarted` it persists the current lesson id into the session.
No duplicate event system is introduced. Plugins extend the workspace through
the `student.view` / `student.lesson.tool` / `student.fullscreen` extension
slots — the same `ExtensionPointRenderer` mechanism used everywhere else.

---

## 5. Session Persistence

`StudentWorkspaceSession` persists per-student state to `localStorage` under
`openlearn_student_workspace_<studentId>`: opened widgets, layout, current
lesson, selected resources, activity state and AI conversation. On mount the
workspace restores the kernel snapshot and the saved session automatically.

---

## 6. Plugin Extensibility

Plugins use the **same public APIs** as official features:

- **Widgets / panels** → `student.view` extension point (or `ctx.ui.registerExtensionPoint`).
- **Commands / AI Actions** → `ctx.services.commandBus` / `ctx.services.actionRegistry`.
- **Activities / Resources** → the shared `ActivityRegistry` / `ResourceRegistry`.

Because the Student Workspace is composed from the exact same Workspace Shell
and Classroom Runtime, any plugin that works in the Teacher Workspace works
here through the identical seams.

---

## 7. Testing

`src/features/student-workspace/__tests__/` (15 tests):

- `student-widget-registry.test.ts` — default widget registration, plugin gating, slot mapping.
- `student-workspace-context.test.ts` — restricted view, permission gating, event forwarding, snapshot/restore.
- `student-workspace-session.test.ts` — localStorage save/load/update/clear, per-student isolation.

---

## 8. Compatibility

Reuses (does not fork) Workspace, Lesson Runtime, Whiteboard Runtime, Plugin
Runtime, AI Runtime, Analytics Runtime, Classroom Runtime and Platform Kernel.
The Student Workspace is backward compatible with the Teacher Workspace because
both are thin compositions over the same infrastructure.

See also: [`Workspace Guide.md`](Workspace Guide.md), [`Plugin SDK.md`](Plugin SDK.md),
[`Product SDK.md`](Product SDK.md).
