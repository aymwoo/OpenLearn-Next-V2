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

发版流程：bump `package.json` → 移动 Unreleased 条目到 `## [X.Y.Z] - 日期` → **合并进 `main`** → 打 tag（命名见 §2.1）→ `scripts/publish.sh`。SDK 版本独立演进（当前 3.7.4），不要在文档中写死版本号（用 `<!-- doc-version: sdk=X.Y.Z -->` 标记代替）。

### 2.1 发布 tag 约定

三个包共用一个 git ref 空间，tag 必须一眼看出属于哪个包，也**不能**误触发平台的发版 CI：

| 包                           | tag 形式                   | 例                       | 谁认它                                                                                   |
| ---------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `openlearn-next`（平台）     | `v<X.Y.Z>`                 | `v0.7.4`                 | `docker-rehearsal.yml`（`tags: ['v*']`）、`upgrade-regression.yml`（`tags: ['v*.*.*']`） |
| `@openlearn/plugin-sdk`      | `plugin-sdk-v<X.Y.Z>`      | `plugin-sdk-v3.7.4`      | 不触发 CI，只作「npm 上的版本 ↔ 仓库代码」的同源凭证                                     |
| `@openlearn/plugin-test-kit` | `plugin-test-kit-v<X.Y.Z>` | `plugin-test-kit-v3.3.4` | 同上                                                                                     |

五条硬规则：

1. **一律 annotated**（`git tag -a`）。lightweight tag 不记 tagger、日期和说明，事后无法证明它对应哪一次发布。
2. **SDK / test-kit 的 tag 不要用 `v` 开头**。`v3.7.4` 会同时命中上面两条平台 CI 的 glob —— 拿 SDK 的发版去跑平台的 docker rehearsal 与升级回归，既无意义又占 runner。
3. **指向「版本 bump + CHANGELOG 转正」的那个提交**，打完不要再往它上面叠提交（叠了就只能提版本号，见下条）。
4. **顺序固定**：提交 → **合并进 `main`** → 打 tag → push tag → `scripts/publish.sh`。npm 的 `gitHead` 记的是「发布时所在的提交」，tag 先于发布才能保证两者是同一个提交；反过来说，tag 打完又提交了任何东西，这个版本就发不出去了（`publish.sh` 与 `prepublishOnly` 都会拒绝指向不同提交的情况）。先合进 `main` 是第 ④ 条前提：**registry 不得领先于主干**，否则第三方照 `main` 抄到的代码和 npm 上的包不是同一份。
5. **同源用 `gitHead` 对账**，不要把 shasum 写进 tag message（tag 在发布前就打好了，那时还没有 shasum）：

   ```bash
   git rev-list -n1 plugin-sdk-v3.7.4                                    # tag 指向的提交
   npm view @openlearn/plugin-sdk@3.7.4 gitHead --registry=https://registry.npmjs.org
   ```

两道门禁（硬失败，不靠自觉）：

- `scripts/publish.sh` 的版本占用检查按包名取 tag 前缀：tag 不存在直接拒绝，并打印该执行的那两行命令；
- `scripts/assert-publishable.mjs` 挂在三个包的 `prepublishOnly` 上，任何绕过 `publish.sh` 的直接 `npm publish` 同样被拦
  （前缀由包名自动推导，`--tag-prefix` 只用于例外场景）。**新增包或改 `prepublishOnly` 时要记得挂上** ——
  `scripts/__tests__/publish-guard-wiring.test.ts` 会盯住这件事（SDK 曾经悄悄丢过一次，正好是它漏掉了 3.7.3 的守卫）。它一共查五条：① 依赖无本地协议、② 平台包 `FALLBACK_VERSION` 一致、③ HEAD 正好被发布 tag 指向、④ HEAD 已并入 `origin/main`、⑤ **CHANGELOG 与版本对得上**。
- **第 ⑤ 条查两件事**：CHANGELOG 里必须有 `## [<版本号>]` 段；`## [Unreleased]` 下不能再有条目。
  加它的原因是 2026-10-27 的一次实测：PR #326 把构建期守卫合进了 main，可 npm `latest` 仍是 3.7.3 ——
  那条发版发生在守卫合入之前，而**没有任何机制提示「main 上有未发布改动」**（`publish.sh` 与整个
  `audit-tools/` 里 grep `CHANGELOG` / `Unreleased` 零命中，发布链路完全不看 CHANGELOG）。
  折叠 Unreleased 这一步本来就在流程里，只是没人强制；现在没折叠就发不出去。
  例外用 `ALLOW_UNRELEASED_CHANGELOG=1`（或 `--allow-unreleased-changelog`）显式放行。
- **`scripts/check-doc-version.mjs`**（接入 `audit-tools/run.sh`，计入 drift）校验文档的
  `<!-- doc-version: sdk=X.Y.Z -->` 等于 `packages/plugin-sdk/package.json` 的 version。
  这个标记此前**全仓零校验**，只是个注释，于是安静地烂掉：SDK 已到 3.7.3 时 26 篇文档仍写 `sdk=3.7.2`，
  其中 `scaffold-cli.md` 顶着旧版本号描述着当时 npm 上根本没有的守卫。**抬了版本就得抬标记**，
  否则文档会承诺 registry 上不存在的能力。批量修法见脚本报错里给出的 `sed` 命令。

> **先鸡后蛋怎么破**：第 ④ 条会遇到「不发版 CI 就转不了绿、CI 不绿就合不进 main」的循环（兼容性作业装的是**已发布**的 SDK）。此时用 `ALLOW_UNMERGED_PUBLISH=1 scripts/publish.sh` 显式放行一次，发布后再重跑那条 CI —— 放行是**显式**的，会打印在成功输出里（`未并入主干（已显式放行）`），不会悄悄变成常态。

> **历史欠账（不回填）**：`0.1.0`–`0.1.9`、`0.1.16`、`0.3.9`、`0.3.19`、`0.3.20` 发布时没有 tag；`0.1.11`、`0.2.0`、`0.2.4`、`0.3.0`、`0.3.11`、`0.3.17`、`0.3.23`、`0.5.0`、`0.6.1`、`0.7.0`–`0.7.2` 有 tag 但 npm 上查不到该版本（`0.7.0`–`0.7.2` 只有 release notes，`npm i openlearn-next@0.7.2` 会 404）。这些属于历史，**不回填 tag** —— 回填等于伪造「这批代码就是那次发布的」。新版本一律要求 tag 与 npm 双向对齐。

## 3. 数据库迁移规范

- 新迁移放 `migrations/`，文件名 `NNN_description.sql`（序号递增）；
- 迁移必须幂等（`CREATE TABLE IF NOT EXISTS` 等），不写业务文案 seed（内置数据以代码常量兜底，见 teaching_modes 先例）；
- 涉及重建表的迁移需在真实开发库副本上验证旧数据零丢失。

## 4. 文档与测试约定

- 测试与源码同目录 `__tests__/`，`*.test.ts(x)`；插件测试用 `@openlearn/plugin-test-kit` 的 `createMockContext()`；
- 文档改动会触发 `audit-tools/` 一致性检查（CI `docs-drift-audit` job + pre-commit 钩子），文档中引用代码事实时使用「文件 + 符号名」而非行号；
- 提交信息中不要跳过钩子（`--no-verify`）。

### 4.1 在本地构建文档站（提交前建议跑一遍）

`docs/` 由 Sphinx + MyST 构建，发布在 [Read the Docs](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/)。
`.readthedocs.yaml` 已开 `fail_on_warning: true` —— **任何警告都会让线上构建失败**，所以推送前先在本地用同样的严格模式验一遍：

```bash
# 1) 装依赖（用 --target 到临时目录，避免污染本机 python）
python3 -m pip install --target=/tmp/pylibs -r docs/requirements.txt

# 2) 构建（-W 等价于 fail_on_warning，--keep-going 让所有问题一次暴露）
PYTHONPATH=/tmp/pylibs python3 -m sphinx -b html docs /tmp/docs-build -W --keep-going
```

两个环境相关的坑：

- **`/tmp` 是 tmpfs（10 MB）时装不下**，`pip` 会报 `No space left on device`。
  把 `--target` 与构建输出都指到大分区，并显式设 `TMPDIR`（pip 默认仍写 `/tmp`）：
  ```bash
  TMPDIR=$HOME/.cache/pip-tmp python3 -m pip install --target=$HOME/.cache/pylibs -r docs/requirements.txt
  PYTHONPATH=$HOME/.cache/pylibs TMPDIR=$HOME/.cache/pip-tmp python3 -m sphinx -b html docs $HOME/.cache/docs-build -W
  ```
- 内网镜像可能没有 sphinx 9：加 `-i https://pypi.org/simple`。

### 4.2 写文档时的三条硬约束

| 约束                     | 原因                                                          | 怎么做                                                      |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------- |
| 内链必须带 `.md` 后缀    | 不带后缀只有 Sphinx 认，GitHub 上 404                         | `[x](../architecture/configuration.md)`                     |
| 标题锚点按 GitHub 规则写 | `conf.py` 已 patch `docutils.make_id`，站点锚点与 GitHub 一致 | `#4-公测上线检查清单`（小写、去标点、空格转 `-`、保留中文） |
| 代码块必须标注语言       | 未标注的块在站点上无法高亮，AI Agent 也分不清是代码还是输出   | 围栏后紧跟语言标识：`ts`、`bash`、`text`                    |

跨文档引用带显式 label 的章节时用 `{ref}`，别写成「Markdown 链接 + `#label`」的形式 —— MyST 会把 `#label` 当锚点查而不是当 label 查，必然落空：

```markdown
档位判定见 {ref}`教程 §2.2 三档执行模式 <execution-modes>`。
```

> 已知的 Pygments 坑：TS/TSX 的 lexer 遇到**接口方法参数里的泛型逗号**（`Record<string, unknown>`）会产 Error token 并触发警告，连放在 `type` 别名里也触发。示例里改用 `unknown` 或拆出独立 interface。
