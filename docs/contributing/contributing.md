# Contributing Guidelines 贡献者指南

## 1. 提交规范（Conventional Commits）

```
type(scope): message
```

- **type**：`feat` / `fix` / `docs` / `refactor` / `tool` / `test`
- **scope**：组件或领域名，如 `plugin`、`kernel`、`worker`、`whiteboard`、`PluginCenter`、`db`
- 提交前运行 `pnpm lint`（tsc --noEmit）与 `pnpm test`（Vitest）。

## 2. CHANGELOG 分层

| 变更对象                                   | 记录位置                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 平台宿主（`openlearn-next`）               | 根目录 `CHANGELOG.md`，SemVer 标题 + `Features / Fixes / Refactor / Docs / Breaking Changes` 小节；开发中变更写入 `## [Unreleased]` |
| Plugin SDK（`@openlearn/plugin-sdk`）      | `packages/plugin-sdk/CHANGELOG.md`                                                                                                  |
| 内置插件（`packages/plugins/<plugin>.ts`） | 无独立 CHANGELOG —— 变更记入平台 `CHANGELOG.md`（`v2_plugins/` 为独立仓库，其插件维护各自的 `CHANGELOG.md`，不在本仓）              |     |

发版流程：bump `package.json` → 移动 Unreleased 条目到 `## [X.Y.Z] - 日期` → 打 tag（命名见 §2.1）→ `scripts/publish.sh`。SDK 版本独立演进（当前 3.7.1），不要在文档中写死版本号（用 `<!-- doc-version: sdk=X.Y.Z -->` 标记代替）。

### 2.1 发布 tag 约定

三个包共用一个 git ref 空间，tag 必须一眼看出属于哪个包，也**不能**误触发平台的发版 CI：

| 包                           | tag 形式                   | 例                       | 谁认它                                                                                   |
| ---------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `openlearn-next`（平台）     | `v<X.Y.Z>`                 | `v0.7.4`                 | `docker-rehearsal.yml`（`tags: ['v*']`）、`upgrade-regression.yml`（`tags: ['v*.*.*']`） |
| `@openlearn/plugin-sdk`      | `plugin-sdk-v<X.Y.Z>`      | `plugin-sdk-v3.7.1`      | 不触发 CI，只作「npm 上的版本 ↔ 仓库代码」的同源凭证                                     |
| `@openlearn/plugin-test-kit` | `plugin-test-kit-v<X.Y.Z>` | `plugin-test-kit-v3.3.4` | 同上                                                                                     |

五条硬规则：

1. **一律 annotated**（`git tag -a`）。lightweight tag 不记 tagger、日期和说明，事后无法证明它对应哪一次发布。
2. **SDK / test-kit 的 tag 不要用 `v` 开头**。`v3.7.1` 会同时命中上面两条平台 CI 的 glob —— 拿 SDK 的发版去跑平台的 docker rehearsal 与升级回归，既无意义又占 runner。
3. **指向「版本 bump + CHANGELOG 转正」的那个提交**，打完不要再往它上面叠提交（叠了就只能提版本号，见下条）。
4. **顺序固定**：提交 → 打 tag → push tag → `scripts/publish.sh`。npm 的 `gitHead` 记的是「发布时所在的提交」，tag 先于发布才能保证两者是同一个提交；反过来说，tag 打完又提交了任何东西，这个版本就发不出去了（`publish.sh` 与 `prepublishOnly` 都会拒绝指向不同提交的情况）。
5. **同源用 `gitHead` 对账**，不要把 shasum 写进 tag message（tag 在发布前就打好了，那时还没有 shasum）：

   ```bash
   git rev-list -n1 plugin-sdk-v3.7.1                                    # tag 指向的提交
   npm view @openlearn/plugin-sdk@3.7.1 gitHead --registry=https://registry.npmjs.org
   ```

两道门禁（硬失败，不靠自觉）：

- `scripts/publish.sh` 的版本占用检查按包名取 tag 前缀：tag 不存在直接拒绝，并打印该执行的那两行命令；
- `scripts/assert-publishable.mjs` 挂在三个包的 `prepublishOnly` 上，任何绕过 `publish.sh` 的直接 `npm publish` 同样被拦（前缀由包名自动推导，`--tag-prefix` 只用于例外场景）。

> **历史欠账（不回填）**：`0.1.0`–`0.1.9`、`0.1.16`、`0.3.9`、`0.3.19`、`0.3.20` 发布时没有 tag；`0.1.11`、`0.2.0`、`0.2.4`、`0.3.0`、`0.3.11`、`0.3.17`、`0.3.23`、`0.5.0`、`0.6.1`、`0.7.0`–`0.7.2` 有 tag 但 npm 上查不到该版本（`0.7.0`–`0.7.2` 只有 release notes，`npm i openlearn-next@0.7.2` 会 404）。这些属于历史，**不回填 tag** —— 回填等于伪造「这批代码就是那次发布的」。新版本一律要求 tag 与 npm 双向对齐。

## 3. 数据库迁移规范

- 新迁移放 `migrations/`，文件名 `NNN_description.sql`（序号递增）；
- 迁移必须幂等（`CREATE TABLE IF NOT EXISTS` 等），不写业务文案 seed（内置数据以代码常量兜底，见 teaching_modes 先例）；
- 涉及重建表的迁移需在真实开发库副本上验证旧数据零丢失。

## 4. 文档与测试约定

- 测试与源码同目录 `__tests__/`，`*.test.ts(x)`；插件测试用 `@openlearn/plugin-test-kit` 的 `createMockContext()`；
- 文档改动会触发 `audit-tools/` 一致性检查（CI `docs-drift-audit` job + pre-commit 钩子），文档中引用代码事实时使用「文件 + 符号名」而非行号；
- 提交信息中不要跳过钩子（`--no-verify`）。
