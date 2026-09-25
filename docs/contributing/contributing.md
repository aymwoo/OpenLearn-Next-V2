# Contributing Guidelines 贡献者指南

## 1. 提交规范（Conventional Commits）

```
type(scope): message
```

- **type**：`feat` / `fix` / `docs` / `refactor` / `tool` / `test`
- **scope**：组件或领域名，如 `plugin`、`kernel`、`worker`、`whiteboard`、`PluginCenter`、`db`
- 提交前运行 `pnpm lint`（tsc --noEmit）与 `pnpm test`（Vitest）。

## 2. CHANGELOG 分层

| 变更对象 | 记录位置 |
| --- | --- |
| 平台宿主（`openlearn-next`） | 根 [CHANGELOG.md](../../CHANGELOG.md)，SemVer 标题 + `Features / Fixes / Refactor / Docs / Breaking Changes` 小节；开发中变更写入 `## [Unreleased]` |
| Plugin SDK（`@openlearn/plugin-sdk`） | `packages/plugin-sdk/CHANGELOG.md` |
| 单个插件（`v2_plugins/<plugin-id>`） | 各插件目录内 `CHANGELOG.md` |

发版流程：bump 根 `package.json` → 移动 Unreleased 条目到 `## [X.Y.Z] - 日期` → 打 tag `vX.Y.Z`。SDK 版本独立演进（当前 3.7.0），不要在文档中写死版本号（用 `<!-- doc-version: sdk=X.Y.Z -->` 标记代替）。

## 3. 数据库迁移规范

- 新迁移放 `migrations/`，文件名 `NNN_description.sql`（序号递增）；
- 迁移必须幂等（`CREATE TABLE IF NOT EXISTS` 等），不写业务文案 seed（内置数据以代码常量兜底，见 teaching_modes 先例）；
- 涉及重建表的迁移需在真实开发库副本上验证旧数据零丢失。

## 4. 文档与测试约定

- 测试与源码同目录 `__tests__/`，`*.test.ts(x)`；插件测试用 `@openlearn/plugin-test-kit` 的 `createMockContext()`；
- 文档改动会触发 `audit-tools/` 一致性检查（CI `docs-drift-audit` job + pre-commit 钩子），文档中引用代码事实时使用「文件 + 符号名」而非行号；
- 提交信息中不要跳过钩子（`--no-verify`）。
