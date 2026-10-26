# UI 扩展槽位 Context / Props 上下文定义

<!-- doc-version: sdk=3.7.1 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.1`
> 本页说明宿主在渲染各 UI 扩展槽位时**实际注入**给插件 React 组件的 Props，纠正 "宿主会自动注入 `lessonId` / `userId` / `role` / `socket`" 的常见误解。

---

## 1. 完整扩展槽位清单

### 前端 `ExtensionSlot` 联合类型（`src/plugin-host/types.ts` 的 `ExtensionSlot`，共 **120** 个字符串字面量成员，2026-10-27 实测；`anchor:*` 是**另一套**开放命名空间，见 `AnchorSlot`。本节代码块与 `types.ts` 逐条对齐）

> 计数口径（可复跑）：取 `export type ExtensionSlot =` 到其结尾 `;` 之间的所有 `  | '...'` 行去重计数。**不要**用 `grep -c "^  | '" src/plugin-host/types.ts` —— 该文件里还有别的联合类型用了同样的缩进，会把数字虚高。
>
> 权威口径由 `python3 audit-tools/extract_slots.py --repo .` 生成（写入 `audit-tools/reports/slots_inventory.json`），本页清单再与之比对：`python3 audit-tools/slots_coverage.py --repo .`。两个脚本都已接入 `bash audit-tools/run.sh`，新增槽位若没写进本页，门禁会直接报错。
>
> 旧文档写 55 个、且把 `palette.item` 列为合法槽位名——**`palette.item` 不是合法槽位名**。备课画板组件扩展的真实槽位名是 **`editor.palette_item`**，已于 `SegmentEditorCard` 与 `LessonPalette` 中完整挂载并与 `paletteItemRegistry` 协同。

```typescript
export type ExtensionSlot =
  // ── 基础槽位 ──
  | 'teacher.tab'
  | 'student.view'
  | 'classroom.tool'
  | 'teacher.dashboard.widget'
  | 'student.lesson.tool'
  | 'teacher.panel' // v5.1: 教师独立全宽管理面板
  | 'student.fullscreen' // v5.1: 学生全屏视图（考试模式）
  | 'global.setting' // v5.1: 全局设置页扩展
  | 'nav.user_menu' // v5.2: 顶部 Header 用户菜单扩展
  // ── 课堂互动扩展 ──
  | 'classroom.quick_activity' // 极速课堂互动扩展
  | 'stage.display.card' // 大屏展台卡片扩展
  | 'stage.display.overlay' // 大屏展台全屏 HUD 覆盖扩展（全班弹幕/倒计时/仪式动效等）
  | 'stage.display.action' // 大屏展台操作工具栏快捷操作扩展
  | 'editor.timeline_segment' // 环节编辑附加面板；含 labelZh+labelEn 的 contributes 同时桥接为环节类型
  | 'editor.palette_item' // 声明式画板图元（桥接 paletteItemRegistry）；命令式用 registerPaletteItem
  // ── 倒计时扩展 ──
  | 'classroom.countdown.widget'
  | 'classroom.countdown.action'
  | 'student.classroom.countdown'
  // ── 学生端快捷指令 ──
  | 'student.quick_actions.item'
  | 'student.quick_actions.action'
  | 'student.quick_actions.fab'
  // ── 课堂启动门户（Classroom Entry Portal）──
  | 'classroom.portal.telemetry'
  | 'classroom.portal.course_badge'
  | 'classroom.portal.teaching_mode'
  | 'classroom.portal.insight'
  | 'classroom.portal.preflight'
  | 'classroom.portal.launch_action'
  // ── 课堂流程扩展页面 ──
  | 'classroom.notification.tabs'
  | 'classroom.pacing.dashboard'
  | 'classroom.diagnostic.feed'
  | 'classroom.collab.canvas'
  // ── 统一顶栏 / 归因 / 积分榜 ──
  | 'classroom.topbar.action'
  | 'classroom.topbar.pill'
  | 'classroom.attribution.award'
  | 'classroom.attribution.action'
  | 'classroom.leaderboard.action'
  // ── 学生多维素养 / 成长档案 ──
  | 'student.profile.tab'
  | 'student.profile.dimension'
  | 'student.profile.card'
  | 'student.profile.action'
  | 'student.profile.timeline_item'
  // ── 全局顶栏 / 晴雨表 / 环节 ──
  | 'classroom.header.action'
  | 'classroom.barometer.metric'
  | 'classroom.agenda.action'
  // ── 白板扩展 ──
  | 'whiteboard.dock.plugin'
  | 'whiteboard.canvas.widget'
  // ── 审计 ──
  | 'classroom.audit.event'
  // ── 全班大屏互评 ──
  | 'peer_review.rubric.dimension'
  | 'peer_review.badge'
  | 'peer_review.action'
  | 'peer_review.showcase.widget'
  | 'peer_review.work.preview'
  // ── 机房座位图（v0.3.22）──
  | 'classroom.seating.toolbar'
  | 'classroom.seating.legend'
  | 'classroom.seating.seat_badge'
  | 'classroom.seating.seat_actions'
  | 'classroom.seating.summary'
  // ── 白板自动保存（v0.3.22 末 / 阶段1）──
  | 'whiteboard.autosave.status'
  | 'whiteboard.autosave.action'
  // ── 课前班级临时密码（互动课堂）──
  | 'classroom.preclass.passcode_action'
  | 'classroom.preclass.passcode_addon'
  // ── 班级与学生管理域（v0.4.1）──
  | 'class.tab'
  | 'class.batch.action'
  | 'student.row.panel'
  // ── 备课与课后闭环 ──
  | 'editor.header.action'
  | 'classroom.post_class.widget'
  // ── 课件播放器扩展槽位（P1）──
  | 'courseware.viewer.toolbar'
  | 'courseware.viewer.overlay'
  // ── 课表中心与管理后台扩展（双渲染态）──
  | 'timetable.tab'
  | 'admin.tab'
  // ── 帮助中心与通用扩展槽位 ──
  | 'help.plugin_docs'
  // ── 学生端课堂交互浮层扩展槽位 ──
  | 'student.classroom.overlay'
  // ── 作业评估与多模态预览扩展槽位 ──
  | 'assignment.submission.preview'
  | 'assignment.file.preview'
  // ── 全局壳层扩展槽位（底座解耦）──
  | 'header.action'
  | 'statusbar.item'
  // ── 白板画布核心图元扩展槽位（一等公民图元渲染）──
  | 'whiteboard.renderer'
  // ── 备课中心与课程库（国家智慧教育平台对接 / 资源生态）──
  | 'course.list.toolbar.action'
  | 'course.card.badge'
  | 'course.card.action'
  | 'editor.segment.action'
  // ── 课堂互动与执教大屏 ──
  | 'classroom.alert.banner'
  | 'classroom.cockpit.drawer.item'
  | 'classroom.stage.display.ticker'
  | 'classroom.post_class.exporter'
  // ── 课表与机房管理 ──
  | 'timetable.toolbar.action'
  | 'timetable.card.badge'
  | 'computer_lab.toolbar.action'
  | 'computer_lab.seat.overlay'
  | 'computer_lab.seating.toolbar'
  | 'computer_lab.unassigned.item'
  | 'computer_lab.seating.sidebar'
  // ── 学生学习门户与作业闭环 ──
  | 'student.dashboard.hero_widget'
  | 'student.assignment.toolbar.action'
  | 'student.lesson.notes_addon'
  | 'student.lesson.toolbox'
  // ── 管理后台与全域底座 ──
  | 'admin.dashboard.card'
  | 'admin.user.action'
  | 'header.status_pill'
  // ── AI 助手侧边栏 ──
  | 'ai_sidebar.tab'
  // ── 全局命令面板与快捷插入（数据型槽位，宿主渲染入口）──
  | 'command_palette.item'
  | 'quick_insert.item'
  // ── AI 智能体生态 ──
  | 'ai.prompt.template'
  | 'ai.skill.provider'
  // ── 课程向导 ──
  | 'course.wizard.quick_apply'
  // ── 测评子系统（Issue #183）──
  | 'assessment.list.card'
  | 'assessment.attempt.toolbar'
  | 'assessment.stats.card'
  // ── 教师作业批改面板 ──
  | 'assignment.grade.toolbar.action'
  | 'assignment.grade.item.addon'
  | 'assignment.grade.rubric.addon'
  // ── 备课端与学生端教学环节 ──
  | 'editor.segment.type_config'
  | 'editor.timeline.node_badge'
  | 'student.segment.badge'
  | 'student.segment.gate_fallback'
  | 'student.academic_year.metric_card'
  // ── 课堂主工作区接管与课表导入 ──
  | 'classroom.active_segment.main'
  | 'timetable.import.source'
  | 'timetable.entry.action'
  // ── 全局壳层后台任务 ──
  | 'header.async_task.item';

// v0.2.6: 锚点槽位（开放命名空间）
export type AnchorSlot = `anchor:${string}`;
export type AnyExtensionSlot = ExtensionSlot | AnchorSlot | (string & {});
```

> `src/plugin-host/types.ts` 中另有一条注释说明 `student.quick_actions.compact_addon` **已移除**（无消费者），因此它不在上述成员内。

### 后端 manifest `contributes` 键（`packages/core/plugin-host/contribution-registry.ts`，镜像 `packages/plugin-sdk/openlearn.d.ts`）

- `classroom.tool` → `ClassroomToolConfig`
- `teacher.tab` → `TeacherTabConfig`
- `teacher.dashboard.widget` → `DashboardWidgetConfig`
- `student.view` → `StudentViewConfig`
- `student.lesson.tool` → `StudentLessonToolConfig`
- `classroom.quick_activity` → `QuickActivityConfig`
- `anchor:*` → `AnchorToolConfig`（v0.2.6+，开放命名空间，锚点 id 见 `docs/plugin/anchor-slots.md`）
- `help.plugin_docs` → `HelpDocConfig`（V3.2 新增）
- **全域扩展槽位贡献配置**（镜像 `packages/core/plugin-host/contribution-registry.ts`）：
  - `course.list.toolbar.action` → `CourseListToolbarActionConfig`
  - `course.card.badge` → `CourseCardBadgeConfig`
  - `course.card.action` → `CourseCardActionConfig`
  - `editor.segment.action` → `EditorSegmentActionConfig`
  - `classroom.alert.banner` → `ClassroomAlertBannerConfig`
  - `classroom.cockpit.drawer.item` → `ClassroomCockpitDrawerItemConfig`
  - `classroom.stage.display.ticker` → `ClassroomStageDisplayTickerConfig`
  - `classroom.post_class.exporter` → `ClassroomPostClassExporterConfig`
  - `timetable.toolbar.action` → `TimetableToolbarActionConfig`
  - `timetable.card.badge` → `TimetableCardBadgeConfig`
  - `computer_lab.toolbar.action` → `ComputerLabToolbarActionConfig`
  - `computer_lab.seat.overlay` → `ComputerLabSeatOverlayConfig`
  - `computer_lab.seating.toolbar` → `ComputerLabSeatingToolbarConfig`
  - `computer_lab.unassigned.item` → `ComputerLabUnassignedItemConfig`
  - `computer_lab.seating.sidebar` → `ComputerLabSeatingSidebarConfig`
  - `student.dashboard.hero_widget` → `StudentDashboardHeroWidgetConfig`
  - `student.assignment.toolbar.action` → `StudentAssignmentToolbarActionConfig`
  - `student.lesson.notes_addon` → `StudentLessonNotesAddonConfig`
  - `student.lesson.toolbox` → `StudentLessonToolboxConfig`
  - `admin.dashboard.card` → `AdminDashboardCardConfig`
  - `admin.user.action` → `AdminUserActionConfig`
  - `header.status_pill` → `HeaderStatusPillConfig`
  - `ai.prompt.template` → `AIPromptTemplateConfig`（消费端：Agent 输入区模板选择器，见 11.6）
  - `ai.skill.provider` → `AISkillProviderConfig`（消费端：服务端 AI Agent 工具注入，见 11.6）
  - `admin.user.action` → `AdminUserActionConfig`
  - `header.status_pill` → `HeaderStatusPillConfig`
  - `ai_sidebar.tab` → `AiSidebarTabConfig`

> **注意两套命名空间**：`contributes` 的键**不全是** `ExtensionSlot` 成员。以下 4 个键是**声明式贡献键**，只存在于 manifest schema / `ContributionRegistry`，没有同名渲染槽位：
>
> | contributes 键           | 类型                      | 落点                                                                                 |
> | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------ |
> | `timeline.segments`      | `TimelineSegmentConfig[]` | 桥接为备课端**环节类型**（等价于命令式 `ctx.ui.registerSegmentType`）                |
> | `palette.items`          | `PaletteItemConfig[]`     | 桥接为备课画板**图元**（等价于命令式 `ctx.ui.registerPaletteItem`，见 §9）           |
> | `teacher.cockpit.widget` | `CockpitWidgetConfig[]`   | **当前无任何前端消费点**（schema 与类型已定义，宿主不渲染）—— 写进 manifest 不会生效 |
> | `workspace.view`         | `FrontendSlotEntry[]`     | 仅在 `PluginInstallWizard` 的槽位白名单里出现，无渲染器                              |
>
> 反过来也不等价：`editor.timeline_segment` / `editor.palette_item` 是**渲染槽位**，与上面两个声明式键是同一业务能力的两条不同入口，不要混用。若插件只需要「让组件出现在画板里」，用 `palette.items`；若还需要自定义 UI 交互，用 `editor.palette_item` 槽位。

#### 已实际挂载渲染器（存在 `ExtensionPointRenderer` 调用点）的槽位

实测口径：遍历 `src/**/*.tsx`（排除 `__tests__`），解析 `<ExtensionPointRenderer ... slot="…">`。

- 生产调用点上的**固定名槽位值随版本增长**（本节 98 为历史实测；当前联合类型 120 个成员，其中 **116 个**在 `src/**/*.tsx` 有 `<ExtensionPointRenderer>` 生产调用点。剩余 4 个 —— `command_palette.item` / `quick_insert.item` / `ai.prompt.template` / `ai.skill.provider` —— 是**数据型或服务端消费**槽位，不经过渲染器，契约见 §12.7。消费率口径见文末统计节，复核命令见下）；
- 另有 **8 个** `anchor:*` 锚点槽位（见 §1.1 附注）。

| 槽位                                 | 渲染调用点（`src/` 下）                                                                                                                 | 调用点传入的 `slotProps`                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `student.view`                       | `src/features/student-workspace/widgets/student-default-widgets.tsx`、`src/features/student/StudentDashboardPanel.tsx`                  | 前者无；后者 `{ studentId }`                                                                                          |
| `teacher.tab`（button 形态）         | `src/features/shared/NavigationSidebar.tsx`                                                                                             | `{ renderType: 'button' }`（组件被绕过，见 §2）                                                                       |
| `teacher.tab`（panel 形态）          | `src/components/PluginTabPanel.tsx`（由 `src/features/teacher/TeacherView.tsx` 挂载）                                                   | `{ renderType: 'panel', lessonId, classId }`                                                                          |
| `teacher.dashboard.widget`           | `src/features/teacher/Dashboard.tsx`                                                                                                    | 无（仅 `route?`）                                                                                                     |
| `teacher.panel`                      | `src/features/teacher/Dashboard.tsx`                                                                                                    | `{ lang, lessons, classes, students }`                                                                                |
| `global.setting`                     | `src/features/teacher/SettingsView.tsx`                                                                                                 | `{ lang }`                                                                                                            |
| `nav.user_menu`                      | `src/components/UserMenu.tsx`                                                                                                           | `{ session, lang, closeMenu }`                                                                                        |
| `classroom.tool`                     | `src/features/whiteboard/components/WhiteboardToolbar.tsx`                                                                              | 无（仅 `route?`）                                                                                                     |
| `help.plugin_docs`                   | `src/features/teacher/help/PluginDocsViewer.tsx`                                                                                        | 无（仅 `route?`）                                                                                                     |
| `stage.display.card`                 | `src/features/classroom/stage-display/StageDisplayPanel.tsx`                                                                            | `{ stage }`                                                                                                           |
| `stage.display.overlay`              | `src/features/classroom/stage-display/StageDisplayPanel.tsx`                                                                            | `{ lessonId, lessonTitle, stage, data, isFullscreen, lang }`                                                          |
| `stage.display.action`               | `src/features/classroom/stage-display/StageDisplayPanel.tsx`                                                                            | `{ lessonId, lessonTitle, stage, data, isFullscreen, lang, onToggleFullscreen, onOpenPeerReview }`                    |
| `classroom.quick_activity`           | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ stage, lessonId, classId }`                                                                                        |
| `classroom.topbar.action`            | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ stage }`                                                                                                           |
| `classroom.topbar.pill`              | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ stage }`                                                                                                           |
| `classroom.header.action`            | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ lessonId, classId, stage }`                                                                                        |
| `classroom.countdown.widget`         | `src/features/classroom/ClassroomCountdownWidget.tsx`                                                                                   | 无（仅 `route?`）                                                                                                     |
| `classroom.countdown.action`         | `src/features/classroom/ClassroomCountdownWidget.tsx`                                                                                   | `{ onStart, onPause, onReset, onAddTime }`                                                                            |
| `classroom.portal.telemetry`         | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | 无（另传 `lang`）                                                                                                     |
| `classroom.portal.course_badge`      | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | `{ lessonId }`                                                                                                        |
| `classroom.portal.teaching_mode`     | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | `{ selectedModeId, registerHint }`                                                                                    |
| `classroom.portal.insight`           | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | 无                                                                                                                    |
| `classroom.portal.preflight`         | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | 无（另传 `lang`）                                                                                                     |
| `classroom.portal.launch_action`     | `src/features/classroom/ClassroomEntryPortal.tsx`                                                                                       | 无                                                                                                                    |
| `classroom.notification.tabs`        | `src/features/classroom/notifications/ParentNotificationModal.tsx`                                                                      | 无（仅 `route?`）                                                                                                     |
| `classroom.pacing.dashboard`         | `src/features/classroom/pacing/MasteryPredictionModal.tsx`                                                                              | 无（仅 `route?`）                                                                                                     |
| `classroom.barometer.metric`         | `src/features/classroom/PacingDashboardModal.tsx`                                                                                       | `{ lessonId, signals, total, health, lang }`                                                                          |
| `classroom.diagnostic.feed`          | `src/features/classroom/diagnostics/DiagnosticCenterModal.tsx`                                                                          | 无（仅 `route?`）                                                                                                     |
| `classroom.audit.event`              | `src/features/classroom/diagnostics/DiagnosticCenterModal.tsx`                                                                          | `{ activeTab, totalCount, lang }`                                                                                     |
| `classroom.collab.canvas`            | `src/features/classroom/collab-whiteboard/GroupCollabWhiteboardModal.tsx`                                                               | `{ lessonId, classId, activeGroupId, activeTool, activeColor, activeWidth, lang }`                                    |
| `classroom.agenda.action`            | `src/components/LiveClassroomView.tsx`                                                                                                  | `{ segment, isActive, idx, lessonId, lang }`                                                                          |
| `classroom.attribution.award`        | `src/features/classroom/ClassroomAttributionModal.tsx`                                                                                  | `{ student, onAwardPoints }`                                                                                          |
| `classroom.attribution.action`       | `src/features/classroom/ClassroomAttributionModal.tsx`                                                                                  | `{ student }`                                                                                                         |
| `classroom.leaderboard.action`       | `src/features/classroom/ClassroomLeaderboardModal.tsx`                                                                                  | 无（仅 `route?`）                                                                                                     |
| `classroom.preclass.passcode_action` | `src/features/classroom/PreClassReadyView.tsx`                                                                                          | `{ classId, classPasscode, expiresAt, isExpired, onRefresh }`                                                         |
| `classroom.preclass.passcode_addon`  | `src/features/classroom/PreClassReadyView.tsx`                                                                                          | `{ classId, classPasscode, expiresAt, isExpired, onRefresh }`                                                         |
| `classroom.post_class.widget`        | `src/features/classroom/PostClassWrapupView.tsx`                                                                                        | `{ lessonId }`                                                                                                        |
| `classroom.seating.toolbar`          | `src/features/classroom/ComputerLabSeatingMap.tsx`                                                                                      | `{ classId, lab, stats }`                                                                                             |
| `classroom.seating.legend`           | `src/features/classroom/ComputerLabSeatingMap.tsx`                                                                                      | `{ classId, stats }`                                                                                                  |
| `classroom.seating.summary`          | `src/features/classroom/ComputerLabSeatingMap.tsx`                                                                                      | `{ classId, stats, onlineStudentIds }`                                                                                |
| `classroom.seating.seat_badge`       | `src/features/classroom/ComputerLabSeatingMap.tsx`（每个座位内渲染）                                                                    | `{ seat, student, isOnline, classId }`                                                                                |
| `classroom.seating.seat_actions`     | `src/features/classroom/ComputerLabSeatingMap.tsx`                                                                                      | `{ seat, student, isOnline, classId, lang }`                                                                          |
| `student.classroom.countdown`        | `src/features/student/StudentCountdownBanner.tsx`                                                                                       | 无（仅 `route?`）                                                                                                     |
| `student.classroom.overlay`          | `src/features/student/StudentInteractiveOverlay.tsx`                                                                                    | `{ studentId, lessonId }`                                                                                             |
| `student.fullscreen`                 | `src/features/student/StudentInteractiveOverlay.tsx`                                                                                    | `{ studentId, lessonId }`                                                                                             |
| `student.lesson.tool`                | `src/features/student/StudentLessonInteractionPanel.tsx`                                                                                | `{ lessonId, studentId, activeSegmentId, lang }`                                                                      |
| `student.quick_actions.item`         | `src/features/student/components/StudentQuickActionsFloatingMenu.tsx`                                                                   | `{ studentId, lessonId, closeMenu }`                                                                                  |
| `student.quick_actions.action`       | `src/features/student/components/StudentQuickActionsFloatingMenu.tsx`                                                                   | `{ studentId }`                                                                                                       |
| `student.quick_actions.fab`          | `src/features/student/components/StudentQuickActionsFloatingMenu.tsx`                                                                   | `{ urgentCount }`                                                                                                     |
| `student.profile.tab`（button 形态） | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | `{ renderType: 'button', studentActiveTab, setStudentActiveTab, student, lessonId, classId, lang, progressHistory }`  |
| `student.profile.tab`（panel 形态）  | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | `{ renderType: 'panel', studentActiveTab, student, lessonId, classId, lang, progressHistory }`                        |
| `student.profile.dimension`          | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | `{ student, dimensions }`                                                                                             |
| `student.profile.card`               | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | 无（仅 `route?`）                                                                                                     |
| `student.profile.action`             | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | `{ student, lessonId, classId }`                                                                                      |
| `student.profile.timeline_item`      | `src/features/student/StudentGrowthProfileModal.tsx`                                                                                    | 无（仅 `route?`）                                                                                                     |
| `class.tab`（button 形态）           | `src/features/teacher/classes/ClassTabs.tsx`                                                                                            | `{ renderType, classId, classActiveTab, setClassActiveTab }`                                                          |
| `class.tab`（panel 形态）            | `src/features/teacher/classes/ClassesView.tsx`                                                                                          | `{ renderType, classId, students, lang, classActiveTab }`                                                             |
| `class.batch.action`                 | `src/features/teacher/classes/ClassStudentsPanel.tsx`                                                                                   | `{ classId, cls, lang, selectedStudentIds, selectedStudents, allStudents, disabled, onRefresh }`                      |
| `student.row.panel`                  | `src/features/teacher/classes/ClassStudentsPanel.tsx`                                                                                   | `{ studentId }`                                                                                                       |
| `editor.header.action`               | `src/features/teacher/LessonEditorView.tsx`                                                                                             | `{ lessonId, currentLesson, lang, isReadOnly, onSave }`                                                               |
| `editor.timeline_segment`            | `src/features/teacher/lesson-editor/SegmentEditorCard.tsx`                                                                              | `{ segment, lang, readOnly, onPatch }`（UI 附加面板）；`labelZh`+`labelEn` 的数据贡献另桥接环节类型注册表             |
| `editor.palette_item`                | `src/features/teacher/lesson-editor/LessonPalette.tsx`                                                                                  | `{ lang, onActivate, readOnly }`（自定义 UI）；数据贡献桥接 `paletteItemRegistry` 进入组件网格                        |
| `whiteboard.dock.plugin`             | `src/features/whiteboard/InteractiveWhiteboard.tsx`                                                                                     | `{ lessonId, classId, userRole, readOnly }`                                                                           |
| `whiteboard.canvas.widget`           | `src/features/whiteboard/InteractiveWhiteboard.tsx`                                                                                     | `{ lessonId, classId, userRole, readOnly }`                                                                           |
| `whiteboard.autosave.status`         | `src/features/teacher/LessonEditorView.tsx`                                                                                             | `{ lessonId, status, lastSavedTime }`                                                                                 |
| `whiteboard.autosave.action`         | `src/features/teacher/LessonEditorView.tsx`                                                                                             | `{ lessonId, flush }`                                                                                                 |
| `courseware.viewer.toolbar`          | `src/features/courseware/InteractiveCoursewareViewer.tsx`                                                                               | 无                                                                                                                    |
| `courseware.viewer.overlay`          | `src/features/courseware/InteractiveCoursewareViewer.tsx`                                                                               | 无                                                                                                                    |
| `peer_review.rubric.dimension`       | `src/features/classroom/peer-review/PeerReviewRubricModal.tsx`、`src/features/classroom/peer-review/PeerReviewRubricStats.tsx`          | 无（仅 `route?`）                                                                                                     |
| `peer_review.badge`                  | `src/features/classroom/peer-review/PeerReviewMatrixPanel.tsx`                                                                          | 无（仅 `route?`）                                                                                                     |
| `peer_review.action`                 | `src/features/classroom/peer-review/PeerReviewTelemetryHeader.tsx`、`src/features/classroom/peer-review/PeerReviewLeaderboardPanel.tsx` | 无（仅 `route?`）                                                                                                     |
| `peer_review.showcase.widget`        | `src/features/classroom/peer-review/SpotlightDualWorkArena.tsx`                                                                         | `{ workA, workB, annotations, isAnonymous }`                                                                          |
| `peer_review.work.preview`           | `src/features/classroom/peer-review/SpotlightDualWorkArena.tsx`                                                                         | `{ work, slot, isAnonymous }`                                                                                         |
| `timetable.tab`（button 形态）       | `src/components/TimetableManager.tsx`                                                                                                   | `{ renderType: 'button', timetableActiveTab, setTimetableActiveTab }`                                                 |
| `timetable.tab`（panel 形态）        | `src/components/TimetableManager.tsx`                                                                                                   | `{ renderType: 'panel', timetableActiveTab, classes, lessons, lang, onSchedulesUpdated }`                             |
| `admin.tab`（button 形态）           | `src/components/AdminPanel.tsx`                                                                                                         | `{ renderType: 'button', adminActiveTab, setAdminActiveTab }`                                                         |
| `admin.tab`（panel 形态）            | `src/components/AdminPanel.tsx`                                                                                                         | `{ renderType: 'panel', adminActiveTab, currentUserId, currentUserRole, lang, siteInfo }`                             |
| `assignment.submission.preview`      | `src/components/StudentAssignmentEvalPanel.tsx`                                                                                         | `{ submission, studentId, lessonId, isSelf, lang }`                                                                   |
| `assignment.file.preview`            | `src/components/AssignmentFilePreview.tsx`                                                                                              | `{ file, fileExtension, assignmentId, downloadUrl, inlineUrl, lang }`                                                 |
| `header.action`                      | `src/components/AppHeader.tsx`                                                                                                          | `{ session, currentRole, lang }`                                                                                      |
| `statusbar.item`                     | `src/components/AppStatusBar.tsx`（由 `src/App.tsx` 挂载；无插件贡献时不渲染）                                                          | `{ session, currentRole, lang, isOnline }`                                                                            |
| `whiteboard.renderer`                | `src/features/whiteboard/InteractiveWhiteboard.tsx`                                                                                     | `{ element, elementId, elementType, data, width, height, isSelected, readOnly, userRole, lessonId, onElementUpdate }` |
| `course.list.toolbar.action`         | `src/features/teacher/CourseManagement.tsx`                                                                                             | `{ selectedCourseIds, courses, lang, onRefresh }`                                                                     |
| `course.card.badge`                  | `src/features/teacher/CourseManagement.tsx`                                                                                             | `{ course, lang }`                                                                                                    |
| `course.card.action`                 | `src/features/teacher/CourseManagement.tsx`                                                                                             | `{ course, lang, onRefresh }`                                                                                         |
| `editor.segment.action`              | `src/features/teacher/lesson-editor/SegmentEditorCard.tsx`                                                                              | `{ segment, lang, readOnly, onPatch, segmentId }`                                                                     |
| `classroom.alert.banner`             | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ lessonId, classId, stage, lang }`                                                                                  |
| `classroom.cockpit.drawer.item`      | `src/features/classroom/ClassroomInteractiveCockpit.tsx`                                                                                | `{ lessonId, classId, stage, lang }`                                                                                  |
| `classroom.stage.display.ticker`     | `src/features/classroom/stage-display/StageDisplayPanel.tsx`                                                                            | `{ lessonId, lessonTitle, stage, data, lang }`                                                                        |
| `classroom.post_class.exporter`      | `src/features/classroom/PostClassWrapupView.tsx`                                                                                        | `{ lessonId, classId, summaryData, lang }`                                                                            |
| `timetable.toolbar.action`           | `src/components/TimetableManager.tsx`                                                                                                   | `{ schedules, currentWeekMonday, lang, onRefresh }`                                                                   |
| `timetable.card.badge`               | `src/components/timetable/sub-views/TimetableCalendarView.tsx`                                                                          | `{ schedule, lang }`                                                                                                  |
| `computer_lab.toolbar.action`        | `src/components/ComputerLabManager.tsx`                                                                                                 | `{ activeLab, computerLabs, onRefresh, lang }`                                                                        |
| `computer_lab.seat.overlay`          | `src/components/ComputerLabManager.tsx`                                                                                                 | `{ labId, row, col, seat, isOccupied }`                                                                               |
| `computer_lab.seating.toolbar`       | `src/components/ComputerLabManager.tsx`                                                                                                 | `{ labId, classId, assignedSeats, setAssignedSeats, lang }`                                                           |
| `computer_lab.unassigned.item`       | `src/components/ComputerLabManager.tsx`                                                                                                 | `{ student, classId, labId }`                                                                                         |
| `computer_lab.seating.sidebar`       | `src/components/ComputerLabManager.tsx`                                                                                                 | `{ labId, classId, assignedSeats, unassignedStudents }`                                                               |
| `student.dashboard.hero_widget`      | `src/features/student/StudentDashboardPanel.tsx`                                                                                        | `{ studentId, students, studentDashboardData, lang }`                                                                 |
| `student.assignment.toolbar.action`  | `src/features/student/StudentAssignmentHeader.tsx`                                                                                      | `{ assignment }`                                                                                                      |
| `student.lesson.notes_addon`         | `src/features/student/StudentLessonView.tsx`                                                                                            | `{ lessonId, studentId, activeSegmentId, lang }`                                                                      |
| `student.lesson.toolbox`             | `src/features/student/StudentLessonView.tsx`                                                                                            | `{ lessonId, studentId, lang }`                                                                                       |
| `admin.dashboard.card`               | `src/components/AdminPanel.tsx`                                                                                                         | `{ sqliteStats, lang }`                                                                                               |
| `admin.user.action`                  | `src/components/AdminPanel.tsx`                                                                                                         | `{ users, filteredUsers, lang, onRefresh }`                                                                           |
| `header.status_pill`                 | `src/components/AppHeader.tsx`                                                                                                          | `{ dbConnected, dbStatus, lang }`                                                                                     |
| `ai_sidebar.tab`（button 形态）      | `src/features/shared/RightSidebar.tsx`                                                                                                  | `{ renderType: 'button', activeTab, setActiveTab, lang }`                                                             |
| `ai_sidebar.tab`（panel 形态）       | `src/features/shared/RightSidebar.tsx`                                                                                                  | `{ renderType: 'panel', activeTab, lang }`                                                                            |
| `ai.prompt.template`                 | `src/features/shared/AiPromptTemplatePicker.tsx`（Agent 输入区模板选择器）                                                              | `{ title, description, category, prompt, parameters[{name,label,default}] }`（slotProps 即完整模板配置）              |
| `ai.skill.provider`                  | `server/ai-agent.ts`（Agent 工具注入，非渲染槽位）                                                                                      | `{ id, name, description, commandType, parametersSchema? }`（经 commandBus 以插件 actor 派发）                        |
| `course.wizard.quick_apply`          | `src/features/modals/CourseWizardModal.tsx`                                                                                             | `{ lang, wizardCourseTitle, wizardCourseCategory, wizardCourseTimeline, setWizardCourseTimeline, addToast }`          |
| `assessment.list.card`               | `src/features/assessment/AssessmentCenter.tsx`（**仅教师端**；`viewer` 恒为 `'teacher'`）                                               | `{ assessment, viewer, lang }`                                                                                        |
| `assessment.attempt.toolbar`         | `src/features/assessment/student/StudentAssessmentsView.tsx`                                                                            | `{ assignmentId, attemptId, lang }`                                                                                   |
| `assessment.stats.card`              | `src/features/assessment/StatsPanel.tsx`                                                                                                | `{ assignmentId, stats, lang }`                                                                                       |
| `assignment.grade.toolbar.action`    | `src/components/TeacherAssignmentGradePanel.tsx`                                                                                        | `{ lessonId, submissions, refresh, lang }`                                                                            |
| `assignment.grade.item.addon`        | `src/components/TeacherAssignmentGradePanel.tsx`（每个学生作答卡片内）                                                                  | `{ submission, studentId, lessonId, score, comment, isConfirmed, onScoreChange, onCommentChange, lang }`              |
| `assignment.grade.rubric.addon`      | `src/components/TeacherAssignmentGradePanel.tsx`（评分权重区）                                                                          | `{ lessonId, defaultTeacherWeight, defaultPeerWeight, onTeacherWeightChange, lang }`                                  |
| `editor.segment.type_config`         | `src/features/teacher/lesson-editor/SegmentEditorCard.tsx`                                                                              | `{ segmentType, segment, lang, readOnly, onPatch }`                                                                   |
| `editor.timeline.node_badge`         | `SegmentEditorCard.tsx`（`isActive` 恒 `true`）、`TimelineRail.tsx`                                                                     | `{ segment, lang, isActive, isCompleted }`（`TimelineRail` 另传 `idx`）                                               |
| `student.segment.badge`              | `src/features/student/StudentLessonContentPanel.tsx`                                                                                    | `{ segment, idx, isActive, isLocked, studentId, lessonId, lang }`                                                     |
| `student.segment.gate_fallback`      | `src/features/student/StudentLessonInteractionPanel.tsx`                                                                                | `{ lessonId, activeSegmentId, studentId, contentSegmentId, lang }`                                                    |
| `student.academic_year.metric_card`  | `src/features/student/StudentAcademicYearComparison.tsx`                                                                                | `{ studentId, comparisonData, selectedYears, lang }`                                                                  |
| `classroom.active_segment.main`      | `src/components/LiveClassroomView.tsx`（活跃环节主工作区，含兜底分支）                                                                  | `{ segment, lessonId, classId, lang, onRefresh }`                                                                     |
| `timetable.import.source`            | `src/components/timetable/sub-views/TimetableOcrView.tsx`                                                                               | `{ lang, onImportEntries }`                                                                                           |
| `timetable.entry.action`             | `src/components/timetable/sub-views/TimetableCalendarView.tsx`（周历卡片 + 列表行两处）                                                 | `{ schedule, lang, onEdit }`                                                                                          |
| `header.async_task.item`             | `src/components/AppHeader.tsx`                                                                                                          | `{ lang, activeRole, teacherTab, setTeacherTab }`                                                                     |
| `command_palette.item`               | `src/features/command-palette/command-palette.tsx`（数据型，宿主渲染命令项）                                                            | `{ title, description, category, keywords, commandType, payload, shortcut }`                                          |
| `quick_insert.item`                  | `src/features/quick-insert/quick-insert-menu.tsx`（数据型，宿主渲染斜杠菜单项）                                                         | `{ title, description, category, keywords, commandType, payload }`                                                    |

#### 1.1 锚点槽位（`anchor:*`，8 个）

`ExtensionPointRenderer` 在锚点按钮前后各渲染一次，用 `placement` prop 过滤：

| 锚点                                     | 调用点                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `anchor:whiteboard-toolbar:rollcall`     | `src/features/whiteboard/components/WhiteboardToolbar.tsx`                                         |
| `anchor:whiteboard-toolbar:presentation` | 同上                                                                                               |
| `anchor:whiteboard-toolbar:math-graph`   | 同上                                                                                               |
| `anchor:whiteboard-toolbar:code-sandbox` | 同上                                                                                               |
| `anchor:whiteboard-toolbar:courseware`   | 同上                                                                                               |
| `anchor:whiteboard-toolbar:ai-tutor`     | 同上                                                                                               |
| `anchor:whiteboard-toolbar:grid`         | 同上                                                                                               |
| `anchor:classroom-attribution:awards`    | `src/features/classroom/ClassroomAttributionModal.tsx`（`slotProps={{ student, onAwardPoints }}`） |

#### 1.2 历史幽灵槽位激活与归零记录（记录时点：全量槽位均已消费）

平台在早期版本中曾存在 14 个在 `ExtensionSlot` 中声明但未挂载渲染的幽灵槽位。目前已在系统性重构中全量挂载，并于本次全域扩展升级中新增 20 个高价值业务扩展槽位（包含与“国家智慧教育公共服务平台”直连对接能力），全部在 14 个前端核心视图中完成真实消费：

- **基础与课堂历史槽位全面激活**：`nav.user_menu`（顶部用户菜单）、`student.lesson.tool`（学生随堂工具）、`teacher.panel`（教师独立全宽面板）、`global.setting`（全局设置页）、`classroom.header.action`（中控顶栏动作）、`classroom.collab.canvas`（小组协作画布工具）、`classroom.barometer.metric`（晴雨表指标）、`classroom.agenda.action`（环节操作卡片）、`whiteboard.dock.plugin`（白板左下悬浮坞）、`whiteboard.canvas.widget`（白板画布任务卡片）、`classroom.audit.event`（审计事件流）、`classroom.seating.seat_actions`（机房座位右键菜单）、`editor.timeline_segment`（步骤形态扩展）、`editor.palette_item`（白板扩展图元卡片）；
- **全域 20 个业务槽位全新落地（含国家智慧教育平台直连）**：
  - 备课中心与课程库：`course.list.toolbar.action`、`course.card.badge`、`course.card.action`、`editor.segment.action`；
  - 课堂互动与执教大屏：`classroom.alert.banner`、`classroom.cockpit.drawer.item`、`classroom.stage.display.ticker`、`classroom.post_class.exporter`；
  - 课表与机房管理：`timetable.toolbar.action`、`timetable.card.badge`、`computer_lab.toolbar.action`、`computer_lab.seat.overlay`；
  - 学生学习门户与作业闭环：`student.dashboard.hero_widget`、`student.assignment.toolbar.action`、`student.lesson.notes_addon`、`student.lesson.toolbox`；
  - 管理后台与全域底座：`admin.dashboard.card`、`admin.user.action`、`header.status_pill`；
  - AI 助手侧边栏：`ai_sidebar.tab`；
- **声明但无渲染器的 `ExtensionSlot` 成员数量为 0**（记录时点）：联合类型槽位均具备明确的前端宿主消费方、响应式 Props 透传与上下文隔离机制。

---

## 2. 各槽位组件收到的 Props（实际注入）

渲染机制（`src/plugin-host/extension-point-renderer.tsx`）：

```typescript
React.createElement(resolveExtensionComponent(ext), {
  route: ext.route || route,
  lessonId,
  classId, // 宿主统一注入的课堂上下文（v0.2.8+）
  ...ext.slotProps,
  ...slotProps,
});
```

组件始终收到（合并顺序，后者覆盖前者）：

1. `route?: string` —— 来自 `ext.route` 或渲染器 `route` prop
2. `lessonId` / `classId` —— 宿主统一注入的当前课程/班级（`string | null`，见 §3）
3. `...ext.slotProps` —— 插件注册时声明的任意额外 props
4. `...slotProps` —— 宿主在调用点传入的 props

组件类型为 `React.ComponentType<any>`（`src/plugin-host/types.ts`）。

### 各槽位实际 props

所有经 `ExtensionPointRenderer` 渲染的槽位组件都收到 `{ lessonId, classId, route? }`（v0.2.8 起由渲染器统一注入），此外：

- **`student.view`**：`src/features/student/StudentDashboardPanel.tsx` 调用点额外注入 `{ studentId }`（注意 `src/features/student-workspace/widgets/student-default-widgets.tsx` 的 `StudentPluginWidgets` 调用点不注入 `studentId`）。
- **`teacher.tab`**：
  - `renderType === 'button'`（`src/plugin-host/extension-point-renderer.tsx`）：渲染器**不渲染插件主面板组件**，而是自行合成与系统内置 `NavButton` 视觉一致的侧边栏导航按钮。v0.5.1 起通过 `PluginIconRenderer` 解析并呈现插件自定义图标（优先取 `ext.icon`，次取 manifest `icon`，支持 Lucide 图标名、Emoji 符号、图片 URL 与 React 组件），且按 `position` 升序排列。
  - `renderType === 'panel'`（`src/components/PluginTabPanel.tsx`）：组件收到 `{ renderType: 'panel', lessonId, classId }`。
- **`classroom.tool`**（`src/features/whiteboard/components/WhiteboardToolbar.tsx`）：`{ lessonId, classId, route? }`。
- **`teacher.dashboard.widget`**（`src/features/teacher/Dashboard.tsx`）：`{ lessonId, classId, route? }`（可见性由 `dashboardVisibility` store 按插件控制）。
- **`help.plugin_docs`**（`src/features/teacher/help/PluginDocsViewer.tsx`）：`{ lessonId, classId, route? }`。

### 注册配置形态（即插件声明时的类型，`src/plugin-host/types.ts` 的 `ExtensionPointConfig`）

```typescript
interface ExtensionPointConfig {
  id: string;
  label: string;
  icon?: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  position?: number;
  pluginId: string;
  group?: 'teaching' | 'management' | 'analytics' | 'extension' | string;
  badge?: number | string;
  rolesAllowed?: ('admin' | 'teacher' | 'student')[];
  route?: string;
  slotProps?: Record<string, any>; // 合并进组件的任意额外 props
  placement?: 'before' | 'after'; // v0.2.6: 锚点槽位专用，相对宿主锚点按钮的位置（默认 'after'）
  render?: (props?: Record<string, any>) => React.ReactNode; // v3: 可选自定义渲染函数（非组件式扩展点）
}
```

### manifest `contributes` 配置形态（**仅元数据，不挂载组件**）

```typescript
interface ClassroomToolConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  commandType: string;
  payload?: Record<string, unknown>;
}
interface TeacherTabConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}
interface DashboardWidgetConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}
interface StudentViewConfig {
  id: string;
  label: string;
  icon?: string;
  route?: string;
}
interface StudentLessonToolConfig {
  id: string;
  label: string;
  icon?: string;
}
interface AnchorToolConfig {
  id: string;
  label: string;
  icon?: string;
  placement?: 'before' | 'after';
}
interface HelpDocConfig {
  id: string;
  title: string;
  description?: string;
  markdownUrl?: string;
}
```

> `manifest.contributes` 仅存入 `ContributionRegistry` 供管理端预览，前端 `ExtensionPointRenderer` 读取的是 zustand `ExtensionPointRegistry`，**不是** contribution registry。

---

## 3. 宿主注入了哪些上下文？（如何获取 user/role/lessonId/classId/socket）

**没有**包裹插件组件的 per-slot Provider 注入 `userId` / `role` / `socket`。自 v0.2.8 起，宿主**统一注入**以下课堂上下文：

1. **React Props（渲染时）** —— 见 §2。所有扩展点组件收到 `lessonId`（当前课程，`string | null`，源 `appStore.selectedLesson`）与 `classId`（当前班级，`string | null`，源 `appStore.liveClassSelectedClassId`）；`student.view` 调用点额外注入 `studentId`；`teacher.tab` panel 形态额外收到 `renderType: 'panel'`。
2. **`ctx.context`（激活时 / 非渲染场景）** —— `FrontendPluginContext` 新增只读快照 + 订阅（v0.2.8）：
   ```typescript
   context?: {
     get(): { lessonId: string | null; classId: string | null };
     subscribe(cb: (ctx: { lessonId: string | null; classId: string | null }) => void): () => void;
   };
   ```
   用于事件回调、命令处理等非 React 组件场景读取当前课程/班级。
3. **React Context `PluginHostProvider`** —— `src/main.tsx` 包裹整个应用。组件内调用 `usePluginHost()`（`src/plugin-host/plugin-host-context.tsx`）获取 `FrontendPluginHost`。
4. **`FrontendPluginContext`**（即 `activate` 收到的 `ctx`，也是 `usePluginHost()` 暴露的内容，`src/plugin-host/types.ts`）：
   ```typescript
   interface FrontendPluginContext {
     services: {
       frontendApi: IFrontendAPI;       // get/post/del 访问后端
       socketService: ISocketService;   // emit/on/off/disconnect（非原生 socket.io Socket）
       uiService: IUIService;           // showToast/showModal/closeModal/downloadFile
       storageService: IStorageService; // get/set/delete/clear（字符串 KV）
     };
     pluginId: string;
     manifest: FrontendPluginManifest;
     ui: { registerExtensionPoint; unregisterExtensionPoint; registerFullscreenRenderer; registerPropertyEditor; registerCoursewareSource; unregisterCoursewareSource; registerPaletteItem; unregisterPaletteItem; registerSegmentType; unregisterSegmentType; /* ... */ };
     invokeCommand<T>(type: string, payload?: unknown): Promise<T>;
     navigation: { getTeacherTab; setTeacherTab; subscribeTeacherTab };
     context: { get; subscribe };        // v0.2.8 课堂上下文
     registerPanel? / registerMenu? / registerToolbarButton?; // 兼容 shim
   }
   ```
   `ISocketService` 为 `emit/on/off/disconnect` 的薄封装（`src/plugin-host/types.ts`），**不是**原生 `Socket`。`FrontendPluginContext` 上**没有** `auth` / `user` / `role` 字段。

**结论**：当前课程/班级由宿主统一注入——渲染场景读 `props.lessonId` / `props.classId`，非渲染场景用 `ctx.context.get()` / `ctx.context.subscribe()`。当前用户/角色/原生 `socket` 仍**不注入**：插件需通过 `usePluginHost()` → `services` 或 `ctx.services` 自行获取（**不要**尝试 `import { useAppStore } from '@/...'`——`@/` 别名是宿主内部路径，第三方插件打包时不可解析）。唯一的身份门控是声明式 `rolesAllowed`（`src/plugin-host/types.ts`），在**注册时**评估，而非渲染时。

---

## 4. 插件如何声明目标槽位

存在**两套机制**：

### A. 命令式 React 组件注册（真正挂载 UI）

前端插件模块导出形状（`src/plugin-host/plugin-host.ts` 的 `PluginModule`）：

```typescript
export interface PluginModule {
  default?: {
    manifest: FrontendPluginManifest;
    activate: (ctx: FrontendPluginContext) => Promise<void>;
    deactivate?: () => Promise<void>;
  };
  manifest?: FrontendPluginManifest;
  activate?: (ctx: FrontendPluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}
```

在 `activate(ctx)` 内调用 `ctx.ui.registerExtensionPoint(slot, config)`（签名见 `src/plugin-host/types.ts` 的 `FrontendPluginContext.ui`，实现在 `src/plugin-host/plugin-host.ts` 的 `activate`）。兼容 shim：

- `ctx.registerPanel(config)` → 槽位 `config.slot || 'teacher.dashboard.widget'`
- `ctx.registerMenu(config)` → 槽位 `config.slot || 'teacher.panel'`
- `ctx.registerToolbarButton(config)` → 槽位硬编码为 `classroom.tool`（不接受 `config.slot`）

此外 `manifest.classroomTools` 项在激活时**自动注册**为 `classroom.tool` 扩展点（`src/plugin-host/plugin-host.ts` 的 `activate` 内的 classroomTools 桥接段），但组件为 `() => null` 占位——它们是命令触发的工具栏按钮，而非 React 面板。

### B. 声明式 manifest `contributes`（仅元数据层）

`packages/plugin-sdk/openlearn.d.ts` 的 `Manifest.contributes?: Record<string, any>`，经 `packages/core/esm-loader/manifest-schema.ts` 的 `contributesSchema` 校验为按槽位名索引的对象（每个值是该槽位专属的 Zod 对象数组）。存入 `ContributionRegistry` 供管理端预览，**不挂载 React 组件**。

> 最后更新：2026-07-26

---

## 5. 白板全屏渲染器注册表 (`fullscreenRendererRegistry`)

**注册表位置**：`src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx`

插件在 `activate(ctx)` 内通过 `ctx.ui.registerFullscreenRenderer(type, renderer)` 为白板组件类型注册自定义全屏视图。白板中点击组件的最大化按钮时，`FullscreenOverlay` 优先查询注册表；若无匹配，自动使用智能默认渲染器。

> ⚠️ **第三方可达性（v3.5）**：`fullscreenRendererRegistry` 单例是**宿主内部对象**，第三方插件**不能** `import { fullscreenRendererRegistry } from '@/features/whiteboard/fullscreen'`（`@/` 是宿主 Vite 别名，插件打包时无法解析，且运行时无此全局）。唯一正确入口是 `activate(ctx)` 注入的 `ctx.ui.registerFullscreenRenderer`。类型 `FullscreenRendererProps` 从 `@openlearn/plugin-sdk` 导入（type-only）。

### 使用方式

```tsx
import type { FullscreenRendererProps } from '@openlearn/plugin-sdk';

async function activate(ctx) {
  ctx.ui.registerFullscreenRenderer(
    'ext-my-plugin/widget',
    ({ data, onClose, containerSize, lessonId }: FullscreenRendererProps) => (
      <div className="flex flex-col items-center justify-center h-full">
        <h2>{data.title}</h2>
        <p>{data.content}</p>
      </div>
    ),
  );
}
```

同理可调用 `ctx.ui.unregisterFullscreenRenderer(type)`；插件停用/卸载时宿主自动清理其注册，无需手动注销。

### Props 类型 (`FullscreenRendererProps`)

```typescript
{
  elementType: string;
  data: Record<string, any>;
  onClose: () => void;
  containerSize: { width: number; height: number };
  lessonId: string;
}
```

### 默认兜底渲染

未注册的类型自动使用 `src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx` 中的 `DefaultFullscreenRenderer`，按优先级检测 `data` 字段：
`code` → 代码编辑器 / `markdown` → Markdown 预览 / `question` + `options` → 测验视图 / `text` → 文本展示 / `url` → 外链 / `src` → 图片 / `coursewareUuid` → iframe 课件 / `equation` → 公式 / 无可识别字段 → JSON 摘要。

全屏 overlay 通过 `createPortal` 渲染到 `document.body`，使用 `fixed` 定位覆盖整个浏览器视口，支持 ESC 键和右上角关闭按钮退出。

---

## 6. 白板属性编辑器注册表 (`propertyEditorRegistry`)

**注册表位置**：`src/features/whiteboard/properties/PropertyEditorRegistry.tsx`

插件在 `activate(ctx)` 内通过 `ctx.ui.registerPropertyEditor(type, editor)` 为白板组件类型注册自定义属性编辑器，在白板右侧属性面板中渲染。

> ⚠️ **第三方可达性（v3.5）**：同 §5，`propertyEditorRegistry` 是宿主内部单例，第三方插件不能 `import`。唯一正确入口是 `ctx.ui.registerPropertyEditor`。类型 `PropertyEditorProps` 从 `@openlearn/plugin-sdk` 导入（type-only）。

### 使用方式

```tsx
import type { PropertyEditorProps } from '@openlearn/plugin-sdk';

async function activate(ctx) {
  ctx.ui.registerPropertyEditor(
    'ext-my-plugin/widget',
    ({ data, updateData, elementId, lessonId }: PropertyEditorProps) => (
      <div className="space-y-3">
        <label className="block text-[10px] text-slate-400 font-semibold mb-1">标题</label>
        <input
          value={data.title || ''}
          onChange={(e) => updateData({ title: e.target.value })}
          className="w-full p-2 border border-slate-200 rounded-lg text-xs"
        />
      </div>
    ),
  );
}
```

### Props 类型 (`PropertyEditorProps`)

```typescript
{
  elementId: string;
  elementType: string;
  data: Record<string, any>;          // 当前元素属性（可读写副本）
  updateData: (partial: Record<string, any>) => void;  // 更新属性，自动同步到后端
  lessonId: string;
  onClose: () => void;
}
```

调用 `updateData(partial)` 会立即触发本地状态更新 + 持久化到 SQLite。通用属性（x 坐标、y 坐标、宽度、高度）和删除按钮由平台统一渲染，插件无需关心。

---

## 7. 课件内容源扩展 (`coursewareSourceRegistry`)

插件可以为白板 `html-applet` 组件接入自定义内容后端（如 OAuth 授权的第三方课件平台、私有资源网关）。

### 使用方式

```typescript
import type { CoursewareSourceLoader } from '@openlearn/plugin-sdk';

async function activate(ctx) {
  ctx.ui.registerCoursewareSource({
    id: 'ext-moodle/courseware',
    resolve: (data, { lessonId }) =>
      data.sourceType === 'moodle' ? `https://moodle.example.com/course/${data.sourceId}?lesson=${lessonId}` : null,
  } satisfies CoursewareSourceLoader);
}
```

- `resolve(data, { lessonId })` 返回 iframe 的 `src` URL；无法处理时返回 `null`。
- 内容源优先级：`coursewareUuid` > `resourceId` > **插件自定义内容源** > `code`（`srcDoc`）。
- 停用/卸载时宿主自动清理插件注册的 loader；`ctx.ui.unregisterCoursewareSource(id)` 可手动注销。
- `HtmlAppletPayload` 约定字段 `sourceType` / `sourceId` 供插件 loader 识别。

## 8. LMS Bridge 双向通信

课件运行在沙箱 iframe 内，通过注入的 `window.LMS` 与宿主双向通信：

| 方法                                   | 方向      | 说明                          |
| -------------------------------------- | --------- | ----------------------------- |
| `LMS.submit(data)` / `finish(data)`    | 课件→宿主 | 提交成绩（status=submitted）  |
| `LMS.saveProgress(data)`               | 课件→宿主 | 保存进度（status=inprogress） |
| `LMS.log(event, data)`                 | 课件→宿主 | 遥测日志                      |
| `LMS.setConfig(config)`                | 课件→宿主 | 上报配置/元数据               |
| `LMS.getProgress()`                    | 课件→宿主 | 请求恢复上次进度（Promise）   |
| `LMS.on(event, cb)` / `off`            | 宿主→课件 | 订阅宿主下发指令              |
| `LMS.getStudent()` / `getCourseware()` | 同步      | 读取上下文                    |

宿主侧 `sendCommandToCourseware(iframe, event, payload)`（`src/services/lms-bridge.ts`）可向指定 iframe 下发 `LMS_HOST_COMMAND`。课件事件会发布到前端 `EventBus`（`courseware.submitted` / `progress_saved` / `event_logged` / `config_reported`），`courseware.` 前缀会经 Socket 转发到后端 EventBus 供 AI Agent 与插件订阅。

---

## 9. 备课画板组件扩展 (`paletteItemRegistry` / 课程设计组件插槽)

自 v0.3.17 起，课程设计（备课画板）与白板画布开放了**组件扩展插槽 (Palette Item Extension)**。插件不仅能在课堂工具栏添加按钮，还可以向左侧备课画板组件面板（`LessonPalette`）注入专属教学组件（如学科仿真实验、3D 分子结构、乐谱互动、特定编程评测沙箱等）。

### 核心特性

1. **左侧画板自动归类与检索**：插件注册的组件会自动出现在备课组件面板中，支持按分组分类（可置于默认分组或自定义全新分组）、关键词拼音与中英文检索、收藏置顶。
2. **初始配置弹窗 (PaletteCardEditModal)**：教师在备课面板点击插件卡片时，宿主自动根据声明的 `editFields`（支持 input、textarea、select、options 等）弹出参数配置浮层，支持静态选项或异步加载，配置后自动将组件置于画板中央。
3. **白板画布标准卡片容器**：白板画布自动为插件组件提供统一的标准教学卡片外壳，包含组件标题栏、自由拖拽移动、四角平滑缩放、最小化折叠、全屏展示与删除控制。
4. **属性侧边栏自动映射**：教师在画布中选中插件组件时，宿主右侧属性面板自动识别：若插件未注册定制的 `propertyEditor`，平台自动根据 `editFields` 生成即时响应的通用配置表单。
5. **生命周期自动回收**：当插件热重载或停用卸载时，宿主按 `pluginId` 自动从画板移除对应组件，防止内存泄漏或脏配置。

### 注册 API

```tsx
import type { PaletteItemConfig } from '@openlearn/plugin-sdk';

async function activate(ctx) {
  ctx.ui.registerPaletteItem({
    type: 'ext-chemistry/molecule-viewer',
    labelZh: '3D 分子结构探究',
    labelEn: '3D Molecule Viewer',
    descriptionZh: '支持 PDB 格式高保真 3D 分子轨道与化学键可视化演示',
    descriptionEn: 'Interactive 3D molecule model viewer',
    color: 'emerald',
    group: 'media', // 或指定 'extension' / 自定义分组
    defaultData: {
      title: '乙醇分子模型 (Ethanol)',
      moleculeCode: 'CCO',
      displayMode: 'ball-and-stick',
    },
    editFields: [
      {
        key: 'title',
        labelZh: '模型名称',
        labelEn: 'Title',
        kind: 'input',
        placeholderZh: '输入分子模型名称...',
      },
      {
        key: 'moleculeCode',
        labelZh: 'SMILES / PDB 编码',
        labelEn: 'Molecule Code',
        kind: 'input',
        placeholderZh: '例如 CCO、C6H12O6...',
      },
      {
        key: 'displayMode',
        labelZh: '渲染样式',
        labelEn: 'Display Mode',
        kind: 'select',
        options: [
          { value: 'ball-and-stick', label: '球棍模型 (Ball & Stick)' },
          { value: 'space-filling', label: '比例模型 (CPK)' },
          { value: 'wireframe', label: '线框模型 (Wireframe)' },
        ],
      },
    ],
    // 白板画布渲染视图组件
    component: ({ elementId, lessonId, data, userRole, onElementUpdate }) => {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900 text-white">
          <div className="text-sm font-bold text-emerald-400">{data.title}</div>
          <div className="text-xs text-slate-300 mt-1">
            模式: {data.displayMode} | 编码: {data.moleculeCode}
          </div>
          {/* 这里可以嵌入 3D Canvas / 仿真引擎 */}
        </div>
      );
    },
  });
}
```

### Component Props 规范

```typescript
interface PaletteItemComponentProps {
  elementId: string;
  lessonId: string;
  data: Record<string, any>;
  userRole?: 'teacher' | 'student';
  onElementUpdate?: (elementId: string, data: Record<string, any>) => Promise<void>;
}
```

---

## 10. 白板自定义图元渲染器扩展 (`whiteboard.renderer`)

**槽位名称**：`whiteboard.renderer`  
**挂载位置**：`src/features/whiteboard/InteractiveWhiteboard.tsx`（白板画布核心渲染流水线）

与传统备课小组件或局部浮层不同，`whiteboard.renderer` 为白板引入**自定义一等公民图元渲染**能力。第三方插件可为特定的图元类型（如 Desmos 函数图像、GeoGebra 几何、分子 3D 结构等）注册专属图元渲染器，深度接入白板的缩放、平铺拖拽、选框高亮、右键上下文菜单以及实时事件同步流水线。

### 注册方式

在插件激活阶段调用 `ctx.ui.registerExtensionPoint('whiteboard.renderer', ...)`：

```tsx
import type { WhiteboardRendererSlotProps } from '@/plugin-host/types';

async function activate(ctx) {
  ctx.ui.registerExtensionPoint('whiteboard.renderer', {
    id: 'desmos-graph-renderer',
    label: 'Desmos 图形计算器',
    targetType: 'desmos', // 匹配图元类型 el.type === 'desmos'
    component: () => import('./DesmosGraphComponent'),
  });
}
```

### Props 规范 (`WhiteboardRendererSlotProps`)

```typescript
export interface WhiteboardRendererSlotProps {
  element: any; // 原始白板图元对象
  elementId: string; // 图元 ID
  elementType: string; // 图元类型
  data: Record<string, any>; // 元素已解析的数据 payload
  width: number; // 当前视口计算宽度
  height: number; // 当前视口计算高度
  isSelected?: boolean; // 是否当前选中
  readOnly?: boolean; // 是否处于只读锁定态
  userRole?: 'teacher' | 'student'; // 当前用户角色
  lessonId?: string; // 课程/课节 ID
  onElementUpdate?: (elementId: string, patch: Record<string, any>) => Promise<void>; // 更新回调
  dispatcher?: IHostActionDispatcher; // 宿主动作派发器
}
```

### 特性支持

1. **一等公民画布生命周期**：参与自动平铺布局、缩放定位、层级变换与双击全屏；
2. **边框与外观定制**：支持 `data.frameless = true` 实现无外壳/无标题栏透明呈现；
3. **实时数据协同**：调用 `onElementUpdate` 自动向 `frontendEventBus` 广播 `whiteboard.element_updated`，触发全班同步。

---

## 10.1 作业附件预览扩展 (`assignment.file.preview`)

**槽位名称**：`assignment.file.preview`
**挂载位置**：`src/components/AssignmentFilePreview.tsx`（作业附件预览对话框）

### 它解决什么问题

学生上传的作业附件过去**只有文件名**，没有任何查看内容的方式。宿主现在内置四种预览形态：

| 文件类型                                                      | 渲染方式                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 图片（png/jpg/gif/webp/bmp/svg/heic）                         | `<img>`                                                                            |
| PDF                                                           | `<iframe>`（服务端以 `inline` 返回，浏览器内置查看器渲染）                         |
| 纯文本 / 代码 / 数据（txt/md/csv/json/xml/html/css/各类源码） | `<pre>`，**按文本渲染，绝不解析成 HTML**                                           |
| 其它（docx/pptx/xlsx/zip/rtf…）                               | 不内置解析 —— 给出「暂不支持预览」+ 下载入口，并展示本插槽里声明能处理该类型的插件 |

docx / pptx / xlsx 这类格式**故意不内置解析**：要么引入重依赖，要么自己写 OOXML
解析器（既是安全面也是维护面）。本插槽就是为此准备的扩展点 —— 平台不猜，插件声明
自己能处理什么类型。

### 契约：数据型插槽（远程插件可用）

远程 / Worker 插件**不能**提供 React 组件，所以本插槽是**数据型**的：插件声明
「我能处理哪些类型」，宿主负责渲染入口。

```tsx
async function activate(ctx) {
  ctx.ui.registerExtensionPoint('assignment.file.preview', {
    id: 'docx-preview',
    label: 'Word 预览器',
    component: () => null, // 数据型贡献：组件位留空
    slotProps: {
      extensions: ['.docx'], // 按扩展名匹配
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      commandType: 'ext-docx.preview', // 点击后由宿主派发
    },
  });
}
```

manifest 声明式写法（`packages/core/esm-loader/manifest-schema.ts` 已收录该键）：

```json
{
  "contributes": {
    "frontendSlots": {
      "assignment.file.preview": [
        {
          "id": "docx-preview",
          "label": "Word 预览器",
          "slotProps": { "extensions": [".docx"], "commandType": "ext-docx.preview" }
        }
      ]
    }
  }
}
```

**匹配规则**：宿主拿当前附件的扩展名（`fileExtension`，小写含前导点）去比对贡献声明的
`extensions` / `mimeTypes`，命中其一才渲染 —— 一个只会处理 `.docx` 的预览器不会出现在
`.png` 的预览对话框里。声明 `'*'` 表示**通配**（兜底型预览器，对所有类型都匹配）；
**未声明** `extensions` / `mimeTypes` 的贡献不匹配任何文件 —— 静默出现在每个对话框里的
预览器比不出现更糟。

**命令派发**：命中后宿主向 `/api/plugins/execute-command` 派发 `commandType`，payload：

```typescript
{
  fileId: string; // 附件 id
  assignmentId: string; // 所属作业 id
  fileName: string; // 原始文件名
  downloadUrl: string; // 带鉴权的下载地址（attachment 语义）
  inlineUrl: string; // 带鉴权的预览地址（仅当服务端判定该类型可内联时才会真的内联）
}
```

### Props 规范 (`AssignmentFilePreviewSlotProps`)

```typescript
export interface AssignmentFilePreviewSlotProps {
  file: { id: string; name: string; size: number | null; mime: string | null };
  fileExtension: string; // 小写、含前导点，如 '.docx'
  assignmentId: string;
  downloadUrl: string;
  inlineUrl: string;
  lang?: 'zh' | 'en';
  dispatcher?: IHostActionDispatcher;
}
```

### 安全口径

1. 所有内容都走**带鉴权**的 `/api/assignments/:assignmentId/files/:fileId`，
   不经过任何静态目录（`storage/` 从未被 `express.static` 暴露）。
2. 服务端按**扩展名**推导 Content-Type，绝不采信上传时客户端自报的 mime。
3. `text/html` / `image/svg+xml` 这类**可执行文档**一律强制下载（`attachment`），
   不允许 inline —— inline 回去等于把学生上传的文件变成同源页面。
   SVG 仍可预览，但只走 `<img>`（图片上下文不执行 SVG 脚本）。
4. 文本内容以 `text/plain` 拉取并用 `<pre>` 渲染；预览组件里不出现
   `dangerouslySetInnerHTML`。

判定规则集中在 `packages/core/assignment/file-preview-policy.ts`（前后端共用同一份）。

---

## 11. 全域业务扩展槽位规范与使用指南（含国家智慧教育平台对接）

本次升级新增的 20 个高价值扩展槽位，覆盖备课中心、互动课堂、大屏展台、课表、机房、学生端、管理后台以及 AI 侧边栏，为连接“国家智慧教育公共服务平台”等外部权威平台提供了完整的集成挂载点。

### 11.1 备课中心与课程库（国家平台对接 / 资源生态）

- **`course.list.toolbar.action`**：在 `CourseManagement` 顶部工具栏注入，Props 包含 `{ selectedCourseIds, courses, lang, onRefresh }`。国家教育平台插件可通过此槽位挂载「从国家智慧教育平台导入精品课」或「批量同步课程资源」操作按钮。
- **`course.card.badge`**：在课程卡片标题旁渲染，Props 包含 `{ course, lang }`。插件可基于课程元数据展示「国家级精品课」、「部优课程」等官方认证角标。
- **`course.card.action`**：在课程卡片底部操作区渲染，Props 包含 `{ course, lang, onRefresh }`。插件可挂载「上报至智慧教育平台」或「查看国家云资源链接」等单课操作项。
- **`editor.segment.action`**：在课程备课编辑器 `SegmentEditorCard` 环节卡片工具栏渲染，Props 包含 `{ segment, lang, readOnly, onPatch, segmentId }`。供国家平台微课资源插入、智能教案辅助等教学环节级工具接入。

### 11.2 课堂互动与执教大屏

- **`classroom.alert.banner`**：在交互驾驶舱顶部横幅区域渲染，Props 包含 `{ lessonId, classId, stage, lang }`。用于全班广播、设备异常警告或国家平台直播/推流提醒。
- **`classroom.cockpit.drawer.item`**：在驾驶舱侧边抽屉中渲染，Props 包含 `{ lessonId, classId, stage, lang }`。
- **`classroom.stage.display.ticker`**：在大屏展台底部跑马灯/状态条渲染，Props 包含 `{ lessonId, lessonTitle, stage, data, lang }`。支持全屏展示时滚动国家平台同步信息、全班公告等。
- **`classroom.post_class.exporter`**：在课后总结报告页 `PostClassWrapupView` 导出按钮区渲染，Props 包含 `{ lessonId, classId, summaryData, lang }`（`summaryData` 为本堂课真实统计：`lessonTitle/className/attemptsCount/exitTicketStats`）。支持一键导出符合国家教育平台标准格式的学情分析与教学评价报告。

### 11.3 课表与机房管理

- **`timetable.toolbar.action`**：在课表管理工具栏渲染，Props 包含 `{ schedules, currentWeekMonday, lang, onRefresh }`。用于学期课表一键同步或对接外部排课系统。
- **`timetable.card.badge`**：在日历课表卡片中渲染，Props 包含 `{ schedule, lang }`。展示公开课、国家平台同步直播课等标记。
- **`computer_lab.toolbar.action`**：在机房管理工具栏渲染，Props 包含 `{ activeLab, computerLabs, onRefresh, lang }`。
- **`computer_lab.seat.overlay`**：在机房座位图每个座位单元内渲染浮层，Props 包含 `{ labId, row, col, seat, isOccupied }`。宿主已对座位根节点的 onClick 做了点击冒泡隔离（overlay 内点击不会误触座位安排/移除）。
- **`computer_lab.seating.toolbar`**：在「班级机位联动」工具栏（清空/保存按钮旁）渲染，Props 包含 `{ labId, classId, assignedSeats, setAssignedSeats, lang }`。适用于按学号/成绩/分组自动排座、座位表导入导出等。
  - **没有 `onSeatMove` 回调**：宿主不会主动通知插件座位变更。插件已拿到响应式的 `assignedSeats`，若需校验或记录，自行与上一次渲染的座位表 diff（`useRef` 保存上一轮快照），发现违规排座（如排到故障机位）时调用 `setAssignedSeats(prev => …)` 回滚。
- **`computer_lab.unassigned.item`**：在未排座学生列表的每个条目旁渲染（与学生选择按钮同级，避免嵌套交互元素），Props 包含 `{ student, classId, labId }`。可显示学生身体状况、分组等标签。
- **`computer_lab.seating.sidebar`**：在座位网格下方的统计区渲染，Props 包含 `{ labId, classId, assignedSeats, unassignedStudents }`。适用于排座统计、规则校验结果展示。

### 11.4 学生学习门户与作业闭环

- **`student.dashboard.hero_widget`**：在学生主页 Hero 区域渲染，Props 包含 `{ studentId, students, studentDashboardData, lang }`。用于展示国家平台自主学习任务流、每日推荐资源等。
- **`student.assignment.toolbar.action`**：在作业详情顶栏渲染，Props 包含 `{ assignment }`。
- **`student.lesson.notes_addon`**：在学生端随堂笔记区域挂载插件工具，Props 包含 `{ lessonId, studentId, activeSegmentId, lang }`。
- **`student.lesson.toolbox`**：在学生端课堂工具箱区域挂载，Props 包含 `{ lessonId, studentId, lang }`。

### 11.5 管理后台与全域底座

- **`admin.dashboard.card`**：在管理员控制台概览区渲染卡片，Props 包含 `{ sqliteStats, lang }`。支持接入国家平台连接状态监控卡片、全校数据上报大屏。
- **`admin.user.action`**：在用户管理操作区渲染，Props 包含 `{ users, filteredUsers, lang, onRefresh }`。支持国家统一身份认证账号绑定与实名校验。
- **`header.status_pill`**：在全局顶栏右侧状态区渲染胶囊徽标，Props 包含 `{ dbConnected, dbStatus, lang }`（连通状态由插件组件自行探测其目标服务并如实呈现）。

### 11.6 AI 助手侧边栏

- **`ai_sidebar.tab`**：在全局右侧侧边栏中渲染，支持 `button`（顶部 Tab 切换按钮，Props `{ renderType: 'button', activeTab, setActiveTab, lang }`）与 `panel`（Tab 激活时的自定义面板，Props `{ renderType: 'panel', activeTab, lang }`）两种渲染态，渲染器按 `activeTab === 'plugin:{pluginId}/{extId}'` 过滤单面板。允许第三方 AI 助手或智能教研 Agent 深度嵌入右侧抽屉。
- **`ai.prompt.template`**：在 Agent 聊天输入框旁的模板选择器（`AiPromptTemplatePicker`）中消费，slotProps 即完整模板配置 `{ title, description?, category?, prompt, parameters?[{name,label,default?}] }`；`{{参数名}}` 占位经填参渲染后插入输入框。无插件注册时选择器零渲染。
- **`ai.skill.provider`**：**非渲染槽位**，由服务端 AI Agent 消费（`server/ai-agent.ts`）：manifest `contributes['ai.skill.provider']` 的命令经 `pskill_*` 工具名注入 OpenAI function-calling 工具列表，模型调用后以**贡献插件自身 actor**（`plugin:{manifest.id}`，持有 capabilitiesProposed 授权）经 commandBus 派发，内核拦截器照常做 descriptor/inputSchema/能力检查；descriptor 缺失时 fail-closed 拒绝派发。

---

## 12. 后续新增槽位的使用说明

> 本节补齐 §1 清单中在 §11 之后新增、但此前没有展开说明的槽位。每个槽位标注**真实调用点**与**实际注入的 props**；props 以 §2 表格和 `src/plugin-host/types.ts` 的 `*SlotProps` 接口为准，本节只解释语义与易踩的坑。
> 前提：除 §12.7 的数据型槽位外，所有经 `ExtensionPointRenderer` 渲染的槽位都额外收到宿主统一注入的 `lessonId` / `classId`（见 §3）。

### 12.1 测评子系统（`assessment.*`，Issue #183）

三个槽位全部走**白名单投影**：`answerKey` / 学生身份 / 逐个学生作答**永不进入 props**（实现见 `src/features/assessment/extension-slot-props.ts`，回归测试 `assessment-extension-slots.test.tsx` 用哨兵字段断言）。新增字段默认不可见，不要指望宿主后续自动透传。

| 槽位                         | 渲染位置                                 | 适合做什么                             |
| ---------------------------- | ---------------------------------------- | -------------------------------------- |
| `assessment.list.card`       | 测评列表每张卡片内（`AssessmentCenter`） | 卡片角标、资源入口、状态补充           |
| `assessment.attempt.toolbar` | 学生作答页底栏「交卷」按钮旁             | 计算器、草稿纸、草稿暂存、题型专用工具 |
| `assessment.stats.card`      | 统计页逐题表格上方                       | 自定义图表、分析结论、导出入口         |

**`assessment.list.card` 的 `viewer` 目前恒为 `'teacher'`。** 类型声明是 `'teacher' | 'student'`，但学生端从未渲染该槽位——按 `viewer === 'student'` 写分支是死代码。学生端要注入内容，请用 `student.assignment.toolbar.action`。

```tsx
ctx.ui.registerExtensionPoint('assessment.list.card', {
  id: 'ext-question-bank/bank-badge',
  label: '题库来源',
  component: () => import('./BankBadge'),
  // 组件收到: { assessment, viewer, lang, lessonId, classId }
});
```

`assessment.stats.card` 的 `stats` 结构：

```typescript
{
  attemptCount, submittedCount, gradedCount, needsManualReviewCount,
  averageScore: number | null, averagePercent: number | null, maxScore: number,
  items: Array<{
    itemId, type, stem, maxScore, answered, graded, correct,
    correctRate: number | null, avgScore: number | null, distribution: Record<string, number>
  }>
}
```

`distribution` 是「选项键 → 选择人数」映射，**没有选项文案**；选项 label 需要插件按 `type` 自行推断或让教师配置。

### 12.2 教师作业批改（`assignment.grade.*`）

三个槽位都挂在 `TeacherAssignmentGradePanel`，属于**教师侧**闭环；学生侧的 `assignment.file.preview`（§10.1）与 `assignment.submission.preview` 是另一条链路，别混用。

- **`assignment.grade.toolbar.action`** —— 批改面板顶部操作区、「刷新」按钮左侧。`{ lessonId, submissions, refresh, lang }`。`submissions` 是全量提交数组，适合批量 AI 初评、报告导出。**写完数据后要自己调 `refresh()`**，宿主不会替你重取。
- **`assignment.grade.item.addon`** —— 每个学生作答卡片内部、评分表单下方。`{ submission, studentId, lessonId, score, comment, isConfirmed, onScoreChange, onCommentChange, lang }`。适合代码测试报告、AI 评语推荐、查重诊断。**评分状态由宿主表单持有**：必须调 `onScoreChange(n)` / `onCommentChange(s)` 才生效，直接改 `submission` 无效。
- **`assignment.grade.rubric.addon`** —— 评分权重区（「学生互评: N%」之后）。`{ lessonId, defaultTeacherWeight, defaultPeerWeight, onTeacherWeightChange, lang }`。教师权重只能经 `onTeacherWeightChange` 写入；学生权重当前**没有**对应回调。

```tsx
ctx.ui.registerExtensionPoint('assignment.grade.item.addon', {
  id: 'ext-plagiarism/report',
  label: '查重报告',
  component: () => import('./PlagiarismReport'),
  // 组件收到: { submission, studentId, lessonId, score, comment, isConfirmed, onScoreChange, onCommentChange, lang }
});
```

### 12.3 备课端环节（`editor.segment.type_config` / `editor.timeline.node_badge`）

这两个槽位与已有的两个 `editor.*` 槽位容易混淆，按「在环节卡片的哪一层」区分：

| 槽位                         | 位置                                        | 用途                                        |
| ---------------------------- | ------------------------------------------- | ------------------------------------------- |
| `editor.timeline.node_badge` | 卡片标题右侧（`TimelineRail` 节点导轨复用） | **只读**微徽章：器材标识、AI 就绪、难度标签 |
| `editor.segment.type_config` | 环节类型专属配置区（门禁字段下方）          | 按 `segmentType` 渲染专属配置面板           |
| `editor.segment.action`      | 卡片工具栏                                  | 单次动作按钮（课标对齐、配时预测）          |
| `editor.timeline_segment`    | 卡片底部附加面板                            | 自定义表单 / 资源插入                       |

**`editor.segment.type_config` 不做类型过滤。** 宿主把 `segmentType` 传给你，但该槽位的**每个**扩展都会在**每个**环节上渲染一次——插件必须自己判类型返回 `null`，否则「编程实战预设」会出现在语文朗读环节里。

```tsx
// 注册
ctx.ui.registerExtensionPoint('editor.segment.type_config', {
  id: 'ext-code-sandbox/config',
  label: '代码沙盒配置',
  component: () => import('./SandboxConfig'),
});

// SandboxConfig.tsx
export default function SandboxConfig({ segmentType, segment, readOnly, onPatch }) {
  if (segmentType !== 'code_lab') return null; // 必须自己判类型
  return <input disabled={readOnly} onBlur={(e) => onPatch({ runtime: e.target.value })} />;
}
```

`editor.timeline.node_badge` 在 `SegmentEditorCard` 里传入的 `isActive` **恒为 `true`**、`isCompleted` **恒为 `false`**（该调用点没有真实进度语义）；只有在 `TimelineRail` 里这两个值才反映真实状态（并额外传 `idx`）。徽章若依赖「是否当前环节」，请在导轨场景使用，或改读 `segment` 自身字段。

### 12.4 学生端环节与学业对比

- **`student.segment.badge`** —— 学生端环节列表每行标题后。`{ segment, idx, isActive, isLocked, studentId, lessonId, lang }`。用于素养徽标、探究难度标识。**`isLocked` 为 `true` 时宿主已渲染锁图标**，别再重复「未解锁」语义。
- **`student.segment.gate_fallback`** —— 门禁未通过时，兜底提示文案下方。`{ lessonId, activeSegmentId, studentId, contentSegmentId, lang }`。用于补测卡片、补签到、解锁任务。这是「学生卡在门外」时唯一带完整门禁上下文的可交互位置——解锁类按钮放这里，不要放 `student.segment.badge`（那里没有门禁上下文，且可能在锁定态被渲染）。
- **`student.academic_year.metric_card`** —— 多学年对比页的指标卡区。`{ studentId, comparisonData, selectedYears, lang }`。`selectedYears` 是用户当前勾选的学年数组，卡片要跟随它重算，**不要缓存全量结果**。

### 12.5 课堂主工作区接管与课表导入

**`classroom.active_segment.main`** 是本页**最需要谨慎**的槽位：它渲染在活跃教学环节的**主工作区容器**内（`LiveClassroomView` 的 `classroom-active-segment-main-container`），与该容器的内置内容**并列**，不是替换。props `{ segment, lessonId, classId, lang, onRefresh }`。适用于「环节本身就是插件」的形态（探究仿真、代码竞技）。

> 不要把主工作区做成 `h-screen` 全屏——容器是受限高度的 `flex-grow` 区域。需要全屏就用 `ctx.ui.registerFullscreenRenderer`（§5）。

**`timetable.import.source`** —— 课表「AI 识别导入」子页，识别按钮下方的外部导入区。`{ lang, onImportEntries }`。插件解析完 Excel/CSV/第三方教务 API 后调 `onImportEntries(entries)`，宿主把结果灌进识别结果表格交给教师审核——**插件不要自己写库**，统一走审核后导入。

```ts
onImportEntries([{ class_name: '高一(3)班', subject: '信息技术', day_of_week: 2, period: 3, teacher_name: '张老师' }]);
```

**`timetable.entry.action`** —— 周历卡片与列表行右侧的悬浮操作区，**两处调用点都会渲染**。`{ schedule, lang, onEdit }`。用于「一键备课」「调课申请」等单节课操作。同一份 action 会出现两次，组件必须幂等——不要在挂载时触发副作用。

### 12.6 全局壳层与课程向导

**`header.async_task.item`** —— 全局顶栏的后台任务指示区（课表识别进度条右侧）。`{ lang, activeRole, teacherTab, setTeacherTab }`。宿主自身的任务状态在 `useAsyncTaskStore`（`src/store/asyncTaskStore.ts`），**不通过 props 注入**：插件展示自己的任务需自管状态；`setTeacherTab` 可用来跳转到自建的进度页。

**`course.wizard.quick_apply`** —— 建课向导「课堂脉络」步骤、流程时间卡编辑区下方。`{ lang, wizardCourseTitle, wizardCourseCategory, wizardCourseTimeline, setWizardCourseTimeline, addToast }`。插件提供「课堂框架模板」按钮，点击后把模板环节整体写入时间线。

环节对象形状（`WizardSegment`，`src/features/modals/CourseWizardModal.tsx`）：

```typescript
interface WizardSegment {
  id: string;
  title: string;
  type: string; // 对应环节类型
  duration: string; // 如 '10m'
  color: string; // Tailwind class 串，宿主原样用于卡片配色
  notes: string;
}
```

**`setWizardCourseTimeline` 是覆盖式赋值，不是追加。** 想追加要基于传入值自己拼：`setWizardCourseTimeline([...wizardCourseTimeline, ...template])`。`id` 必须唯一，重复会导致 React key 冲突。

### 12.7 命令面板与快捷插入（数据型槽位）

这两个槽位**不由插件提供 React 组件**：插件声明一条命令元数据，宿主渲染成命令项 / 斜杠菜单项。注册时仍要导出 `component: () => null` 占位，宿主只读 `slotProps`。

| 槽位                   | 消费端                                             | 触发方式         |
| ---------------------- | -------------------------------------------------- | ---------------- |
| `command_palette.item` | `src/features/command-palette/command-palette.tsx` | `Ctrl/Cmd + K`   |
| `quick_insert.item`    | `src/features/quick-insert/quick-insert-menu.tsx`  | 编辑器内输入 `/` |

`slotProps` 契约：

```typescript
{
  title?: string; // 缺省回落 ext.label，再回落 ext.id
  description?: string;
  category?: string; // 不在宿主枚举内时归入 'Plugin'
  keywords?: string[];
  commandType?: string; // 命中后 POST /api/plugins/execute-command
  payload?: Record<string, unknown>; // 与运行时 context 二选一，payload 优先
  shortcut?: string; // 仅 command_palette.item 读取
}
```

```tsx
ctx.ui.registerExtensionPoint('command_palette.item', {
  id: 'ext-grade-export/export',
  label: '导出成绩单',
  icon: 'download',
  component: () => null, // 数据型：组件位留空
  slotProps: {
    description: '导出当前班级全部作业成绩为 Excel',
    category: 'Management',
    keywords: ['导出', '成绩', 'export'],
    commandType: 'ext-grade-export.run',
    payload: { format: 'xlsx' },
    shortcut: 'Ctrl+Shift+E',
  },
});
```

执行链路：宿主 POST `/api/plugins/execute-command`，失败时**必定**弹 toast（v0.6.0 审计要求：插件命令失败不静默）。因此 `commandType` 必须在后端注册，否则点击无反应并报错。`shortcut` 只是**展示**——宿主不会真的注册全局快捷键。

manifest 声明式写法同样可用（`contributes` 已收录这两个键）：

```json
{
  "contributes": {
    "command_palette.item": [
      { "id": "export", "title": "导出成绩单", "commandType": "ext-grade-export.run", "category": "Management" }
    ],
    "quick_insert.item": [{ "id": "insert-rubric", "title": "插入评分量规", "commandType": "ext-rubric.insert" }]
  }
}
```

> **远程 / Worker 插件唯一可见的 UI 入口就是这两个槽位。** 它们不渲染插件自己的 UI，因此无法借它们绕过前端沙箱能力边界——宿主只按声明的 `commandType` 派发命令。

---

## 13. 统计口径

| 指标                                                           | 数值                                  |
| -------------------------------------------------------------- | ------------------------------------- |
| `ExtensionSlot` 联合类型成员                                   | **120**                               |
| 生产调用点（`src/**/*.tsx`，排除 `__tests__`）上的固定名槽位值 | **116**（`99` / `98` 为历史记录）     |
| 其中属于 `ExtensionSlot` 联合类型                              | **116**                               |
| 不在联合类型内但有渲染器的字符串槽位                           | **0**                                 |
| 已挂载的 `anchor:*` 锚点槽位                                   | **8**                                 |
| 无渲染器的 `ExtensionSlot` 成员（数据型 / 服务端消费）         | **4**（见 §12.7、§11.6）              |
| `ExtensionPointRenderer` 唯一槽位值总数（固定名 + 锚点）       | 随版本增长（含 8 个 `anchor:*` 锚点） |
| 在本页有使用说明的槽位（含 props 表 / 专项小节 / 代码示例）    | **128 / 128**                         |

> 复核命令：`python3 audit-tools/extract_slots.py --repo .`（槽位清单真值）与 `python3 audit-tools/slots_coverage.py --repo .`（文档覆盖分级）。两者均已接入 `bash audit-tools/run.sh`：**L0（文档中完全不存在）计为 drift 并阻断门禁**，L1/L2 仅作提示输出。
>
> 统计更新于 v0.6.0 审计整改与 AI 生态槽位消费批次（2026-10-11）：`ai.prompt.template` 新增渲染消费端（Agent 输入区模板选择器）；`ai.skill.provider` 为**服务端消费**槽位（AI Agent 工具注入，非渲染，不计入渲染调用点）。
> 2026-10-27 复核：补齐 20 个此前未进入本页清单的成员（`command_palette.item`、`quick_insert.item`、`ai.prompt.template`、`ai.skill.provider`、`course.wizard.quick_apply`、3 个 `assessment.*`、3 个 `assignment.grade.*`、`editor.segment.type_config`、`editor.timeline.node_badge`、`student.segment.badge`、`student.segment.gate_fallback`、`student.academic_year.metric_card`、`classroom.active_segment.main`、`timetable.import.source`、`timetable.entry.action`、`header.async_task.item`），并新增 §12 使用说明。清单此前只列 100 个，正文却写 115 —— 两处数字都已按代码真值校正。
> 2026-10-17 更新（Issue #86）：机房排座新增 `computer_lab.seating.toolbar` / `computer_lab.unassigned.item` / `computer_lab.seating.sidebar` 3 个槽位，并支持拖拽调座与点击/拖拽交换。
> 2026-10-26 复核（v0.7.4）：`assignment.file.preview` 于 v0.7.4 加入 `ExtensionSlot`，成员数由 119 增至 **120**。该槽位见 §10.1。
