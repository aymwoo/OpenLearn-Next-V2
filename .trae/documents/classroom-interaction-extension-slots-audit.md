# 课堂互动扩展槽审计报告（学案 / 白板）

> 审计日期：2026-11-26
> 代码基线：`b42c86b`（审计时的 `origin/main`）；落地实现基于 `41dfa28`（!32 合并后）
> 审计范围：`ExtensionPointRenderer` 扩展点体系在「学案（xuean）/ 白板（whiteboard）」两种课堂交付模式下，教师侧与学生侧的接线、可见性、上下文与回退行为
> 不包含：`assessment.*` / `teacher.dashboard.*` / 后台管理类槽位（仅在涉及共性问题时引用）

> **实施状态（2026-11-27）**：P0 四项已落地——`rolesAllowed` 渲染期过滤、学案活动槽 fallback、学案学生主工作区接入 `student_main`、学案门禁兜底 `gate_fallback`。P1 已落地 3.5 / 3.6 / 3.7（`student_main` 补 `studentId`/`studentName`、活动主槽补 `progress`/`studentId`/`classId`、白板选中与右键槽补 `readOnly`/`userRole`）；3.8 / 3.9 未做。P2 仅修复 3.11（`adopt` 事件映射）；3.10 / 3.12 / 3.13 未做。

---

## 1. 结论摘要

### 1.1 规模

| 指标                          | 数值    |
| ----------------------------- | ------- |
| 固定扩展槽（`ExtensionSlot`） | **161** |
| 锚点槽（`AnchorSlot`）        | **8**   |
| 其中 `classroom.*`            | 47      |
| 其中 `student.*`              | 21      |
| 其中 `whiteboard.*`           | 10      |
| 其中 `xuean.*`                | 10      |
| 数据型/服务端槽（无渲染器）   | 7       |

`src/plugin-host/types.ts`、`docs/agent/contracts/slots.json`、`docs/reference/plugin-ui-extension-slots.md` 三者计数已对齐（!27 已修正此前的 141/149 漂移）。

### 1.2 总体判断

- **白板模式**：槽位覆盖最完整，画布、工具栏、选中态、右键菜单、页面条、属性面板、自动保存均有挂载点。
- **学案模式**：活动级槽位（编辑器/学生卡/卡片动作/徽标/底部/附加面板/进度摘要/首页块）已成型，但**学生端环节主工作区仍被硬编码绕过**，且学生端缺少常驻工具位与门禁兜底槽。
- **共性**：`rolesAllowed` 仅有类型声明、运行时不消费；学案活动槽在无匹配扩展时忽略 `fallback`。

### 1.3 模式 × 角色能力矩阵

| 能力                                      | 白板-教师        | 白板-学生       | 学案-教师                 | 学案-学生        |
| ----------------------------------------- | ---------------- | --------------- | ------------------------- | ---------------- |
| 环节主工作区可扩展                        | ✅               | ✅              | ✅                        | ❌ 硬编码绕过    |
| 插件工具位（`classroom.tool` 等）         | ✅               | ⚠️ 未做角色过滤 | ⚠️ 仅经“演示白板”间接可用 | ❌               |
| 画布元素渲染扩展（`whiteboard.renderer`） | ✅               | ✅              | ⚠️ 仅“演示白板”标签       | ❌               |
| 活动级渲染扩展（`xuean.activity.*`）      | —                | —               | ✅                        | ✅（上下文不全） |
| 门禁兜底可扩展                            | —                | ✅              | —                         | ❌               |
| 大纲/备课面可扩展                         | ⚠️ 仅第三方 pack | —               | ⚠️ 仅第三方 pack          | —                |

---

## 2. 实现现状

### 2.1 通用课堂壳（两种模式共用，教师侧）

| 槽位                                 | 调用点                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `classroom.active_segment.main`      | [LiveClassroomMiddleWorkspace.tsx L338](../../src/features/classroom/LiveClassroomMiddleWorkspace.tsx#L338)                         |
| `classroom.alert.banner`             | [ClassroomInteractiveCockpit.tsx L535](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L535)                           |
| `classroom.quick_activity`           | [ClassroomInteractiveCockpit.tsx L702](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L702)                           |
| `classroom.cockpit.drawer.item`      | [ClassroomInteractiveCockpit.tsx L710](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L710)                           |
| `classroom.topbar.action`            | [ClassroomInteractiveCockpit.tsx L720](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L720)                           |
| `classroom.topbar.pill`              | [ClassroomInteractiveCockpit.tsx L728](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L728)                           |
| `classroom.header.action`            | [ClassroomInteractiveCockpit.tsx L741](../../src/features/classroom/ClassroomInteractiveCockpit.tsx#L741)                           |
| `classroom.toolbar.quick_action`     | [ClassroomToolbarQuickActions.tsx L153](../../src/features/classroom/ClassroomToolbarQuickActions.tsx#L153)                         |
| `classroom.outline`                  | [ClassroomTimelineSidebar.tsx L305](../../src/features/classroom/ClassroomTimelineSidebar.tsx#L305)                                 |
| `classroom.agenda.action`            | [ClassroomTimelineSidebar.tsx L423](../../src/features/classroom/ClassroomTimelineSidebar.tsx#L423)                                 |
| `classroom.countdown.action`         | [ClassroomCountdownWidget.tsx L1214](../../src/features/classroom/ClassroomCountdownWidget.tsx#L1214)                               |
| `classroom.countdown.widget`         | [ClassroomCountdownWidget.tsx L1227](../../src/features/classroom/ClassroomCountdownWidget.tsx#L1227)                               |
| `classroom.barometer.metric`         | [PacingDashboardModal.tsx L216](../../src/features/classroom/PacingDashboardModal.tsx#L216)                                         |
| `classroom.pacing.dashboard`         | [MasteryPredictionModal.tsx L260](../../src/features/classroom/pacing/MasteryPredictionModal.tsx#L260)                              |
| `classroom.diagnostic.feed`          | [DiagnosticCenterModal.tsx L137](../../src/features/classroom/diagnostics/DiagnosticCenterModal.tsx#L137)                           |
| `classroom.audit.event`              | [DiagnosticCenterModal.tsx L214](../../src/features/classroom/diagnostics/DiagnosticCenterModal.tsx#L214)                           |
| `classroom.monitor.header_action`    | [LiveStudentMonitorPanel.tsx L187](../../src/features/classroom/student-monitor/LiveStudentMonitorPanel.tsx#L187)                   |
| `classroom.submissions.toolbar`      | [LiveSubmissionsPanel.tsx L174](../../src/features/classroom/LiveSubmissionsPanel.tsx#L174)                                         |
| `classroom.top_performers.action`    | [TopPerformersWidget.tsx L480](../../src/features/teacher/TopPerformersWidget.tsx#L480)                                             |
| `classroom.leaderboard.action`       | [ClassroomLeaderboardModal.tsx L575](../../src/features/classroom/ClassroomLeaderboardModal.tsx#L575)                               |
| `classroom.attribution.award`        | [ClassroomAttributionModal.tsx L435](../../src/features/classroom/ClassroomAttributionModal.tsx#L435)                               |
| `classroom.attribution.action`       | [ClassroomAttributionModal.tsx L488](../../src/features/classroom/ClassroomAttributionModal.tsx#L488)                               |
| `classroom.showcase_diff.action`     | [ShowcaseDiffModal.tsx L349](../../src/features/classroom/showcase-diff/ShowcaseDiffModal.tsx#L349)                                 |
| `classroom.macro_runner.action`      | [ClassroomMacroRunnerModal.tsx L207](../../src/features/classroom/ecosystem/macro-engine/ClassroomMacroRunnerModal.tsx#L207)        |
| `classroom.hardware_bridge.addon`    | [HardwareBridgeSettingsModal.tsx L184](../../src/features/classroom/ecosystem/hardware-bridge/HardwareBridgeSettingsModal.tsx#L184) |
| `classroom.sessions.action`          | [ClassroomSessionManager.tsx L308](../../src/features/classroom/ClassroomSessionManager.tsx#L308)                                   |
| `classroom.notification.tabs`        | [ParentNotificationModal.tsx L242](../../src/features/classroom/notifications/ParentNotificationModal.tsx#L242)                     |
| `classroom.collab.canvas`            | [GroupCollabWhiteboardModal.tsx L960](../../src/features/classroom/collab-whiteboard/GroupCollabWhiteboardModal.tsx#L960)           |
| `classroom.stage.display.ticker`     | [StageDisplayPanel.tsx L182](../../src/features/classroom/stage-display/StageDisplayPanel.tsx#L182)                                 |
| `classroom.seating.toolbar`          | [ComputerLabSeatingMap.tsx L185](../../src/features/classroom/ComputerLabSeatingMap.tsx#L185)                                       |
| `classroom.seating.legend`           | [ComputerLabSeatingMap.tsx L259](../../src/features/classroom/ComputerLabSeatingMap.tsx#L259)                                       |
| `classroom.seating.summary`          | [ComputerLabSeatingMap.tsx L291](../../src/features/classroom/ComputerLabSeatingMap.tsx#L291)                                       |
| `classroom.seating.seat_badge`       | [ComputerLabSeatingMap.tsx L350](../../src/features/classroom/ComputerLabSeatingMap.tsx#L350)                                       |
| `classroom.seating.seat_actions`     | [ComputerLabSeatingMap.tsx L356](../../src/features/classroom/ComputerLabSeatingMap.tsx#L356)                                       |
| `classroom.preclass.passcode_action` | [PreClassReadyView.tsx L769](../../src/features/classroom/PreClassReadyView.tsx#L769)                                               |
| `classroom.preclass.passcode_addon`  | [PreClassReadyView.tsx L784](../../src/features/classroom/PreClassReadyView.tsx#L784)                                               |
| `classroom.portal.telemetry`         | [ClassroomEntryPortal.tsx L276](../../src/features/classroom/ClassroomEntryPortal.tsx#L276)                                         |
| `classroom.portal.course_badge`      | [ClassroomEntryPortal.tsx L434](../../src/features/classroom/ClassroomEntryPortal.tsx#L434)                                         |
| `classroom.portal.teaching_mode`     | [ClassroomEntryPortal.tsx L601](../../src/features/classroom/ClassroomEntryPortal.tsx#L601)                                         |
| `classroom.portal.launch_action`     | [ClassroomEntryPortal.tsx L840](../../src/features/classroom/ClassroomEntryPortal.tsx#L840)                                         |
| `classroom.portal.insight`           | [ClassroomEntryPortal.tsx L993](../../src/features/classroom/ClassroomEntryPortal.tsx#L993)                                         |
| `classroom.portal.preflight`         | [ClassroomEntryPortal.tsx L1087](../../src/features/classroom/ClassroomEntryPortal.tsx#L1087)                                       |
| `classroom.post_class.exporter`      | [PostClassWrapupView.tsx L269](../../src/features/classroom/PostClassWrapupView.tsx#L269)                                           |
| `classroom.post_class.widget`        | [PostClassWrapupView.tsx L289](../../src/features/classroom/PostClassWrapupView.tsx#L289)                                           |

锚点槽：`anchor:classroom-attribution:awards`、`anchor:whiteboard-toolbar:{ai-tutor,code-sandbox,courseware,grid,math-graph,presentation,rollcall}`，共 8 个。

### 2.2 白板模式

| 槽位                            | 调用点                                                                                                                | 角色                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `classroom.tool`                | [WhiteboardToolbar.tsx L493](../../src/features/whiteboard/components/WhiteboardToolbar.tsx#L493)                     | 双端（未做角色过滤） |
| `whiteboard.renderer`           | [InteractiveWhiteboard.tsx L3286](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3286)                      | 双端                 |
| `whiteboard.selection.toolbar`  | [InteractiveWhiteboard.tsx L3857](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3857)                      | 双端                 |
| `whiteboard.context_menu`       | [InteractiveWhiteboard.tsx L3990](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3990)                      | 双端                 |
| `whiteboard.canvas.widget`      | [InteractiveWhiteboard.tsx L4014](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L4014)                      | 双端                 |
| `whiteboard.dock.plugin`        | [InteractiveWhiteboard.tsx L4025](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L4025)                      | 双端                 |
| `whiteboard.pagebar.action`     | [WhiteboardPageBar.tsx L250](../../src/features/whiteboard/components/WhiteboardPageBar.tsx#L250)                     | 双端                 |
| `whiteboard.page_drawer.action` | [WhiteboardPageBar.tsx L282](../../src/features/whiteboard/components/WhiteboardPageBar.tsx#L282)                     | 双端                 |
| `whiteboard.properties.addon`   | [WhiteboardPropertiesSidebar.tsx L699](../../src/features/whiteboard/components/WhiteboardPropertiesSidebar.tsx#L699) | 双端                 |
| `whiteboard.autosave.status`    | [LessonEditorView.tsx L309](../../src/features/teacher/LessonEditorView.tsx#L309)                                     | 教师                 |
| `whiteboard.autosave.action`    | [LessonEditorView.tsx L318](../../src/features/teacher/LessonEditorView.tsx#L318)                                     | 教师                 |

学生侧课堂浮层（App 级挂载，两种模式都生效）：

| 槽位                          | 调用点                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `student.classroom.overlay`   | [StudentInteractiveOverlay.tsx L588](../../src/features/student/StudentInteractiveOverlay.tsx#L588) |
| `student.fullscreen`          | [StudentInteractiveOverlay.tsx L595](../../src/features/student/StudentInteractiveOverlay.tsx#L595) |
| `student.classroom.countdown` | [StudentCountdownBanner.tsx L350](../../src/features/student/StudentCountdownBanner.tsx#L350)       |

学生侧白板课堂专属：

| 槽位                            | 调用点                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `student.lesson.tool`           | [StudentLessonInteractionPanel.tsx L207](../../src/features/student/StudentLessonInteractionPanel.tsx#L207)          |
| `student.lesson.notes_addon`    | [WhiteboardStudentClassroom.tsx L100](../../src/features/student/mode-classroom/WhiteboardStudentClassroom.tsx#L100) |
| `student.lesson.toolbox`        | [WhiteboardStudentClassroom.tsx L109](../../src/features/student/mode-classroom/WhiteboardStudentClassroom.tsx#L109) |
| `student.segment.badge`         | [StudentLessonContentPanel.tsx L129](../../src/features/student/StudentLessonContentPanel.tsx#L129)                  |
| `student.segment.gate_fallback` | [StudentLessonInteractionPanel.tsx L250](../../src/features/student/StudentLessonInteractionPanel.tsx#L250)          |

### 2.3 学案模式

教师侧：

| 槽位                                                                            | 调用点                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `classroom.active_segment.main` → `XueanTeacherModeWorkspace` → `ProgressPanel` | [XueanModeWorkspace.tsx L63-L77](../../src/features/classroom/mode-pack/XueanModeWorkspace.tsx#L63-L77) |
| `xuean.activity.type`（服务端类型目录）                                         | [xuean-activity-types.ts L92](../../server/services/xuean-activity-types.ts#L92)                        |
| `xuean.editor.toolbar`                                                          | [XueanActivitiesPanel.tsx L175](../../src/features/teacher/xuean/XueanActivitiesPanel.tsx#L175)         |
| `xuean.activity.card.badge`                                                     | [XueanActivitiesPanel.tsx L365](../../src/features/teacher/xuean/XueanActivitiesPanel.tsx#L365)         |
| `xuean.activity.card.action`                                                    | [XueanActivitiesPanel.tsx L382](../../src/features/teacher/xuean/XueanActivitiesPanel.tsx#L382)         |
| `xuean.activity.editor`                                                         | [XueanActivitiesPanel.tsx L668](../../src/features/teacher/xuean/XueanActivitiesPanel.tsx#L668)         |
| `xuean.activity.editor.footer`                                                  | [XueanActivitiesPanel.tsx L871](../../src/features/teacher/xuean/XueanActivitiesPanel.tsx#L871)         |

学生侧：

| 槽位                                    | 调用点                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xuean.progress.summary`                | [StudentXueanView.tsx L193](../../src/features/student/xuean/StudentXueanView.tsx#L193)                                                                     |
| `xuean.home.block`                      | [StudentXueanView.tsx L253](../../src/features/student/xuean/StudentXueanView.tsx#L253)                                                                     |
| `xuean.activity.student`                | [StudentXueanView.tsx L533](../../src/features/student/xuean/StudentXueanView.tsx#L533)                                                                     |
| `xuean.activity.student.addon`          | [StudentXueanView.tsx L539](../../src/features/student/xuean/StudentXueanView.tsx#L539)、[L661](../../src/features/student/xuean/StudentXueanView.tsx#L661) |
| `classroom.active_segment.student_main` | 已注册（[registerXueanModePack.ts L61-L68](../../src/features/classroom/mode-pack/registerXueanModePack.ts#L61-L68)），**但学案壳未消费**                   |

### 2.4 第三方 Mode Pack 专用

| 槽位                | 调用点                                                                                              | 说明                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `classroom.prep`    | [ModePackPrepShell.tsx L199](../../src/features/classroom/mode-pack/ModePackPrepShell.tsx#L199)     | 内置白板/学案走硬编码编辑器，不经过该槽                  |
| `classroom.outline` | [ClassroomTimelineSidebar.tsx L305](../../src/features/classroom/ClassroomTimelineSidebar.tsx#L305) | 内置白板显示页面列表、内置学案显示占位文案，均不经过该槽 |

---

## 3. 优化点

### P0 — 契约与对称性缺陷

#### 3.1 `rolesAllowed` 是死字段

- **证据**：`src/plugin-host/types.ts` L337 声明 `rolesAllowed?: ('admin' | 'teacher' | 'student')[]`，`src/plugin-host` 内无任何消费点（`plugin-host.ts` / `extension-point-renderer.tsx` / `plugin-host-store.ts` 均未读取）。
- **影响**：文档承诺“不匹配角色的用户看不到该扩展点”不成立。`classroom.tool`、7 个 toolbar 锚点、`whiteboard.*` 在学生白板（未锁定态）也会渲染，教师专属插件会漏到学生端；同时无法阻止学生插件出现在教师工作区。
- **建议**：在渲染器统一做**渲染期**过滤（角色可能随学生/教师视图切换，不能在注册期固化）：读取 `uiStore.activeRole`，`admin` 映射为 `teacher`，在 `getExtensions` 之后、锚点布局之前剔除；同步修正文档措辞。

#### 3.2 学案活动槽忽略 `fallback`

- **证据**：[extension-point-renderer.tsx L1220](../../src/plugin-host/extension-point-renderer.tsx#L1220) `if (!activeExt) return null;`，而调用点 [StudentXueanView.tsx L533-L537](../../src/features/student/xuean/StudentXueanView.tsx#L533-L537) 明确传入了“插件未加载，暂时无法显示此活动”的 `fallback`。
- **影响**：插件被停用/加载失败时，学生看到空白区域，无任何提示；教师编辑弹窗同理。
- **建议**：改为 `return fallback ?? null`。同类分支（L693/L742/L796/L844/L897/L991）应一并核对是否也需要 fallback。

#### 3.3 学案学生端环节主工作区被硬编码绕过

- **证据**：[StudentLessonView.tsx L348-L354](../../src/features/student/StudentLessonView.tsx#L348-L354) 在 `classroomMode === 'xuean'` 时直接渲染 `XueanStudentClassroom`；后者在 [XueanStudentClassroom.tsx L47-L53](../../src/features/student/mode-classroom/XueanStudentClassroom.tsx#L47-L53) 硬编码 `XueanStudentModeWorkspace`。同文件 L297-L316 已算出 `workspace`（`classroom.active_segment.student_main`）与 `primaryStudentWorkspace`，但学案分支完全未使用。
- **影响**：任何 `targetType: 'xuean'` 的第三方学生工作区注册都不会生效；`primary` 自动切换语义在学案课失效；与白板模式行为不对称。
- **建议**：将 `workspace` 作为 `primarySurface` 传入 `XueanStudentClassroom`，有贡献时渲染贡献，否则回落 `XueanStudentModeWorkspace`；保留 `blockSegmentContent` 门禁优先级。

#### 3.4 学案学生端缺门禁兜底槽

- **证据**：[XueanStudentClassroom.tsx L39-L45](../../src/features/student/mode-classroom/XueanStudentClassroom.tsx#L39-L45) 未解锁时只显示一段黄色文案；`student.segment.gate_fallback` 只在白板壳 [StudentLessonInteractionPanel.tsx L250](../../src/features/student/StudentLessonInteractionPanel.tsx#L250) 渲染。
- **影响**：学案学生被前置门禁拦住时，插件无法提供“补测 / 补签到 / 解锁任务”等兜底交互。
- **建议**：在学案壳的未解锁分支渲染 `student.segment.gate_fallback`，props 与白板壳保持一致（`segment/lessonId/classId/access`）。

### P1 — 上下文与覆盖度

#### 3.5 `classroom.active_segment.student_main` 缺学生身份

- **证据**：[StudentLessonView.tsx L304-L313](../../src/features/student/StudentLessonView.tsx#L304-L313) 与 [types.ts L1369-L1376](../../src/plugin-host/types.ts#L1369-L1376) 仅含 `segment/lessonId/classId/lang/flow`。
- **影响**：第三方学生工作区无法获知“当前是谁”，只能绕过槽位去全局 store 取值，存在取错/伪造风险。
- **建议**：补 `studentId`、`studentName`（来源与 `student.fullscreen` 一致）。

#### 3.6 `xuean.activity.student` 主渲染槽缺上下文

- **证据**：[StudentXueanView.tsx L533-L536](../../src/features/student/xuean/StudentXueanView.tsx#L533-L536) 只传 `activity/activityType/lessonId`；`progress` 仅在 [L539](../../src/features/student/xuean/StudentXueanView.tsx#L539) 的 `.student.addon` 传入。渲染器 [L1228](../../src/plugin-host/extension-point-renderer.tsx#L1228) 的 `progress` 因此恒为 `null`。
- **影响**：插件活动主视图无法展示“已完成/得分/尝试次数”，也无法按班级/学生做个性化；学生端只能重复请求接口。
- **建议**：主槽补 `progress`、`studentId`、`classId`；如需进度写回，提供宿主白名单回调（如 `onProgressReported`），不要让插件直写库。

#### 3.7 白板选中/右键槽缺角色与只读上下文

- **证据**：[InteractiveWhiteboard.tsx L3857-L3867](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3857-L3867)（`selection.toolbar`）与 [L3990-L4002](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3990-L4002)（`context_menu`）的 `slotProps` 未包含 `userRole/readOnly`。
- **影响**：插件无法判断当前是教师还是学生、画布是否只读，容易在只读场景渲染“删除/改写”等写操作。
- **建议**：两个槽统一补 `userRole`、`readOnly`；与 `whiteboard.renderer` 的 props 命名保持一致。

#### 3.8 学案学生端无常驻工具位

- **证据**：`student.lesson.tool`（[StudentLessonInteractionPanel.tsx L207](../../src/features/student/StudentLessonInteractionPanel.tsx#L207)）、`notes_addon`、`toolbox`、`segment.badge` 均只在白板学生壳。学案壳只有 `xuean.activity.student.addon`（每活动一份）。
- **影响**：插件无法为学案学生提供跨活动的常驻能力（如笔记本、计算器、求助按钮）。
- **建议**：在 `XueanStudentClassroom` 头部/工具区复用 `student.lesson.tool`，避免新造槽位、保持契约收敛。

#### 3.9 教师课中无“活动实时视图”槽

- **证据**：[ProgressPanel.tsx](../../src/features/teacher/xuean/ProgressPanel.tsx) 内无任何 `ExtensionPointRenderer`（grep 零命中）；学案教师环节工作区固定为 `ProgressPanel`。
- **影响**：教师课堂内只能看进度/批阅，无法看讨论内容、调查结果、活动实时状态；插件也无处挂载。
- **建议**：新增 `xuean.activity.teacher`（按 `activityType` 分发，props 复用 `.student` 的白名单上下文），或在 `ProgressPanel` 行级开槽。

### P2 — 收敛与性能

#### 3.10 内置模式不消费 `classroom.outline` / `classroom.prep`

- **证据**：[ClassroomTimelineSidebar.tsx L282-L316](../../src/features/classroom/ClassroomTimelineSidebar.tsx#L282-L316) 仅第三方 pack 走槽位；学案大纲在 [L319-L334](../../src/features/classroom/ClassroomTimelineSidebar.tsx#L319-L334) 只显示占位文案。`classroom.prep` 同理仅第三方 pack。
- **影响**：插件无法在内置白板/学案的大纲与备课面插入条目。
- **建议**：或在文档中明确“仅第三方 pack”，或把内置列表项做成可扩展（至少行级 action/badge）。

#### 3.11 白板事件槽映射漂移

- **证据**：[useClassroomSocket.ts L772-L779](../../src/hooks/useClassroomSocket.ts#L772-L779) 将 `promote` 映射为 `courseware.finished`；服务端只发 `log | submit | adopt`（[courseware-service.ts L88](../../server/services/courseware-service.ts#L88)）。
- **影响**：`courseware.finished` 永不触发；`adopt` 被兜底成 `event_logged`，白板事件槽的“完成/采纳”语义失真。
- **建议**：前端改认 `adopt`，删除 `promote` 分支，并补契约测试。

#### 3.12 只读态仍逐图元挂载插件 iframe

- **证据**：[InteractiveWhiteboard.tsx L3283](../../src/features/whiteboard/InteractiveWhiteboard.tsx#L3283) 在 `readOnly` 时仅设置 `pointerEvents: none`，`whiteboard.renderer` 的实例仍逐图元创建。
- **影响**：大班白板 + 多插件时性能与攻击面开销偏高。
- **建议**：只读时跳过插件渲染器挂载，或按视口可见性懒挂载。

#### 3.13 教师学案默认落在“演示白板”

- **证据**：[LiveClassroomView.tsx L352](../../src/components/LiveClassroomView.tsx#L352) `middleTab` 默认 `'whiteboard'`。
- **影响**：学案课进入后需教师手动切到“环节工作区”才能看到 `ProgressPanel`/学案工作区。
- **建议**：按 `delivery_mode === 'xuean'` 默认 `segment_main`（需确认产品预期）。

---

## 4. 建议落地路线

| 批次    | 内容                                                               | 主要改动文件                                                                                                                                                         | 测试点                                                                                              |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A（P0） | 3.1 角色过滤、3.2 fallback、3.3 学案主工作区接槽、3.4 学案门禁兜底 | `src/plugin-host/extension-point-renderer.tsx`、`src/features/student/StudentLessonView.tsx`、`src/features/student/mode-classroom/XueanStudentClassroom.tsx`        | 角色过滤矩阵；学案课第三方 `student_main` 渲染；未解锁时 `gate_fallback` 出现；空贡献 fallback 文案 |
| B（P1） | 3.5–3.9 上下文补齐与学案常驻工具/教师实时视图                      | `src/plugin-host/types.ts`、`StudentLessonView.tsx`、`StudentXueanView.tsx`、`InteractiveWhiteboard.tsx`、`XueanStudentClassroom.tsx`、新增 `xuean.activity.teacher` | slotProps 快照测试；学生身份注入；只读态写按钮不出现；教师活动视图按 `activityType` 分发            |
| C（P2） | 3.10–3.13 内置大纲/备课、事件映射、只读渲染、默认 tab              | `ClassroomTimelineSidebar.tsx`、`ModePackPrepShell.tsx`、`useClassroomSocket.ts`、`InteractiveWhiteboard.tsx`、`LiveClassroomView.tsx`                               | 事件契约测试；只读渲染不挂载；学案默认 tab                                                          |

**兼容性要求**：所有新增 slotProps 均为可选字段，不破坏现有插件；新增槽位需同步 `slots.json`、`docs/reference/plugin-ui-extension-slots.md` 与漂移审计（`audit-tools` 的 `drift_count` 保持 0）。

---

## 5. 附录

### 5.1 审计方法

- 契约与实现比对：`docs/agent/contracts/slots.json` vs `src/plugin-host/types.ts` 的 `ExtensionSlot` 联合类型（161 vs 161，锚点 8）。
- 渲染点定位：全仓检索 `slot="<domain>.*"` 字面量，逐个确认调用组件与角色。
- 行为核实：阅读 `ExtensionPointRenderer` 的分发分支、`plugin-host` 注册逻辑、`rolesAllowed` 消费情况。
- 模式路由：`resolveWorkspace` / `resolveStudentClassroomMode` / `resolveLessonModePackDeliveryMode` / `getLessonModePackIds`。

### 5.2 已确认对齐项（无需处理）

- `xuean.activity.*` 已能收到 `activityType/activity/lessonId/onSaved/progress/lang`（[renderer L1223-L1232](../../src/plugin-host/extension-point-renderer.tsx#L1223-L1232)）。
- 学案新增 7 个槽位已全部有渲染点，`slots.json` 与文档计数一致。
- 8 个锚点均有布局消费，无孤锚点。

### 5.3 不在本报告范围

- `assessment.*` / `teacher.dashboard.*` / 后台管理类槽位。
- 学生作品集、作业、画像等非课堂运行时槽位（除被课堂壳复用者外）。
