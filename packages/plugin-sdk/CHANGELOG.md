# Changelog

All notable changes to **@openlearn/plugin-sdk** are documented here.

> This package is versioned independently from the platform `openlearn-next` host.
> Bumping the SDK does not change the platform version.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Features & Types

- **课中授课工作流控制中心与画布小组件静态清单声明契约 (`CanvasWidgetConfig`, `BarometerMetricConfig`)**:
  - 在 `@openlearn/plugin-sdk` 导出 `CanvasWidgetConfig` 与 `BarometerMetricConfig` 类型定义，供第三方互动教学插件在 `package.json` 的 `openlearn.contributes` 中静态声明；
  - `CanvasWidgetConfig`: 支持声明自定义教学画布悬浮组件（如随堂代码检核任务卡、AI 互助小助手、仿真图表看板），属性包含 `id`, `name`, `component`, `position`, `width`, `height`, `draggable`；
  - `BarometerMetricConfig`: 支持声明课堂节奏气压计动态指标项（如 AI 疑惑度分析、课堂提问率、肢体专注度指标），属性包含 `id`, `label`, `icon`, `commandType`, `defaultValue`；
  - 对应运行时 Extension Slots：`classroom.header.action`、`classroom.quick_activity`、`classroom.barometer.metric`、`classroom.agenda.action`、`whiteboard.dock.plugin`、`whiteboard.canvas.widget`、`classroom.audit.event`。

- **学生成长能力五维雷达与全景档案静态清单声明契约 (`StudentCompetencyDimensionConfig`, `StudentProfileWidgetConfig`)**:
  - 在 `@openlearn/plugin-sdk` 导出 `StudentCompetencyDimensionConfig` 与 `StudentProfileWidgetConfig` 类型定义，供第三方学科与学情诊断插件在 `package.json` 的 `openlearn.contributes` 中静态声明；
  - `StudentCompetencyDimensionConfig`: 支持声明自定义素养维度（如计算思维、批判思维、艺术创造、实践动手），属性包含 `key`, `label`, `weight`, `description`, `color`；
  - `StudentProfileWidgetConfig`: 支持声明个人全景学情小组件卡片（如代码查重率、测试覆盖率、注意力眼动诊断看板），属性包含 `id`, `title`, `component`, `position`, `height`；
  - 对应运行时 Extension Slots：`student.profile.dimension`、`student.profile.card`、`student.profile.action`、`student.profile.timeline_item`。

- **课堂顶栏与归因加分静态清单声明契约 (`ClassroomTopbarActionConfig`, `ClassroomAttributionAwardConfig`)**:
  - 在 `@openlearn/plugin-sdk` 导出 `ClassroomTopbarActionConfig` 与 `ClassroomAttributionAwardConfig` 类型定义，供第三方插件在 `package.json` 的 `openlearn.contributes` 中静态声明；
  - `ClassroomTopbarActionConfig`: 支持配置 `id`, `title`, `icon`, `command`, `tooltip`, `order`, `stages` 等属性，实现无需编写复杂前端代码即可向 48px 课堂中控顶栏注入动作；
  - `ClassroomAttributionAwardConfig`: 支持配置自定义表彰维度 `id`, `title`, `icon`, `defaultPoints`, `category`, `description`，赋能学科特色化课堂过程性评价；
  - 对应运行时 Extension Slots：`classroom.topbar.action`、`classroom.topbar.pill`、`classroom.attribution.award`、`classroom.attribution.action`、`classroom.leaderboard.action`。

- **新增「课件运行时脚本扩展点」DI 契约**：新增 Token `ICoursewareRuntimeScriptRegistryToken`（Token 名 `@openlearn/core:ICoursewareRuntimeScriptRegistry`）与类型 `CoursewareRuntimeScript`、`IRegisteredCoursewareRuntimeScript`、`ICoursewareRuntimeScriptRegistry`（实现类 `CoursewareRuntimeScriptRegistry` 位于 `@openlearn/core/di`，由内核启动时注册）。
  - 契约：`register(owner, { id, source, position?, priority?, coursewareId?, coursewareUuid? })`、`unregister(owner, id)`、`clear(owner?)`、`list(courseware?)`、`listOwners()`；`id` 在 `owner` 内唯一，重复注册即覆盖；`position` 取 `'head' | 'body-end'`，同位置按 `priority` 升序拼接。
  - 用途：互动课件运行在不透明源（opaque origin）iframe（`credentialless`、无 `allow-same-origin`）中，父窗口读不到其内部状态、也无法注入代码；插件可用本扩展点注册「随课件 HTML 一起下发、在课件 iframe 内部执行」的脚本，由宿主 `injectLmsSdk()` 在渲染时拼接（head 脚本紧随 Bridge SDK，body-end 脚本插在 `</body>` 前）。
  - 插件既可从 `@openlearn/plugin-sdk` 导入该 Token，也可用 `ctx.resolve(new Token('@openlearn/core:ICoursewareRuntimeScriptRegistry'))` 按名字解析 —— 后者不依赖 SDK 构建产物是否已包含该 Token，部署/升级顺序更安全。

## [3.7.0] - 2026-09-19

### Features & Types

- **Palette Item Extension Types (`PaletteItemConfig`)**:
  - Export `PaletteItemConfig`, `PaletteEditField`, `PaletteSelectOption`, and `PaletteItemComponentProps` interfaces in `@openlearn/plugin-sdk` (`openlearn.d.ts`).
  - Enable third-party plugins to type their `ctx.ui.registerPaletteItem` and `ctx.ui.unregisterPaletteItem` implementations when contributing custom lesson design widgets and whiteboard canvas components.

## [3.6.1] - 2026-09-12

### Features & Types

- **Auth Session Bridge Tokens & Interfaces (`IAuthSessionBridgeToken`)**:
  - Export `IAuthSessionBridgeToken`, `IAuthSessionBridgeService`, and `AuthBridgeUser` interfaces to enable privileged authentication plugins (such as LTI 1.3 Tool Provider) to securely synchronize users and issue session tokens via DI.
  - Extend `PluginApiResponse` with optional `sessionToken` field to support transparent `Set-Cookie` injection by the host API Gateway for embedded iframe environments (`SameSite=None; Secure`).
- **Plugin HTTP SSE Streaming (`ctx.http.stream`)**:
  - Export `PluginStreamResponse` and `PluginStreamHandler` interfaces in `@openlearn/plugin-sdk`.
  - Expose `ctx.http.stream(path, handler)` and `ctx.http.stream(method, path, handler)` on `IPluginHttpRouter` to enable Server-Sent Events (SSE) streaming for AI chat auto-typing and real-time progress push.
  - Support bidirectional abort signals via `stream.onClose(cb)` and `stream.isClosed` to prevent LLM resource leakage when clients disconnect.
- **Plugin RESTful API Router & Interfaces**:
  - Export `IPluginHttpRouter`, `PluginApiHandler`, `PluginApiRequest`, `PluginApiResponse`, `PluginApiActor` interfaces in `@openlearn/plugin-sdk`.
  - Expose `PluginHttpRouter` class in `@openlearn/plugin-sdk` and export on `ctx.http` within `PluginContext`.
  - Add `api` configuration schema to `PluginManifest` for static route declaration, authentication guards, RBAC roles, and rate limit specification.

## [3.6.0] - 2026-09-06

### Fixed

- **CLI 不再把 SDK 自身打进插件 bundle**：`resolve-plugin-sdk` onResolve 插件此前返回 `path: sdkDist` 覆盖了 external 标记，导致 SDK dist（引用宿主侧 pino/express/uuid/semver）被整体打包——脚手架项目构建直接失败，产物在宿主上还会因 node:fs/node:path 被 token-enforcer 拒绝。现保持 external，与平台官方 `build-plugins.mjs` 行为一致；独立脚手架项目无需再手动补装依赖。
- 脚手架模板 `engines.openlearn` 已为 `>=0.2.5`（与 npm 包兼容性检查语义一致，0.x 的 `^0.2.5` 不满足 0.3.x 宿主）。

## [3.5.2] - 2026-09-05

### Features

- **CoursewareSourceLoader**: Export `CoursewareSourceLoader` type for the html-applet content-source registry, letting plugins type their `ctx.ui.registerCoursewareSource` loaders.

## [3.5.1] - 2026-09-04

### Features

- **Whiteboard renderer/editor types**: Export `FullscreenRendererProps`, `FullscreenRenderer`, `PropertyEditorProps`, `PropertyEditorComponent` (type-only) so third-party plugins can type their `ctx.ui.registerFullscreenRenderer` / `registerPropertyEditor` callbacks without importing host internals.

## [3.5.0] - 2026-07-28

### Features

- Concrete service token types (was `Token<unknown>`)
- Sync-or-async service interfaces (`void | Promise<void>`)
- Tightened DI token typing for `IUIService`, `ICoursewareService`, etc.

## [3.4.3] - 2026-07-26

### Features

- **Remote Update Detection**: Add `updateSource` field to `Manifest` interface (`openlearn.d.ts`), allowing plugins to declare a GitHub/Gitee release source (`github-release` | `gitee-release` + `repo`). Plugin center can then dynamically check for new versions via `git ls-remote` (with GitHub/Gitee Releases API fallback) and semver comparison.

## [3.4.2] - 2026-07-26

### Fixes

- **Token & Facade Export Sync**: Add missing DI token declarations and type exports to `openlearn.d.ts` (points ledger, activity registry, lesson/classroom/presence/teaching/analytics engine facades) so plugin TypeScript code resolves them correctly. Switch unified foundation facade classes to `export type` so the runtime surface matches the declaration file.

## [3.4.1] - 2026-07-24

### Fixes

- **Build Externalization**: Switch `build.mjs` from `external:['zod']` to `packages:'external'` so the ESM dist no longer bundles `express`/`better-sqlite3`/`body-parser`, fixing `Dynamic require of "path" is not supported` on import.

## [3.4.0] - 2026-07-24

### Features

- **Unified Plugin Facades**: Export `PluginDistributionManager` facade (value + `IPluginDistributionManager` type) and `CapabilityRegistry` type so plugins can consume unified plugin services via DI.

## [3.3.1] - 2026-07-22

### Features

- Simplify `PluginTabPanel` by removing the tab bar; export `DOMExtensionWrapper`.

## [3.3.0] - 2026-07-21

### Features

- Cross-plugin type-safe service DI with help page plugin docs slot.

## [3.2.1] - 2026-07-20

### Features

- Initial published release. CLI scaffolding tool with `init` / `build` commands. Core TypeScript types, DI tokens, and plugin manifest interface.

[3.4.3]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.4.2...v3.4.3
[3.4.2]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.4.0...v3.4.2
[3.4.1]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.4.0...v3.4.1
[3.4.0]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.3.1...v3.4.0
[3.3.1]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.3.0...v3.3.1
[3.3.0]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v3.2.1...v3.3.0
[3.2.1]: https://github.com/aymwoo/OpenLearn-Next-V2/compare/v2.0...v3.2.1
