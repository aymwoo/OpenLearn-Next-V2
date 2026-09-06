# Changelog

All notable changes to **@openlearn/plugin-sdk** are documented here.

> This package is versioned independently from the platform `openlearn-next` host.
> Bumping the SDK does not change the platform version.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Features
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
