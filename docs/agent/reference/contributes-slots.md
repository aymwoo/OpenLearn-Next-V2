# UI 扩展槽位（`contributes`）全集

> **适用范围**：`@openlearn/plugin-sdk@3.7.5` / OpenLearnV2 v0.7.7
> 本页给出**四组彼此不正交的命名空间**的完整清单，以及每个槽位在当前版本下真正能拿到的 `slotProps`。
> 生成 UI 扩展代码前必读：绝大多数「插件装上了但界面上什么都没有」的问题，根因都在这里。
>
> **槽位全集是机器抽出来的**，不靠人工维护：
> `python3 audit-tools/agent_facts.py` → `contracts/slots.json`（120 个 `ExtensionSlot` 成员 + 8 个有渲染调用点的锚点）。
> 本页与该 JSON 有出入时，以 JSON 为准。

---

## 0. 先分清四组命名空间

| 命名空间                                           | 定义处                                                               | 校验强度                                          | 消费者                                          | 生效条件                           |
| :------------------------------------------------- | :------------------------------------------------------------------- | :------------------------------------------------ | :---------------------------------------------- | :--------------------------------- |
| **A. `manifest.contributes` 严格键**（71 个）      | `packages/core/esm-loader/manifest-schema.ts` 的 `contributesSchema` | 每个槽位有专属 Zod 数组，**未声明的键会被 strip** | 服务端 `ContributionRegistry` + 部分前端渲染器  | 装包即入库，**仅元数据，不挂组件** |
| **B. `frontendSlotsShape` 宽松键**（38 个）        | 同上，`...frontendSlotsShape`                                        | 只校验 `id` 必填，其余 `.passthrough()`           | 前端 `registerExtensionPoint`                   | 装包即入库，**仅元数据，不挂组件** |
| **C. 前端 `ExtensionSlot` 联合类型**（120 个成员） | `src/plugin-host/types.ts`                                           | 注册时由 `ExtensionPointConfig` 校验              | `<ExtensionPointRenderer slot="…">` 生产调用点  | **必须命令式注册组件**才可见       |
| **D. `anchor:*` 开放命名空间**（8 个有渲染调用点） | `AnchorSlot = \`anchor:${string}\``                                  | `.passthrough()` 保留任意键                       | 宿主锚点按钮前后各渲染一次，用 `placement` 过滤 | 锚点 id 由宿主公布                 |

> 四个数字（A=71 / B=38 / C=120 / D=8）由 `contracts/contributes-groups.json` 与
> `contracts/slots.json` 机器抽出，**不要手工维护**：
> `python3 audit-tools/agent_facts.py`。本页与 JSON 有出入时以 JSON 为准。
>
> A 组与 B 组**互不重叠**（`A ∩ B = ∅`），但都与 C 组部分重叠：
> A 组 71 个里有 4 个不在 C 组（`locales` / `palette.items` /
> `teacher.cockpit.widget` / `timeline.segments`），B 组 38 个里有 1 个不在 C 组（`workspace.view`）。

```{warning} A/B ≠ C
`contributes` 的键**不全是** `ExtensionSlot` 成员。写 manifest 只会让条目出现在管理端插件预览里，
**不会在前端渲染出任何东西**。要出 UI，必须在 `frontend.tsx` 的 `activate(ctx)` 里调用
`ctx.ui.registerExtensionPoint(slot, config)`。
```

### 4 个「只在 A 里存在、没有同名渲染槽位」的声明式贡献键

| contributes 键           | 类型                      | 落点                                                                                  |
| :----------------------- | :------------------------ | :------------------------------------------------------------------------------------ |
| `timeline.segments`      | `TimelineSegmentConfig[]` | 桥接为备课端**环节类型**（等价命令式 `ctx.ui.registerSegmentType`）                   |
| `palette.items`          | `PaletteItemConfig[]`     | 桥接为备课画板**图元**（等价命令式 `ctx.ui.registerPaletteItem`）                     |
| `teacher.cockpit.widget` | `CockpitWidgetConfig[]`   | ⚠ **当前无任何前端消费点**，schema 与类型已定义但宿主不渲染 —— 写进 manifest 不会生效 |
| `workspace.view`         | `FrontendSlotEntry[]`     | 仅出现在 `PluginInstallWizard` 的槽位白名单里，无渲染器                               |

反过来也不等价：`editor.timeline_segment` / `editor.palette_item` 是**渲染槽位**，与上面两个声明式键是同一业务能力的两条不同入口。只需要「让组件出现在画板里」→ 用 `palette.items`；还需要自定义 UI 交互 → 用 `editor.palette_item` 槽位。

```{danger} 已知的错误槽位名
`palette.item` **不是合法槽位名**（旧文档写过）。备课画板组件扩展的真实槽位名是
**`editor.palette_item`**，已在 `SegmentEditorCard` 与 `LessonPalette` 中完整挂载。
`student.quick_actions.compact_addon` **已移除**（无消费者）。
```

---

## 1. A 组：严格校验的 `contributes` 键（71 个）

按业务域分组。每条目形状都是 `z.array(<该槽位专属 schema>).optional()`；`id` 一律 `z.string().min(1)` 必填。

### 1.1 基础导航与页面级

| 键                         | 条目字段（`?` = optional）                                        |
| :------------------------- | :---------------------------------------------------------------- |
| `teacher.tab`              | `id`_，`label`_，`icon?`，`position?: int`，**`view?`**，`route?` |
| `teacher.dashboard.widget` | `id`_，`label`_，`icon?`，`position?: int`，**`view?`**           |
| `teacher.panel`            | `id`_，`title`_，`icon?`，**`view?`**                             |
| `student.view`             | `id`_，`label`_，`icon?`，`route?`，**`view?`**                   |
| `student.lesson.tool`      | `id`_，`label`_，`icon?`，**`view?`**                             |
| `student.fullscreen`       | `id`_，`title`_，`icon?`                                          |
| `global.setting`           | `id`_，`title`_，`description?`，`icon?`                          |
| `nav.user_menu`            | `id`_，`label`_，`icon?`，`commandType?`                          |
| `classroom.tool`           | 见 `manifest.md` 的 `classroomTools` 章节                         |
| `help.plugin_docs`         | `id`_，`title`_，`description?`，`markdownUrl?`                   |

```{danger} view 必须显式声明在 schema 里（v0.7.6 双轨制 UI）
第三方 ZIP 插件在 process 模式下无法传 React 组件，只能声明可视沙箱 HTML 的相对路径。
Zod object **默认 strip 未声明键**：一旦 `view` 没进 schema，`parse()` 后会被静默丢弃，
宿主退回「占位空态」—— 插件作者看到的是**空白面板且无任何报错**。
`teacher.panel` / `teacher.tab` / `teacher.dashboard.widget` / `student.view` / `student.lesson.tool`
五处源码里都写了这条注释，不是巧合。

````

### 1.2 课堂互动与大屏展台

`classroom.quick_activity` · `classroom.topbar.action` · `classroom.topbar.pill` · `classroom.header.action` · `classroom.agenda.action` · `classroom.attribution.award` · `classroom.attribution.action` · `classroom.leaderboard.action` · `classroom.barometer.metric` · `classroom.audit.event` · `classroom.notification.tabs` · `classroom.pacing.dashboard` · `classroom.diagnostic.feed` · `classroom.collab.canvas` · `classroom.stage.display.ticker` · `classroom.alert.banner` · `classroom.cockpit.drawer.item` · `classroom.post_class.widget` · `classroom.post_class.exporter` · `classroom.preclass.passcode_action` · `classroom.preclass.passcode_addon` · `stage.display.card` · `stage.display.overlay` · `stage.display.action`

### 1.3 倒计时与学生快捷指令

`classroom.countdown.widget` · `classroom.countdown.action` · `student.classroom.countdown` · `student.quick_actions.item` · `student.quick_actions.action` · `student.quick_actions.fab`

### 1.4 课堂启动门户

`classroom.portal.telemetry` · `classroom.portal.course_badge` · `classroom.portal.teaching_mode` · `classroom.portal.insight` · `classroom.portal.preflight` · `classroom.portal.launch_action`

### 1.5 学生多维素养 / 成长档案

`student.profile.tab` · `student.profile.dimension` · `student.profile.card` · `student.profile.action` · `student.profile.timeline_item` · `student.classroom.overlay` · `student.fullscreen`

### 1.6 白板与课件播放器

`whiteboard.dock.plugin` · `whiteboard.canvas.widget` · `whiteboard.renderer` · `whiteboard.autosave.status` · `whiteboard.autosave.action` · `courseware.viewer.toolbar` · `courseware.viewer.overlay`

### 1.7 互评

`peer_review.rubric.dimension` · `peer_review.badge` · `peer_review.action` · `peer_review.showcase.widget` · `peer_review.work.preview`

### 1.8 机房座位图

`classroom.seating.toolbar` · `classroom.seating.legend` · `classroom.seating.seat_badge` · `classroom.seating.seat_actions` · `classroom.seating.summary` · `computer_lab.toolbar.action` · `computer_lab.seat.overlay` · `computer_lab.seating.toolbar` · `computer_lab.unassigned.item` · `computer_lab.seating.sidebar`

### 1.9 班级 / 学生 / 课程管理

`class.tab` · `class.batch.action` · `student.row.panel` · `course.list.toolbar.action` · `course.card.badge` · `course.card.action` · `course.wizard.quick_apply` · `timetable.tab` · `timetable.toolbar.action` · `timetable.card.badge` · `timetable.import.source` · `timetable.entry.action` · `admin.tab` · `admin.dashboard.card` · `admin.user.action`

### 1.10 备课与课后闭环

`editor.header.action` · `editor.segment.action` · `editor.timeline_segment` · `editor.palette_item` · `editor.segment.type_config` · `editor.timeline.node_badge` · `timeline.segments` · `palette.items`

### 1.11 作业与测评

`assignment.submission.preview` · `assignment.file.preview` · `assignment.grade.toolbar.action` · `assignment.grade.item.addon` · `assignment.grade.rubric.addon` · `assessment.list.card` · `assessment.attempt.toolbar` · `assessment.stats.card` · `student.assignment.toolbar.action` · `student.segment.badge` · `student.segment.gate_fallback` · `student.academic_year.metric_card` · `student.dashboard.hero_widget` · `student.lesson.notes_addon` · `student.lesson.toolbox`

### 1.12 全局壳层与 AI

`header.action` · `header.status_pill` · `header.async_task.item` · `statusbar.item` · `ai_sidebar.tab` · `ai.prompt.template` · `ai.skill.provider` · `command_palette.item` · `quick_insert.item` · `classroom.active_segment.main`

---

## 2. B 组：宽松校验的前端专属键（38 个）

这组条目不进服务端 `ContributionRegistry`，由前端 `registerExtensionPoint` 消费。校验只拦「缺 `id`」这类结构性错误：

```typescript
const frontendSlotEntrySchema = z.object({ id: z.string().min(1) }).passthrough();
````

`header.action` · `statusbar.item` · `stage.display.overlay` · `stage.display.action` · `assignment.submission.preview` · `assignment.file.preview` · `student.classroom.overlay` · `student.profile.tab` · `whiteboard.renderer` · `timetable.tab` · `admin.tab` · `workspace.view` · `course.list.toolbar.action` · `course.card.action` · `course.card.badge` · `editor.segment.action` · `classroom.cockpit.drawer.item` · `classroom.alert.banner` · `classroom.stage.display.ticker` · `classroom.post_class.exporter` · `timetable.toolbar.action` · `timetable.card.badge` · `computer_lab.toolbar.action` · `computer_lab.seat.overlay` · `computer_lab.seating.toolbar` · `computer_lab.unassigned.item` · `computer_lab.seating.sidebar` · `student.dashboard.hero_widget` · `student.assignment.toolbar.action` · `student.lesson.notes_addon` · `student.lesson.toolbox` · `admin.dashboard.card` · `admin.user.action` · `header.status_pill` · `ai_sidebar.tab` · `assessment.list.card` · `assessment.attempt.toolbar` · `assessment.stats.card`

---

## 3. 每个槽位实际注入的 `slotProps`

```{note} 权威口径
实测方法：遍历 `src/**/*.tsx`（排除 `__tests__`），解析 `<ExtensionPointRenderer ... slot="…">`。
当前 120 个声明槽位中 **116 个**有生产调用点；剩余 4 个（`command_palette.item` / `quick_insert.item` /
`ai.prompt.template` / `ai.skill.provider`）是**数据型或服务端消费**槽位，不经过渲染器。
```

### 3.1 合并顺序（后者覆盖前者）

```typescript
React.createElement(resolveExtensionComponent(ext), {
  route: ext.route || route,
  lessonId,
  classId, // 宿主统一注入的课堂上下文（v0.2.8+）
  ...ext.slotProps, // 插件注册时声明的任意额外 props
  ...slotProps, // 宿主在调用点传入的 props
});
```

组件类型为 `React.ComponentType<any>`。**所有**经 `ExtensionPointRenderer` 渲染的槽位都先收到 `{ lessonId, classId, route? }`，下表只列**额外**注入的字段。

### 3.2 逐槽位表

| 槽位                                                     | 渲染调用点                                                                                                     | 额外 `slotProps`                                                                                                      |
| :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `student.view`                                           | `features/student-workspace/widgets/student-default-widgets.tsx`；`features/student/StudentDashboardPanel.tsx` | 前者**无**；后者 `{ studentId }`                                                                                      |
| `teacher.tab`（button 形态）                             | `features/shared/NavigationSidebar.tsx`                                                                        | `{ renderType: 'button' }`（**插件组件被绕过**，见 §3.3）                                                             |
| `teacher.tab`（panel 形态）                              | `components/PluginTabPanel.tsx`（由 `features/teacher/TeacherView.tsx` 挂载）                                  | `{ renderType: 'panel' }`                                                                                             |
| `teacher.dashboard.widget`                               | `features/teacher/Dashboard.tsx`                                                                               | 无（仅 `route?`）                                                                                                     |
| `teacher.panel`                                          | `features/teacher/Dashboard.tsx`                                                                               | `{ lang, lessons, classes, students }`                                                                                |
| `global.setting`                                         | `features/teacher/SettingsView.tsx`                                                                            | `{ lang }`                                                                                                            |
| `nav.user_menu`                                          | `components/UserMenu.tsx`                                                                                      | `{ session, lang, closeMenu }`                                                                                        |
| `classroom.tool`                                         | `features/whiteboard/components/WhiteboardToolbar.tsx`                                                         | 无（仅 `route?`）                                                                                                     |
| `help.plugin_docs`                                       | `features/teacher/help/PluginDocsViewer.tsx`                                                                   | 无（仅 `route?`）                                                                                                     |
| `stage.display.card`                                     | `features/classroom/stage-display/StageDisplayPanel.tsx`                                                       | `{ stage }`                                                                                                           |
| `stage.display.overlay`                                  | 同上                                                                                                           | `{ lessonId, lessonTitle, stage, data, isFullscreen, lang }`                                                          |
| `stage.display.action`                                   | 同上                                                                                                           | `{ lessonId, lessonTitle, stage, data, isFullscreen, lang, onToggleFullscreen, onOpenPeerReview }`                    |
| `classroom.quick_activity`                               | `features/classroom/ClassroomInteractiveCockpit.tsx`                                                           | `{ stage }`                                                                                                           |
| `classroom.topbar.action` / `.pill`                      | 同上                                                                                                           | `{ stage }`                                                                                                           |
| `classroom.header.action`                                | 同上                                                                                                           | `{ lessonId, classId, stage }`                                                                                        |
| `classroom.countdown.widget`                             | `features/classroom/ClassroomCountdownWidget.tsx`                                                              | 无（仅 `route?`）                                                                                                     |
| `classroom.countdown.action`                             | 同上                                                                                                           | `{ onStart, onPause, onReset, onAddTime }`                                                                            |
| `classroom.portal.telemetry`                             | `features/classroom/ClassroomEntryPortal.tsx`                                                                  | 无（另传 `lang`）                                                                                                     |
| `classroom.portal.course_badge`                          | 同上                                                                                                           | `{ lessonId }`                                                                                                        |
| `classroom.portal.teaching_mode`                         | 同上                                                                                                           | `{ selectedModeId, registerHint }`                                                                                    |
| `classroom.portal.insight` / `.launch_action`            | 同上                                                                                                           | 无                                                                                                                    |
| `classroom.portal.preflight`                             | 同上                                                                                                           | 无（另传 `lang`）                                                                                                     |
| `classroom.notification.tabs`                            | `features/classroom/notifications/ParentNotificationModal.tsx`                                                 | 无（仅 `route?`）                                                                                                     |
| `classroom.pacing.dashboard`                             | `features/classroom/pacing/MasteryPredictionModal.tsx`                                                         | 无（仅 `route?`）                                                                                                     |
| `classroom.barometer.metric`                             | `features/classroom/PacingDashboardModal.tsx`                                                                  | `{ lessonId, signals, total, health, lang }`                                                                          |
| `classroom.diagnostic.feed`                              | `features/classroom/diagnostics/DiagnosticCenterModal.tsx`                                                     | 无（仅 `route?`）                                                                                                     |
| `classroom.audit.event`                                  | 同上                                                                                                           | `{ activeTab, totalCount, lang }`                                                                                     |
| `classroom.collab.canvas`                                | `features/classroom/collab-whiteboard/GroupCollabWhiteboardModal.tsx`                                          | `{ lessonId, classId, activeGroupId, activeTool, activeColor, activeWidth, lang }`                                    |
| `classroom.agenda.action`                                | `components/LiveClassroomView.tsx`                                                                             | `{ segment, isActive, idx, lessonId, lang }`                                                                          |
| `classroom.attribution.award`                            | `features/classroom/ClassroomAttributionModal.tsx`                                                             | `{ student, onAwardPoints }`                                                                                          |
| `classroom.attribution.action`                           | 同上                                                                                                           | `{ student }`                                                                                                         |
| `classroom.leaderboard.action`                           | `features/classroom/ClassroomLeaderboardModal.tsx`                                                             | 无（仅 `route?`）                                                                                                     |
| `classroom.preclass.passcode_action` / `.passcode_addon` | `features/classroom/PreClassReadyView.tsx`                                                                     | `{ classId, classPasscode, expiresAt, isExpired, onRefresh }`                                                         |
| `classroom.post_class.widget`                            | `features/classroom/PostClassWrapupView.tsx`                                                                   | `{ lessonId }`                                                                                                        |
| `classroom.post_class.exporter`                          | 同上                                                                                                           | `{ lessonId, classId, summaryData, lang }`                                                                            |
| `classroom.seating.toolbar`                              | `features/classroom/ComputerLabSeatingMap.tsx`                                                                 | `{ classId, lab, stats }`                                                                                             |
| `classroom.seating.legend`                               | 同上                                                                                                           | `{ classId, stats }`                                                                                                  |
| `classroom.seating.summary`                              | 同上                                                                                                           | `{ classId, stats, onlineStudentIds }`                                                                                |
| `classroom.seating.seat_badge`                           | 同上（每个座位内渲染）                                                                                         | `{ seat, student, isOnline, classId }`                                                                                |
| `classroom.seating.seat_actions`                         | 同上                                                                                                           | `{ seat, student, isOnline, classId, lang }`                                                                          |
| `student.classroom.countdown`                            | `features/student/StudentCountdownBanner.tsx`                                                                  | 无（仅 `route?`）                                                                                                     |
| `student.classroom.overlay`                              | `features/student/StudentInteractiveOverlay.tsx`                                                               | `{ studentId, lessonId }`                                                                                             |
| `student.fullscreen`                                     | 同上                                                                                                           | `{ studentId, lessonId }`                                                                                             |
| `student.lesson.tool`                                    | `features/student/StudentLessonInteractionPanel.tsx`                                                           | `{ activeSegmentId, lang }`                                                                                           |
| `student.quick_actions.item`                             | `features/student/components/StudentQuickActionsFloatingMenu.tsx`                                              | `{ studentId, lessonId, closeMenu }`                                                                                  |
| `student.quick_actions.action`                           | 同上                                                                                                           | `{ studentId }`                                                                                                       |
| `student.quick_actions.fab`                              | 同上                                                                                                           | `{ urgentCount }`                                                                                                     |
| `student.profile.tab`（button）                          | `features/student/StudentGrowthProfileModal.tsx`                                                               | `{ renderType:'button', studentActiveTab, setStudentActiveTab, student, lessonId, classId, lang, progressHistory }`   |
| `student.profile.tab`（panel）                           | 同上                                                                                                           | `{ renderType:'panel', studentActiveTab, student, lessonId, classId, lang, progressHistory }`                         |
| `student.profile.dimension`                              | 同上                                                                                                           | `{ student, dimensions }`                                                                                             |
| `student.profile.card` / `.timeline_item`                | 同上                                                                                                           | 无（仅 `route?`）                                                                                                     |
| `student.profile.action`                                 | 同上                                                                                                           | `{ student }`                                                                                                         |
| `class.tab`（button）                                    | `features/teacher/classes/ClassTabs.tsx`                                                                       | `{ renderType, classId, classActiveTab, setClassActiveTab }`                                                          |
| `class.tab`（panel）                                     | `features/teacher/classes/ClassesView.tsx`                                                                     | `{ renderType, classId, students, lang, classActiveTab }`                                                             |
| `class.batch.action`                                     | `features/teacher/classes/ClassStudentsPanel.tsx`                                                              | `{ classId, cls, lang, selectedStudentIds, selectedStudents, allStudents, disabled, onRefresh }`                      |
| `student.row.panel`                                      | 同上                                                                                                           | `{ studentId }`                                                                                                       |
| `editor.header.action`                                   | `features/teacher/LessonEditorView.tsx`                                                                        | `{ lessonId, currentLesson, lang, isReadOnly, onSave }`                                                               |
| `editor.timeline_segment`                                | `features/teacher/lesson-editor/SegmentEditorCard.tsx`                                                         | `{ segment, lang, readOnly, onPatch }`                                                                                |
| `editor.palette_item`                                    | `features/teacher/lesson-editor/LessonPalette.tsx`                                                             | `{ lang, onActivate, readOnly }`                                                                                      |
| `editor.segment.action`                                  | `features/teacher/lesson-editor/SegmentEditorCard.tsx`                                                         | `{ segment, lang, readOnly, onPatch, segmentId }`                                                                     |
| `editor.segment.type_config`                             | 同上                                                                                                           | `{ segmentType, segment, lang, readOnly, onPatch }`                                                                   |
| `editor.timeline.node_badge`                             | `SegmentEditorCard.tsx`（`isActive` 恒 `true`）、`TimelineRail.tsx`                                            | `{ segment, lang, isActive, isCompleted }`（`TimelineRail` 另传 `idx`）                                               |
| `whiteboard.dock.plugin`                                 | `features/whiteboard/InteractiveWhiteboard.tsx`                                                                | `{ lessonId, classId, userRole, readOnly }`                                                                           |
| `whiteboard.canvas.widget`                               | 同上                                                                                                           | `{ lessonId, classId, userRole, readOnly }`                                                                           |
| `whiteboard.renderer`                                    | 同上                                                                                                           | `{ element, elementId, elementType, data, width, height, isSelected, readOnly, userRole, lessonId, onElementUpdate }` |
| `whiteboard.autosave.status`                             | `features/teacher/LessonEditorView.tsx`                                                                        | `{ lessonId, status, lastSavedTime }`                                                                                 |
| `whiteboard.autosave.action`                             | 同上                                                                                                           | `{ lessonId, flush }`                                                                                                 |
| `courseware.viewer.toolbar` / `.overlay`                 | `features/courseware/InteractiveCoursewareViewer.tsx`                                                          | 无                                                                                                                    |
| `peer_review.rubric.dimension`                           | `peer-review/PeerReviewRubricModal.tsx`、`PeerReviewRubricStats.tsx`                                           | 无（仅 `route?`）                                                                                                     |
| `peer_review.badge`                                      | `peer-review/PeerReviewMatrixPanel.tsx`                                                                        | 无（仅 `route?`）                                                                                                     |
| `peer_review.action`                                     | `peer-review/PeerReviewTelemetryHeader.tsx`、`PeerReviewLeaderboardPanel.tsx`                                  | 无（仅 `route?`）                                                                                                     |
| `peer_review.showcase.widget`                            | `peer-review/SpotlightDualWorkArena.tsx`                                                                       | `{ workA, workB, annotations, isAnonymous }`                                                                          |
| `peer_review.work.preview`                               | 同上                                                                                                           | `{ work, slot, isAnonymous }`                                                                                         |
| `timetable.tab`（button）                                | `components/TimetableManager.tsx`                                                                              | `{ renderType:'button', timetableActiveTab, setTimetableActiveTab }`                                                  |
| `timetable.tab`（panel）                                 | 同上                                                                                                           | `{ renderType:'panel', timetableActiveTab, classes, lessons, lang, onSchedulesUpdated }`                              |
| `timetable.toolbar.action`                               | 同上                                                                                                           | `{ schedules, currentWeekMonday, lang, onRefresh }`                                                                   |
| `timetable.card.badge`                                   | `components/timetable/sub-views/TimetableCalendarView.tsx`                                                     | `{ schedule, lang }`                                                                                                  |
| `timetable.entry.action`                                 | 同上（周历卡片 + 列表行两处）                                                                                  | `{ schedule, lang, onEdit }`                                                                                          |
| `timetable.import.source`                                | `components/timetable/sub-views/TimetableOcrView.tsx`                                                          | `{ lang, onImportEntries }`                                                                                           |
| `admin.tab`（button）                                    | `components/AdminPanel.tsx`                                                                                    | `{ renderType:'button', adminActiveTab, setAdminActiveTab }`                                                          |
| `admin.tab`（panel）                                     | 同上                                                                                                           | `{ renderType:'panel', adminActiveTab, currentUserId, currentUserRole, lang, siteInfo }`                              |
| `admin.dashboard.card`                                   | 同上                                                                                                           | `{ sqliteStats, lang }`                                                                                               |
| `admin.user.action`                                      | 同上                                                                                                           | `{ users, filteredUsers, lang, onRefresh }`                                                                           |
| `assignment.submission.preview`                          | `components/StudentAssignmentEvalPanel.tsx`                                                                    | `{ submission, studentId, lessonId, isSelf, lang }`                                                                   |
| `assignment.file.preview`                                | `components/AssignmentFilePreview.tsx`                                                                         | `{ file, fileExtension, assignmentId, downloadUrl, inlineUrl, lang }`                                                 |
| `assignment.grade.toolbar.action`                        | `components/TeacherAssignmentGradePanel.tsx`                                                                   | `{ lessonId, submissions, refresh, lang }`                                                                            |
| `assignment.grade.item.addon`                            | 同上（每个学生作答卡片内）                                                                                     | `{ submission, studentId, lessonId, score, comment, isConfirmed, onScoreChange, onCommentChange, lang }`              |
| `assignment.grade.rubric.addon`                          | 同上（评分权重区）                                                                                             | `{ lessonId, defaultTeacherWeight, defaultPeerWeight, onTeacherWeightChange, lang }`                                  |
| `header.action`                                          | `components/AppHeader.tsx`                                                                                     | `{ session, currentRole, lang }`                                                                                      |
| `header.status_pill`                                     | 同上                                                                                                           | `{ dbConnected, dbStatus, lang }`                                                                                     |
| `header.async_task.item`                                 | 同上                                                                                                           | `{ lang, activeRole, teacherTab, setTeacherTab }`                                                                     |
| `statusbar.item`                                         | `components/AppStatusBar.tsx`（由 `App.tsx` 挂载；**无插件贡献时不渲染**）                                     | `{ session, currentRole, lang, isOnline }`                                                                            |
| `course.list.toolbar.action`                             | `features/teacher/CourseManagement.tsx`                                                                        | `{ selectedCourseIds, courses, lang, onRefresh }`                                                                     |
| `course.card.badge`                                      | 同上                                                                                                           | `{ course, lang }`                                                                                                    |
| `course.card.action`                                     | 同上                                                                                                           | `{ course, lang, onRefresh }`                                                                                         |
| `course.wizard.quick_apply`                              | `features/modals/CourseWizardModal.tsx`                                                                        | `{ lang, wizardCourseTitle, wizardCourseCategory, wizardCourseTimeline, setWizardCourseTimeline, addToast }`          |
| `classroom.alert.banner`                                 | `features/classroom/ClassroomInteractiveCockpit.tsx`                                                           | `{ lessonId, classId, stage, lang }`                                                                                  |
| `classroom.cockpit.drawer.item`                          | 同上                                                                                                           | `{ lessonId, classId, stage, lang }`                                                                                  |
| `classroom.stage.display.ticker`                         | `features/classroom/stage-display/StageDisplayPanel.tsx`                                                       | `{ lessonId, lessonTitle, stage, data, lang }`                                                                        |
| `classroom.active_segment.main`                          | `components/LiveClassroomView.tsx`（活跃环节主工作区，含兜底分支）                                             | `{ segment, lessonId, classId, lang, onRefresh }`                                                                     |
| `computer_lab.toolbar.action`                            | `components/ComputerLabManager.tsx`                                                                            | `{ activeLab, computerLabs, onRefresh, lang }`                                                                        |
| `computer_lab.seat.overlay`                              | 同上                                                                                                           | `{ labId, row, col, seat, isOccupied }`                                                                               |
| `computer_lab.seating.toolbar`                           | 同上                                                                                                           | `{ labId, classId, assignedSeats, setAssignedSeats, lang }`                                                           |
| `computer_lab.unassigned.item`                           | 同上                                                                                                           | `{ student, classId, labId }`                                                                                         |
| `computer_lab.seating.sidebar`                           | 同上                                                                                                           | `{ labId, classId, assignedSeats, unassignedStudents }`                                                               |
| `student.dashboard.hero_widget`                          | `features/student/StudentDashboardPanel.tsx`                                                                   | `{ studentId, students, studentDashboardData, lang }`                                                                 |
| `student.assignment.toolbar.action`                      | `features/student/StudentAssignmentHeader.tsx`                                                                 | `{ assignment }`                                                                                                      |
| `student.lesson.notes_addon`                             | `features/student/StudentLessonView.tsx`                                                                       | `{ lessonId, studentId, activeSegmentId, lang }`                                                                      |
| `student.lesson.toolbox`                                 | 同上                                                                                                           | `{ lessonId, studentId, lang }`                                                                                       |
| `student.segment.badge`                                  | `features/student/StudentLessonContentPanel.tsx`                                                               | `{ segment, idx, isActive, isLocked, studentId, lessonId, lang }`                                                     |
| `student.segment.gate_fallback`                          | `features/student/StudentLessonInteractionPanel.tsx`                                                           | `{ lessonId, activeSegmentId, studentId, contentSegmentId, lang }`                                                    |
| `student.academic_year.metric_card`                      | `features/student/StudentAcademicYearComparison.tsx`                                                           | `{ studentId, comparisonData, selectedYears, lang }`                                                                  |
| `assessment.list.card`                                   | `features/assessment/AssessmentCenter.tsx`（**仅教师端**，`viewer` 恒为 `'teacher'`）                          | `{ assessment, viewer, lang }`                                                                                        |
| `assessment.attempt.toolbar`                             | `features/assessment/student/StudentAssessmentsView.tsx`                                                       | `{ assignmentId, attemptId, lang }`                                                                                   |
| `assessment.stats.card`                                  | `features/assessment/StatsPanel.tsx`                                                                           | `{ assignmentId, stats, lang }`                                                                                       |
| `ai_sidebar.tab`（button）                               | `features/shared/RightSidebar.tsx`                                                                             | `{ renderType:'button', activeTab, setActiveTab, lang }`                                                              |
| `ai_sidebar.tab`（panel）                                | 同上                                                                                                           | `{ renderType:'panel', activeTab, lang }`                                                                             |
| `ai.prompt.template`                                     | `features/shared/AiPromptTemplatePicker.tsx`（**数据型**）                                                     | `{ title, description, category, prompt, parameters[{name,label,default}] }`                                          |
| `ai.skill.provider`                                      | `server/ai-agent.ts`（**服务端消费，非渲染槽位**）                                                             | `{ id, name, description, commandType, parametersSchema? }`（经 commandBus 以插件 actor 派发）                        |
| `command_palette.item`                                   | `features/command-palette/command-palette.tsx`（**数据型**）                                                   | `{ title, description, category, keywords, commandType, payload, shortcut }`                                          |
| `quick_insert.item`                                      | `features/quick-insert/quick-insert-menu.tsx`（**数据型**）                                                    | `{ title, description, category, keywords, commandType, payload }`                                                    |

### 3.3 button 形态：组件被渲染器绕过

`teacher.tab` / `student.profile.tab` / `class.tab` / `timetable.tab` / `admin.tab` / `ai_sidebar.tab` 的 `renderType === 'button'` 调用点，渲染器**不渲染插件主面板组件**，而是自行合成与系统内置 `NavButton` 视觉一致的侧边栏导航按钮。v0.5.1 起通过 `PluginIconRenderer` 解析并呈现插件自定义图标（优先 `ext.icon`，次取 manifest `icon`，支持 Lucide 图标名 / Emoji / 图片 URL / React 组件），并按 `position` 升序排列。

```{warning} 别指望 button 形态执行你的组件副作用
如果插件的初始化逻辑写在扩展点组件的 `useEffect` 里，button 形态下**不会运行**。
初始化请放在 `activate(ctx)` 中。
```

---

## 4. D 组：`anchor:*` 锚点槽位（8 个）

`ExtensionPointRenderer` 在锚点按钮**前后各渲染一次**，用 `placement` prop 过滤（`'before' | 'after'`，默认 `'after'`）。

| 锚点                                     | 调用点                                                                                         |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `anchor:whiteboard-toolbar:rollcall`     | `features/whiteboard/components/WhiteboardToolbar.tsx`                                         |
| `anchor:whiteboard-toolbar:presentation` | 同上                                                                                           |
| `anchor:whiteboard-toolbar:math-graph`   | 同上                                                                                           |
| `anchor:whiteboard-toolbar:code-sandbox` | 同上                                                                                           |
| `anchor:whiteboard-toolbar:courseware`   | 同上                                                                                           |
| `anchor:whiteboard-toolbar:ai-tutor`     | 同上                                                                                           |
| `anchor:whiteboard-toolbar:grid`         | 同上                                                                                           |
| `anchor:classroom-attribution:awards`    | `features/classroom/ClassroomAttributionModal.tsx`（`slotProps={{ student, onAwardPoints }}`） |

manifest 侧的校验是 `.passthrough()`，所以 `anchor:` 前缀的任意键都能透传进 `ContributionRegistry`；但**只有宿主公布了锚点 id 的锚点才会有渲染调用点**。锚点条目类型 `AnchorToolConfig = { id, label, icon?, placement? }`。

---

## 5. `contributes.locales`

```typescript
export const pluginLocalesSchema = z
  .record(
    z.string().min(1, { error: '语言代码不能为空' }),
    z.union([z.string().min(1, { error: '语言包文件路径不能为空' }), z.record(z.string().min(1), z.string())]),
  )
  .optional();
```

两种形态都合法：

```json
"contributes": {
  "locales": {
    "zh-CN": "locales/zh-CN.json",              // 相对路径 → 由 i18n 加载
    "en-US": { "greeting": "Hello" }            // 内联字典
  }
}
```

前端读取用 `ctx.i18n.t(key, defaultValueOrParams?, params?)` 与 `ctx.i18n.getLanguage()`，详见 {doc}`plugin-context`。

---

## 6. 宿主布局上下文与容器契约（`layoutVariant`）

```{danger} 忽略容器契约会把宿主工作区挤没
若按默认块级样式写浮层，会**把并列的白板工作区挤占至 0 宽度** —— 这就是「学生端一弹浮层，白板就消失了」的成因。
```

| `layoutVariant`                        | 宿主环境                                                                         | 典型槽位                                                                              | 样式规范 / 禁止项                                                                                                                                                                        |
| :------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Panel`**                            | 独占 Tab 视口或主展示区，宿主提供外层滚动与尺寸约束                              | `teacher.tab` `teacher.panel` `admin.tab` `class.tab` `timetable.tab`                 | 占满容器（`w-full h-full`），推荐 `flex flex-col min-h-0` 组织内部滚动。沙箱 iframe 自带 `w-full h-full` 挂载                                                                            |
| **`WhiteboardWidget`**                 | 白板画布内的图元卡片，由 `WidgetFrame` 承载                                      | `teacher.dashboard.widget` `student.view` `whiteboard.canvas.widget`                  | 内部尺寸由卡片配置或用户拖拽决定，须适配不同缩放级别。v0.7.7+ 由 `PluginCardRenderer` 自动渲染为 `<PluginSandboxIframeView variant="panel" />`，process 模式插件无需加白名单即可原生呈现 |
| **`FloatingOverlay`**                  | 悬浮于视口之上，与主工作区处于**并列 DOM 树**（如 `App.tsx` 的 `flex h-screen`） | `student.classroom.overlay` `stage.display.overlay` `student.quick_actions.fab`       | **严禁** `w-full h-full` / `flex-1`。**必须**固定定位（`fixed right-4 bottom-4 z-50`）脱离 Flex 流。同槽位多插件时设计为收起态 / 小浮标，提供展开与拖拽避让                              |
| **`ActionItem` / `Badge` / `Toolbar`** | 行内或工具栏 Flex 容器内的小型按钮 / 徽章 / 胶囊                                 | `classroom.topbar.action` `header.action` `course.card.badge` `editor.segment.action` | 保持紧凑内联尺寸（`h-8 px-2 flex items-center`），避免破坏工具栏高度与折行                                                                                                               |

### 6.1 浮层高度通信契约

沙箱视图（`view`）运行在独立不透明源 `<iframe>` 中，宿主无法直接按内部 DOM 计算自适应高度。为避免内容截断或内外双重滚动条：

```javascript
// 参数为像素数值（例如 180、360、520）
window.OpenLearnPluginBridge.ui.resize(heightInPixels);
```

宿主 `PluginSandboxIframeView` 监听 `ol-plugin-view` 通道的 `resize` 消息，同步更新外层 iframe 容器的 `containerStyle.height`（**默认保底 180px**）。

最佳实践：浮层折叠为微型按钮 / 胶囊 → `resize(40)` 或 `resize(48)`；展开为便签 / 答题面板 → `resize(420)`；折叠时恢复高度。

---

## 7. 渲染优先级

同一个扩展点条目，宿主按以下优先级选择渲染形态：

```
React 真实组件  ≻  DOM render 函数  ≻  声明式沙箱视图 (view)  ≻  占位空态
```

- **React 真实组件**：仅 inline 白名单插件可达（`component` 字段）。ZIP 插件在 manifest 里写 `component` 会被 zod **静默 strip**（`manifest.json` 本来就装不下函数），不报错；若改在运行期用 `registerExtensionPoint` 传函数，`postMessage` 结构化克隆失败，浏览器抛 `DataCloneError`。
- **DOM `render` 函数**：`ExtensionPointConfig.render?: (props?) => React.ReactNode`，非组件式扩展点。
- **声明式沙箱视图**：manifest `contributes[...].view: "x.html"`，见 {doc}`frontend-sandbox`。
- **占位空态**：前三者都不可达时出现 —— 面板空白、**无报错**。这是 `view` 未声明或 `registerExtensionPoint` 未调用的典型症状。

---

## 8. 交付前自检清单

- [ ] 槽位名在 A/B/C/D 四组之一里**逐字符**存在（`palette.item` ✗ / `editor.palette_item` ✓）
- [ ] 需要真实 UI 的槽位，`frontend.tsx` 里确实调用了 `ctx.ui.registerExtensionPoint`，而不是只写 manifest
- [ ] 未使用 `teacher.cockpit.widget` / `workspace.view`（无渲染器）
- [ ] 浮层类槽位使用 `position: fixed`，未写 `w-full h-full`
- [ ] ZIP 插件的 UI 走 `view` 声明式沙箱 HTML，未在 manifest / postMessage 里塞函数
- [ ] 初始化副作用写在 `activate(ctx)` 而非组件 `useEffect`（button 形态不渲染组件）
- [ ] `lessonId` / `classId` 从 props 或 `ctx.context.get()` 读取，未 `import { useAppStore } from '@/...'`

---

## 取证

| 论断                                                                             | 来源                                                                                                                              |
| :------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| 71 个严格键 / 38 个宽松键 / `frontendSlotEntrySchema`                            | `packages/core/esm-loader/manifest-schema.ts`（`contributesSchema`、`frontendSlotsShape`）                                        |
| `view` 必须显式声明否则被 strip                                                  | 同上，`teacherPanelSchema` / `teacher.tab` / `student.view` / `student.lesson.tool` 四处源码注释                                  |
| `pluginLocalesSchema`                                                            | 同上                                                                                                                              |
| 120 个 `ExtensionSlot` 成员、8 个锚点、116 个有渲染调用点、逐槽位 `slotProps` 表 | `docs/reference/plugin-ui-extension-slots.md` §1–§4（`src/plugin-host/types.ts`、`src/plugin-host/extension-point-renderer.tsx`） |
| `ExtensionPointConfig` 字段                                                      | `src/plugin-host/types.ts`                                                                                                        |
| `PluginModule` 形状与兼容 shim                                                   | `src/plugin-host/plugin-host.ts`                                                                                                  |
| `layoutVariant` 四分类与 `ui.resize` 契约                                        | `docs/reference/plugin-ui-extension-slots.md` §1.1                                                                                |
| 权威计数脚本                                                                     | `audit-tools/extract_slots.py` / `audit-tools/slots_coverage.py`（接入 `audit-tools/run.sh` 门禁）                                |
