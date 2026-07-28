# Changelog

All notable changes to **OpenLearn V2** (platform package `openlearn-next`) are documented here.

> Versioning note: the platform `openlearn-next` is versioned independently of
> `@openlearn/plugin-sdk` (currently **3.5.0**) and `@openlearn/plugin-test-kit`.
> Bumping the platform does not change the SDK / test-kit versions.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Refactor / Performance
- **Frontend monolith decomposition — Phase 1 (lesson_editor view)**: Extract the teacher `lesson_editor` tab view (the course timeline editor shell: palette, timeline rail, segment editor, lazy whiteboard, save-status badges, and the student-view preview trigger) from `src/App.tsx` into `src/features/teacher/LessonEditorView.tsx` behind a `LessonEditorViewProps` interface. All App-level state/setters/handlers are passed as props; the JSX is moved verbatim. Behavior is preserved and locked by `src/features/teacher/__tests__/LessonEditorView.test.tsx` (3 cases). `src/App.tsx` is reduced by ~194 lines. No new `tsc` errors beyond the type-debt baseline (116). This begins the incremental, characterization-test-guarded decomposition of `src/App.tsx` (~8.5k lines remaining) targeted for `0.3.0`.
- **Frontend monolith decomposition — Phase 2 (`classes` / School Management module)**: Decompose the entire `teacherTab === 'classes'` branch out of `src/App.tsx` into `src/features/teacher/classes/`. The module is split **by sub-feature into 9 components**, each with its own verbatim-move characterization test, then collapsed behind a single `ClassesView` wrapper: `CreateClassButton`, `ManualImportButton`, `ClassPasscodeController`, `ClassRowHeader`, `ClassTabs`, `ClassStudentsPanel`, `ClassAssignmentsPanel`, `ClassSchedulesCharts`, `ClassScheduleAttendance`, and `ClassesView` (the School Management header + batch-mode toolbar + export dropdown + `.map` body that forwards state to the 9 sub-components; the grades tab still delegates to the pre-existing `SemesterGradeManager`). `src/App.tsx` drops by ~1,925 lines (8,938 → 7,013). All 10 test files / 26 cases pass; `tsc` stays at the 116-error type-debt baseline. This completes the second feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 3 (`student` view)**: Decompose the entire `activeRole === 'student'` branch out of `src/App.tsx` into `src/features/student/`. Following the same verbatim-move + characterization-test pattern, the branch is split by sub-area into leaf components (`StudentDashboardHeader`, `StudentRollCallAlarms`, `StudentCourseProgressList`, `StudentQuickStats`, `StudentPerformanceCharts`, `StudentSchedulePanel`, `StudentAssignmentsPanel`, `StudentLessonHeader`, `StudentLessonContentPanel`, `StudentLessonInteractionPanel`, `StudentAssignmentHeader`, `StudentAssignmentQuestionPanel`, `StudentAssignmentWorkPanel`), collapsed behind three sub-wrappers (`StudentDashboardPanel`, `StudentLessonView`, `StudentAssignmentView`), and finally behind a single top-level `StudentView` wrapper that holds the outer container, the two guards (No-Student / Loading), and the `studentViewStatus` switch. `src/App.tsx` now renders a single `<StudentView .../>` for the student role; the `) : (` teacher branch join is preserved verbatim. All student-area test files pass (39 cases across 20 files); `tsc` stays at the 116-error type-debt baseline. This completes the third feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 4 (`teacher` branch wrapper)**: Collapse the entire `activeRole === 'teacher'` branch of `src/App.tsx` (the `<div className="flex-1 overflow-hidden flex bg-gray-50">` containing `NavigationSidebar`, the inner content div, the `PluginTabPanel` catch-all, and the full `teacherTab` ternary over `dashboard` / `lesson_editor` / `live_class` / `plugins` / `courses` / `classes` / `timetable` / `admin_directory` / `computer_labs` / `help`) into a single `src/features/teacher/TeacherView.tsx` behind a `TeacherViewProps` interface. `TeacherViewProps` is a flat composition of every child component's prop bag (shared props typed to the greatest-lower-bound across children that declare them), plus the few identifiers referenced only by App's inline expressions (`socketRef`, `setShowCoursewareHub`, `fetchStudents`, `fetchClassStudents`, `classStudentsMap`, `liveClassSelectedClassId`, `t`). The `live_class` inline expressions (the `students` computation, the `fetchStudents` arrow, `onPingStudent`, `onOpenCoursewareHub`) are moved verbatim so behavior is byte-for-byte preserved. `src/App.tsx` now renders a single `<TeacherView .../>` for the teacher role; the `{activeRole === 'student' ? (…) : (…)}` join is preserved verbatim. `TeacherView` ships with a characterization test (`src/features/teacher/__tests__/TeacherView.test.tsx`) covering the `teacherTab` switch. `tsc` stays at the 116-error type-debt baseline; the 8 failures in the broader suite (`packages/core/worker-rpc`, `packages/plugins/raffle-vote`, `packages/plugins/builtin`, `packages/core/di/ai-service`, `classroom-runtime/classroom-event-bus`, `ai-teacher-workspace`) are pre-existing environment/DI/API-key failures in untouched modules. This completes the fourth feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 5 (inline modals, part 1: CourseWizard)**: Begin extracting the cluster of large **inline modals** still rendered with raw `<div className="fixed inset-0 …">` blocks in `src/App.tsx`. The first, the Course Creation Wizard (`isCourseWizardOpen`), is moved verbatim (steps 1–4, header, footer, `motion.div`, the `react-markdown` live preview, the preset buttons, and the editable timeline grid) into `src/features/modals/CourseWizardModal.tsx` behind a `CourseWizardModalProps` interface. `wizardCourseTimeline` is typed as `WizardSegment[]` (matching App's `any[]` for the `.color/.title/.type/.duration` accesses), and `setWizardStep` / `setWizardCourseTimeline` use `Dispatch<SetStateAction<…>>` to accept both value and updater calls; `generateTemplateContent` is re-imported from `src/features/teacher/HelpView`. The `isCourseWizardOpen &&` guard moves inside the component so `App.tsx` renders `<CourseWizardModal .../>` unconditionally. `src/App.tsx` sheds ~535 lines of inline modal JSX. Locked by `src/features/modals/__tests__/CourseWizardModal.test.tsx` (3 cases: renders for `lang` zh/en, hidden when closed). `tsc` stays at the 116-error type-debt baseline. Remaining inline modals to extract the same way: `ImportLessons` (~307 lines) and 4–5 more blocks (4953, 5242, 5466, 5759, 5823…).

### Next-round backlog
- **Frontend monolith (`src/App.tsx`)** is the active decomposition target for `0.3.0` — extracted incrementally by feature area with characterization tests. Phases 1–5 are done: `lesson_editor`, `classes`, `student`, and the entire `teacher` branch are decomposed behind `LessonEditorView` / `ClassesView` / `StudentView` / `TeacherView`, and the first inline modal (`CourseWizard`) behind `CourseWizardModal`. Remaining inline regions: the top header / role-switch shell, `RightSidebar` (already a component — only its prop-forwarding call remains), and the other inline modals (`ImportLessons` + 4–5 more `<div className="fixed inset-0">` blocks); each can be decomposed the same way (verbatim move + characterization test, baseline held at 116 `tsc` errors).
- **Type/lint debt**: ~116 `tsc` + ~1471 `eslint` errors carried as backlog from the `tsc` root-cause fix; not blocking.

## [0.1.16] - 2026-07-28

### Fixes
- **npm Compatibility**: Replace `workspace:*` protocol with `^3.4.3` for `@openlearn/plugin-sdk` dependency to fix `npx openlearn-next` installation failure (`EUNSUPPORTEDPROTOCOL`).

## [0.2.0] - 2026-07-28

### Fixes
- **Hidden type errors surfaced & systematic roots fixed**: `tsc` was aborting early on an invalid `tsconfig` `exclude`, masking **389 real type errors**. Fixed: added `tsconfig` `exclude` for fixtures/templates; corrected 17 wrong relative-import depths (incl. a missing `student-workspace-registry`); added the missing `@testing-library/react` dev dependency; fixed two missing name imports. Made `PluginContext.resolve<T>` infer token types across the core↔SDK boundary (public phantom on `Token`). Tightened `@openlearn/plugin-sdk` to **3.5.0**: service tokens typed concretely (was `Token<unknown>`) and service interfaces accept sync-or-async (`void | Promise<void>`). Remaining ~116 genuine per-file type errors tracked as a type-debt backlog.

### Refactor / Performance
- **Server monolith decomposition — Phase 1 (realtime bridge)**: Extract the EventBus→Socket.IO forwarding block (`server.ts` lines 652–803: `assignment.graded` toast, `handleRollcallElement` rollcall persistence, and `whiteboard.*` / `spotlight.*` sync relays) into a standalone `server/realtime-bridge.ts` module behind `setupRealtimeBridge({ eventBus, io, db })`. Behavior preserved verbatim and locked by a new characterization test (`server/__tests__/realtime-bridge.test.ts`, 7 cases). Introduces a structural `BridgeDb` port and reuses the existing `EventBusPort`, keeping the server's `kernelContainer` as the composition root. No new `tsc` errors beyond the type-debt baseline.
- **Server monolith decomposition — Phase 2 (AI agent + shared cache)**: Extract the AI chat orchestration (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`, `executeAgentToolCall`, `buildOpenAIChatUrl`, `runGeminiAgentChat`, `runOpenAIAgentChat`) into `server/ai-agent.ts`, and the two shared module-level state Maps (`MF_REMOTE_CACHE`, `lessonActiveSegments`) into `server/shared-state.ts`. Both are consumed by `server/routes/*.ts` through `ServerContext`. Pure helpers (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`) are covered by `server/__tests__/ai-agent.test.ts`; network-dependent handlers are skipped with a documented reason.
- **Server monolith decomposition — Phase 2 (presence / socket handlers)**: Extract the Socket.IO connection lifecycle (`io.on('connection', …)` — `register-student`, `enter-lesson`, `leave-lesson`, `join-room`, `whiteboard-update`, `whiteboard-event`, `teacher-broadcast-segment`, `teacher-ping-student`, `disconnect`, and presence broadcasting) into `server/presence.ts` behind `setupPresence({ io, eventBus })`. The shared `lessonActiveSegments` singleton is reused from `server/shared-state.ts`. Behavior (incl. the `whiteboard-event` detail that emits to the raw `lessonId`, not `lesson-<id>`) is locked by `server/__tests__/presence.test.ts` (7 cases).
- **Server monolith decomposition — Phase 2 (startup DB migrations)**: Extract the boot-time DB seed/upgrade and SEC-AUTH-03 session cleanup from `startServer()` into `server/bootstrap-db.ts` behind `runStartupMigrations(db: MigrationDb)`. Covers old default-plugin upgrade (Quiz / Random Student Picker), `CREATE TABLE IF NOT EXISTS` for `student_rollcalls` / `site_settings` / `agent_conversations`, the idempotent `client_sessions.expires_at` column add, and the expired-session cleanup. Locked by `server/__tests__/bootstrap-db.test.ts` (7 cases).
- **Composition root shrinks**: `server.ts` drops from ~1000 to ~322 lines. It now acts purely as the composition root — wiring `kernelContainer`, `ServerBootstrapAdapter`, HTTP/Socket.IO, and delegating all domain behavior to the `server/*` modules above. Each extracted slice has a verbatim-move characterization test; `tsc` remains at the 116-error type-debt baseline.

## [0.1.15] - 2026-07-27

### Features
- **Remote Plugin Update Detection**: Replace hardcoded market data with dynamic version checking via `git ls-remote` (fallback to GitHub/Gitee Releases API) and semver comparison; add `updateSource` field to plugin manifest (`@openlearn/plugin-sdk@3.4.3`); add per-plugin "检查更新" button with server-first download and client-side fallback; support pre-release version badges.
- **Dashboard Quick Access**: Make the brand logo/name area clickable to return to the dashboard; add an explicit "系统总览" / "Dashboard" nav button in the top header bar with active-state highlighting.
- **Whiteboard Toolbar Docked**: Move the interactive whiteboard drawing toolbar from a centered floating overlay into the top white area as a docked, left-aligned bar with a bottom border separator.
- **Admin Panel Monitoring Consolidation**: Move "SQLite 数据库健康体检" and "分布式操作系统硬件状况" cards from the "学校教职及系统配置" tab into the "系统监控" tab (renamed from "SQLite 数据库监控"), consolidating all system health metrics under one monitoring view; expand directory tab's staff list to full width.
- **Plugin Center ZIP Install Relocated**: Move the ZIP drag-and-drop install area from the plugin store grid into the "发现" tab header bar, placed inline to the right of the "显示系统核心插件" toggle with matching compact styling and a teal/emerald color palette.

### Fixes
- **Agent Intro Crash**: Fix `Cannot read properties of undefined (reading 'agentIntro')` crash by adding a safe fallback (`?? translations['zh']`) when the language key is unrecognized; fix `toggleLanguage` to pass the current `lang` value directly instead of a function reference causing store corruption.
- **Repository URL**: Fix incorrect repository URL in package.json from `github.com/openlearn/openlearnv2` to `github.com/aymwoo/OpenLearn-Next-V2`.

## [0.1.14] - 2026-07-26

### Features
- **Nav & Header Cleanup**: Remove obsolete "系统总览" (Dashboard) from sidebar navigation and header; set default teacher homepage tab to `courses` (Course Library); simplify language switcher to a single compact `Globe` icon button.
- **SQLite Status Badge Refactoring**: Refactor database status indicator to a compact 32x32px icon badge with dynamic status colors (🟢 Green for normal connection, 🟠 Orange for latency/warning, 🔴 Red for error/disconnect) and interactive tooltips.
- **Contextual Role Switcher**: Remove global `Teacher Mode / Student Mode` toggle buttons from top header; embed contextual `[ 👨‍🏫 教师模式 | 🎓 学生模式 ]` segmented role switchers directly inside Lesson Editor (`lesson_editor`) toolbar and Live Classroom (`live_class`) control center.
- **Integrated Cloud Resource Sub-Category**: Integrate Cloud Course Resource (`CloudDrive`) into System Resource Library modal as a sub-category tab (`[ 📚 互动课件与系统资源库 | ☁️ 云端课程资源 (Cloud Drive) ]`), removing redundant header button.

## [0.1.13] - 2026-07-26

### Features
- **In-Place Plugin Update**: Add `plugin.update_zip` command and `updatePluginFromZip` API that preserve the plugin UUID, configuration and business data on upgrade (`42f8759`); add server endpoints `POST /api/plugins/:id/update-zip-raw` and `GET /api/plugins/by-manifest/:manifestId`, plus `x-install-mode: update` on install (`c10b123`); the Plugin Install Wizard gains update mode with SemVer compare, downgrade/in-use guards and a locked target plugin (`53a8658`).

### Fixes
- **Resilient Worker Activation Timeout**: Default activation timeout raised to 60s with a sliding `activate-progress` heartbeat; tunable via `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` / `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_PROGRESS_SLIDE_MS` (`c6a9730`).
- **Plugin SDK Sync**: Make facade re-exports type-only and sync the published `dist/index.d.ts` token exports; published `@openlearn/plugin-sdk@3.4.2` (`9d0d793`).

### Docs
- **Plugin-Dev Reference**: Add authoritative DI token & Service API dictionary, capabilities/permission matrix, UI extension-slot Props, database API & migration spec, host shared-deps whitelist, and the in-place update & distribution guide (`37b1474`, `4d9ef54`).

## [0.1.12] - 2026-07-26

### Features
- **Plugin Update Detection & One-Click Hot Update**: Add online market update feed (`/api/plugins/market`), automatic SemVer comparison (`⚡ 发现新版本`), Git repository links (GitHub/Gitee) on plugin cards, release notes preview modal (`📋 新特性`), and one-click atomic hot update with state preservation & rollback (`🚀 一键热更新`).
- **Plugin Card UI Refactoring**: Redesign plugin dashboard toggle button into a standard-sized, modern iOS/Tailwind Switch toggle (`w-7 h-3.5`).
- **Plugin Namespace Migration**: Migrate third-party research workflow plugin from core namespace `@openlearn/` to third-party author namespace `@aymwoo/plugin-research-workflow`.
- **Research Workflow Plugin v1.2.0**:
  - **Class Rosters & SQLite Integration**: Wire real platform SQLite tables (`classes`, `students`, `class_students`) for real class selection.
  - **Group Management & Drag-and-Drop**: Multi-strategy auto-grouping (by size/group count) and HTML5 drag-and-drop group member movement (`⋮⋮` handle on the far left, `设为组长` button on the far right).
  - **Role View Isolation & Material Restrictions**: Separate Teacher Control Console and Student Submission Board; configurable allowed file extensions (`.pdf`, `.docx`, `.zip`, `.mp4`, `.xlsx`) and file size limits.
  - **Light Theme Alignment**: Refactor plugin UI to OpenLearn Next Light Theme palette (`slate-50`, `#ffffff` cards, `#2563eb` accents).

### Fixes
- **Worker Timeout Fix**: Optimize plugin `activate(ctx)` function to be non-blocking (< 10ms) with async 500ms race timeout, completely resolving `[WorkerRuntime] Worker operation timed out after 10000ms` during plugin installation/activation.
- **Workflow State Machine Guards**: Fix same-phase click transition error (`无法直接从 DRAFT 切换至 DRAFT`) and support teacher manual phase override flag.

## [0.1.11] - 2026-07-25

### Features
- **Plugin system (P7-A2)**: complete the unified plugin runtime refactor — wire real
  capabilities into `PluginCapabilityGateway`, integrate plugin lifecycle via unified
  facades, surface unified plugin facades (`IPluginLifecycleManager`,
  `IPluginDistributionManager`, `IUnifiedExtensionRegistry`, …) into
  `PlatformServiceRegistry`, and expose them through `@openlearn/plugin-sdk`. (#e435bba, #475e9e1, #163b1fe, #6b8153e, #1b13eba)
- **User menu & profile**: collapse the top-right username / secure-logout area into a
  circular avatar button with a dropdown (Profile / Logout); profile modal supports
  editing the display name; password-change flow added (teacher + student). (#f818550, #86e7e25, #4fd9e91)
- **Class list summary**: class management list now shows per-class summary chips —
  student count, course count (schedules), assignment count — without expanding the row. (#4451d5b)
- **Dashboard Activity Center**: live in-progress status, pause/resume and
  enter-classroom controls, light theme. (#bfecccc, #e1d9ecb)
- **Class roster**: add list view mode and grid layout. (#05ea25e)
- **Navigation**: optimize platform navigation with grouped categories, badge support,
  and a registry adapter. (#2242613)
- **Routing**: reflect the active page in the browser address bar via hash routing. (#506f617)
- **Docs**: official documentation architecture upgrade to a 25-folder taxonomy; refactor
  the plugin-development AI Skill guide to the latest V2 architecture. (#7e62138, #cd31c3a)

### Fixes
- **Dashboard Activity Center**: resolve perpetual loading of the widget. (#cca16b9)
- **plugin-sdk build**: externalize npm dependencies in the SDK bundle so it no longer
  throws `Dynamic require of "path"` at runtime. (#b50392e)

### Chores / Docs
- Purge non-system plugin artifacts and clean up the plugin build manifest
  (remove quiz-pro and other purged plugin entries). (#1b71c21, #690c704, #1ff7f59)
- Bump `@openlearn/plugin-sdk` references to **3.4.1** and document the P7-A2 unified
  plugin services; publish `@openlearn/plugin-sdk@3.4.0`. (#5070506, #7d04c73)
- Add platform foundation audit report, navigation (PF-02) audit report, and a
  documentation quality review report. (#2e9b494, #c4ee1c8, #c272d6f)
- Purge obsolete historical sprint reports / RFC drafts and synchronize docs with the
  implementation. (#1b5662c, #543bd17)
- Add Plugin System Refactor Proposal (P7-A2). (#c53bd3d)

## [0.1.10] - 2025

Baseline release. System-wide version numbers harmonized to 0.1.10 and
`@openlearn/plugin-sdk` to 3.3.1. (#4d1069a)
