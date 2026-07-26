# Changelog

All notable changes to **OpenLearn V2** (platform package `openlearn-next`) are documented here.

> Versioning note: the platform `openlearn-next` is versioned independently of
> `@openlearn/plugin-sdk` (currently **3.4.3**) and `@openlearn/plugin-test-kit`.
> Bumping the platform does not change the SDK / test-kit versions.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Features
- **Remote Plugin Update Detection**: Replace hardcoded market data with dynamic version checking via `git ls-remote` (fallback to GitHub/Gitee Releases API) and semver comparison; add `updateSource` field to plugin manifest (`@openlearn/plugin-sdk@3.4.3`); add per-plugin "检查更新" button with server-first download and client-side fallback; support pre-release version badges.
- **Dashboard Quick Access**: Make the brand logo/name area clickable to return to the dashboard; add an explicit "系统总览" / "Dashboard" nav button in the top header bar with active-state highlighting.
- **Whiteboard Toolbar Docked**: Move the interactive whiteboard drawing toolbar from a centered floating overlay into the top white area as a docked, left-aligned bar with a bottom border separator.
- **Admin Panel Monitoring Consolidation**: Move "SQLite 数据库健康体检" and "分布式操作系统硬件状况" cards from the "学校教职及系统配置" tab into the "系统监控" tab (renamed from "SQLite 数据库监控"), consolidating all system health metrics under one monitoring view; expand directory tab's staff list to full width.
- **Plugin Center ZIP Install Relocated**: Move the ZIP drag-and-drop install area from the plugin store grid into the "发现" tab header bar, placed inline to the right of the "显示系统核心插件" toggle with matching compact styling and a teal/emerald color palette.

### Fixes
- **Agent Intro Crash**: Fix `Cannot read properties of undefined (reading 'agentIntro')` crash by adding a safe fallback (`?? translations['zh']`) when the language key is unrecognized; fix `toggleLanguage` to pass the current `lang` value directly instead of a function reference causing store corruption.

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
