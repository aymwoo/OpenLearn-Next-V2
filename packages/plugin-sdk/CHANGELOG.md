# Changelog

All notable changes to **@openlearn/plugin-sdk** are documented here.

> This package is versioned independently from the platform `openlearn-next` host.
> Bumping the SDK does not change the platform version.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- **`build` 新增构建期守卫：frontend 产物不得残留裸模块说明符**。远程插件的前端跑在不透明源 iframe
  （`sandbox="allow-scripts"`）里，那里没有 React、没有 `window.HostSharedDeps`、也没有 importmap，
  加载方式是 `Blob` + 动态 `import()` —— 裸说明符无从解析。宿主的 `transformBareModuleImports` 会把
  `import React from 'react'` 改写成 `window.HostSharedDeps.React`，但改写后的源码是在**没有
  HostSharedDeps 的 iframe 里**求值的，结果是激活即 TypeError，而报错完全不指向真正原因。
  现在只要 `frontend.js` 里还有 `from "react"` 这类非相对/非绝对路径的静态导入、`require(...)`
  或动态 `import(...)` 字面量，构建直接 `exit 1` 并打印改法（桥接入口 / 删 React / 只 `import type` /
  改用声明式贡献）。`--watch` 下每次重建都会检查，但不中断监听。
  注意：`import React` 若**根本没用到**，esbuild 会 tree-shake 掉，那属于真干净，不会报错。
  官方脚手架模板是纯桥接，不受影响。

## [3.7.3] - 2026-10-27

### Fixes

- **`build` 检测到 `migrations/` 目录时告警（Issue #321）**：宿主确实会在插件激活前执行 `<pluginDir>/migrations`
  （`packages/core/plugin-host/lifecycle.ts` 的 `runPluginDeclarativeMigrations`），但官方 CLI 的 ZIP **只打包**
  `index.js` / `manifest.json` / `frontend.js`。两边都对，是**分发链路**把中间截断了 —— 作者按
  `docs/reference/plugin-database-api.md` §3.1 写了 `migrations/001_*.sql`，会经历「构建成功 → 安装成功 →
  激活成功 → 首次执行 SQL 才报 `no such table`」，故障点被推迟到最难排查的时刻且全程零提示。
  - **改法**：`cmdBuild` 在确认 `src/index.ts` 存在后检查 `<cwd>/migrations`，存在则打印一条 warning，
    直接给出替代路径（`ctx.db.ensureTable()` + `ctx.db.migrate(version, fn)`）并从构建期指向文档。
    **刻意不改变打包契约**（ZIP 仍是三件套）—— 这是提示，不是静默改行为；
    真要把该目录打进 ZIP 需要宿主侧解压落地，属后续独立决策。
  - **验证**：新增 `packages/plugin-sdk/__tests__/cli-build-migrations-warning.test.ts`（真跑 CLI，不 mock），
    覆盖「有 `migrations/` → 告警且解包后 ZIP 条目仍是三件套」「无 `migrations/` → 不告警（不许变成噪音）」；
    负向对照 —— 撤掉告警代码后第 1 条用例失败（`expected '…Building openlea…' to contain 'migrations/'`），
    恢复后 2 passed。

### Docs

- **`migrations/` 的分发口径写进脚手架指南与数据库 API 页**：官方 ZIP 只含三件套这件事此前只在
  `docs/reference/plugin-database-api.md` §3.1 补了警示框，第三方作者仍可能先写 `migrations/` 再发现不生效；
  `docs/sdk/scaffold-cli.md` §2 现在也写明「ZIP 里只有这三件套」。

### 弃用

- **3.7.1 已在 npm 上弃用**（`npm deprecate`，不撤包）：该版本 `dist/index.js` 残留 5 处 `node:` 静态导入，
  把 SDK 打进插件包体的第三方插件运行期必失败。改用 3.7.3，详见 `[3.7.1]` 段首的红线提示。

## [3.7.1] - 2026-10-27

> ⚠️ **本版本已弃用，不要安装**：`dist/index.js` 里残留 5 处 `node:` 静态导入
> （`fs` / `path` / `url` / `crypto`，产物 75 KB，3.7.2 为 18 KB）。凡是把 SDK 内联进 worker bundle 的
> 第三方插件，运行期必然失败。已在 npm 标记 deprecated，安装时会打印告警。
> **装法改为：`npm i -D @openlearn/plugin-sdk@3.7.2`**（本段的模板与类型修复在 3.7.2 中全部保留）。

> **升级理由**：`init` 生成的插件此前**装得上、构建得过、一激活就报 `missing activate function`**。
> 3.7.1 修掉了这个模板缺陷，并把 3.7.0 之后累积的类型契约一并发布（全部为新增导出，向后兼容）。

### Fixes

- **脚手架模板的前端入口改为沙箱桥接（`frontend.tsx` 不再导出 React 组件）**：
  - **问题**：`full-stack` / `frontend-only` 模板生成 `export default function Component()`，而宿主沙箱加载器（`server/utils/plugin-sandbox-frame.ts`）要求 `typeof plugin.activate === 'function'` —— 新建插件一装就报 `missing activate function` 并进入错误态。第三方插件的前端本来就跑在隐藏的不透明源 iframe 里，那个组件既不会被渲染、也无法跨 `postMessage` 传递。
  - **改法**：两个模板统一生成 `export default { activate, deactivate }`，iframe 内只做桥接：读课堂上下文（`context.get()`）、写命名空间存储、注册**数据型**扩展点。`full-stack` 额外注册一个 `command_palette.item`（由宿主渲染，是第三方插件唯一可见的入口形态）；`frontend-only` 改为「首次激活 toast + 存储」的纯桥接演示，并删掉原先声明的悬空 `classroomTool`（有 `commandType` 无 handler，点了只会报 No handler registered）。
  - **模板小坑**：`classroomTools[].payload` 补 `$lessonId` / `$classId` 占位符并把回显写进 handler 结果；`--author` 缺省时回落 `OpenLearn Developer`（原来拼出 `@/name` 空 scope）；扩展点 / Action 的 `id` 从 `{{pluginId}}-x` 改为 `{{name}}-x`（原值形如 `@scope/name-tool`，带斜杠）。
- **补上 `INetworkProxyServiceToken` 的手写声明**。`index.ts` 已导出该 Token，`openlearn.d.ts` 同步 `declare` 与导出块，插件 `import { INetworkProxyServiceToken }` 不再 TS2305。出站请求仍由宿主代理。

### Features & Types

- **成绩写入结果与审计选项 (`SemesterGradeWriteOptions`, `GradeWriteSummary`)**:
  - `ISemesterGradeService.saveSemesterGrade` 新增可选第 4 参 `SemesterGradeWriteOptions`：`actorId` / `actorRole`（写入成绩审计历史）、`source`（`manual | plugin | ai | system`，默认 `plugin`）、`overrideProtected`（仅教师显式改判时越过手动分/缺考保护）。
  - 返回值由 `Promise<void>` 扩展为 `Promise<GradeWriteSummary | void>`：被手动分/缺考保护拒绝时返回 `{ ok: false, reason }`，插件据此提示教师而不是当作成功；旧调用方可继续忽略返回值。
  - 宿主统一成绩写入入口在保护生效时**不会**静默覆盖，且每次分数/状态/来源真正变化都会写 `assignment_grade_history`。

- **教学环节条件类型 (`SegmentGateTypeContribution`)**:
  - 导出 `SegmentGateTypeContribution`，供插件在 `contributes['segment.gate_type']` 声明 `id`、`labelZh`、`labelEn`、`commandType` 与可选 `paramsSchema`；
  - 宿主用该命令做只读判定（`capabilityRequired: 'segment:gate_eval'`）。不要把判定函数注册进宿主。

- **备课环节类型扩展契约 (`SegmentTypeMeta`)**:
  - 导出 `SegmentTypeMeta`，供第三方插件通过宿主 `ctx.ui.registerSegmentType` / `unregisterSegmentType` 向备课时间线贡献自定义教学形态；
  - 与声明式 `contributes['editor.timeline_segment']`（需含 `labelZh` + `labelEn`）桥接语义对齐。

- **全班大屏作业互评与协同赏析模式静态清单声明契约 (`PeerReviewRubricConfig`, `PeerReviewBadgeConfig`)**:
  - 在 `@openlearn/plugin-sdk` 导出 `PeerReviewRubricConfig` 与 `PeerReviewBadgeConfig` 类型定义，供第三方互动教学与学科评价插件在 `package.json` 的 `openlearn.contributes` 中静态声明；
  - `PeerReviewRubricConfig`: 支持声明自定义互评量规维度（如算法复杂度、代码注释覆盖率、视觉构图美感），属性包含 `id`, `name`, `description`, `maxScore`, `weight`, `icon`, `targetMetric`；
  - `PeerReviewBadgeConfig`: 支持声明特色随堂互评微勋章（如“算法攻坚勋章”、“最佳开源作者”、“极客重构奖”），属性包含 `id`, `title`, `emoji`, `description`, `color`, `points`；
  - 对应运行时 Extension Slots：`peer_review.rubric.dimension`、`peer_review.badge`、`peer_review.action`、`peer_review.showcase.widget`。

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

## [3.7.2] - 2026-10-27

### Fixes

- **`dist/index.js` 不再含 `node:` 静态导入 —— 修复 3.7.1 引入的打包回归，所有把 SDK 内联进 worker bundle 的第三方插件从此能构建通过。**

  3.7.1 把 7 个**宿主内部类**（`PluginRuntimeAdapter` / `PluginRuntimeComposition` / `PluginContextAdapter` / `PluginLifecycleManager` / `PluginCapabilityGateway` / `UnifiedExtensionRegistry` / `PluginDistributionManager`）改成了值导出。代价是 esbuild 把整条 `packages/core` 实现链内联进产物，其中 `core/version.ts` 静态 `import fs from 'node:fs'`：

  |                   | 3.7.0 | 3.7.1                                     | 3.7.2 |
  | ----------------- | ----- | ----------------------------------------- | ----- |
  | `dist/index.js`   | 13 KB | **75 KB**                                 | 18 KB |
  | 顶层 `node:` 导入 | 0     | **4**（`fs` / `path` / `url` / `crypto`） | 0     |

  插件构建普遍用 `external: []` 把 SDK 打进 worker bundle，随后做「产物不得残留 import」自检 —— 一见到 `node:fs` 就判失败。CI 作业 `Third-party plugin compatibility` 的 class_manager 构建即因此连续红。

  **这 7 个类改回类型导出**。取舍：类型导出会让 `new X()` 报 `TS1362`（编译期、可定位）；把 node 内置模块打进插件产物是运行期崩溃，插件作者无从判断。宿主侧请从 `packages/core/plugin-host/*.js` 直接导入（`packages/core/kernel/index.ts` 就是这么做的）—— SDK 不是宿主的内部依赖通道。

  `dist/index.d.ts` 同步降级为 `export type`：否则 d.ts 会告诉消费者「这是值」，编译通过、运行期 `undefined`。`generate-dts.mjs` 新增 `FORCED_TYPE_ONLY` 名单，覆盖导出分类与 `handExportGaps` 两条路径。

### 守卫

- `build.mjs` 在 esbuild 之后断言产物不含 `node:` 静态导入，命中即 `exit 1` 并打印成因。
- `dist-entrypoint.test.ts` 新增一条独立契约用例（不复用 build.mjs 的断言，避免后者被删就失守）：产物零 `node:` 导入、体积 < 40 KB、7 个类在 d.ts 里只以类型导出。
- 负向验证：把 `PluginRuntimeAdapter` / `PluginLifecycleManager` 改回值导出 → `build.mjs` `exit 1`、契约用例失败；还原后归零。

## [3.7.1] - 2026-10-27

> 补记：3.7.1 当时漏写 CHANGELOG。

### Fixes

- **脚手架模板的 `src/frontend.tsx` 改为沙箱桥接入口**：由 `export default function Component(props)` 改为 `export default { activate, deactivate }`。第三方插件的前端运行在 iframe 沙箱里，`plugin-sandbox-frame.ts` 只认 `activate` 函数；照旧模板抄会得到 `missing activate function`，插件状态卡在 `ERROR`。
- `scaffold create` 的 `--author` 缺省回落为 `OpenLearn Developer`。

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
