# Plan: Extensible Teacher Tool Panel in Live Classroom (可扩展教师工具面板) - [Completed]

## 1. Goal
Add a plugin-driven interactive tool panel (shelf/dock) in the Live Classroom page. Plugins will be able to declare tools inside their `manifest`, which the control center automatically renders as executable buttons.

## 2. Implemented Changes
### A. Manifest Declaration Standard
Plugins declare tools by adding a `classroomTools` array in their `manifest` with parameters mapping.
* Updated template definitions in [App.tsx](file:///home/wuxf/Develop/openlearnv2/src/App.tsx) and startup definitions in [server.ts](file:///home/wuxf/Develop/openlearnv2/server.ts) to define tools for both Quiz and Random Student Picker plugins.
* Added db check logic on `startServer` to automatically delete old plugin entries if their manifests do not contain `classroomTools`, forcing dynamic re-sideloading.

### B. Live Classroom View Update (in [LiveClassroomView.tsx](file:///home/wuxf/Develop/openlearnv2/src/components/LiveClassroomView.tsx))
* Passed `plugins` state as a prop to `LiveClassroomView`.
* Implemented dynamic Lucide icon matching `Icons[name]`.
* Rendered a glassmorphic **“课节互动工具面板 (插件扩充)”** shelf dock at the bottom of the Whiteboard.
* Wired command trigger handler `/api/commands` with placeholder substitution (`$classId`, `$lessonId`).

## 3. Verification & Evidence
* Logs written to [tsc_classroom_tools_check.log](file:///home/wuxf/Develop/openlearnv2/artifacts/logs/tsc_classroom_tools_check.log).
* Integration compiles and registers tools reactively.
