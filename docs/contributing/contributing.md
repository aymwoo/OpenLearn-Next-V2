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

发版流程：bump `package.json` → 移动 Unreleased 条目到 `## [X.Y.Z] - 日期` → **合并进 `main`** → 打 tag（命名见 §2.1）→ `scripts/publish.sh`。SDK 版本独立演进（当前 3.8.0），不要在文档中写死版本号（用 `<!-- doc-version: sdk=X.Y.Z -->` 标记代替）。

### 2.1 发布 tag 约定

三个包共用一个 git ref 空间，tag 必须一眼看出属于哪个包，也**不能**误触发平台的发版 CI：

| 包                           | tag 形式                   | 例                       | 谁认它                                                                                   |
| ---------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `openlearn-next`（平台）     | `v<X.Y.Z>`                 | `v0.7.4`                 | `docker-rehearsal.yml`（`tags: ['v*']`）、`upgrade-regression.yml`（`tags: ['v*.*.*']`） |
| `@openlearn/plugin-sdk`      | `plugin-sdk-v<X.Y.Z>`      | `plugin-sdk-v3.7.5`      | 不触发 CI，只作「npm 上的版本 ↔ 仓库代码」的同源凭证                                     |
| `@openlearn/plugin-test-kit` | `plugin-test-kit-v<X.Y.Z>` | `plugin-test-kit-v3.3.4` | 同上                                                                                     |

五条硬规则：

1. **一律 annotated**（`git tag -a`）。lightweight tag 不记 tagger、日期和说明，事后无法证明它对应哪一次发布。
2. **SDK / test-kit 的 tag 不要用 `v` 开头**。`v3.7.5` 会同时命中上面两条平台 CI 的 glob —— 拿 SDK 的发版去跑平台的 docker rehearsal 与升级回归，既无意义又占 runner。
3. **指向「版本 bump + CHANGELOG 转正」的那个提交**，打完不要再往它上面叠提交（叠了就只能提版本号，见下条）。
4. **顺序固定**：提交 → **合并进 `main`** → 打 tag → push tag → `scripts/publish.sh`。npm 的 `gitHead` 记的是「发布时所在的提交」，tag 先于发布才能保证两者是同一个提交；反过来说，tag 打完又提交了任何东西，这个版本就发不出去了（`publish.sh` 与 `prepublishOnly` 都会拒绝指向不同提交的情况）。先合进 `main` 是第 ④ 条前提：**registry 不得领先于主干**，否则第三方照 `main` 抄到的代码和 npm 上的包不是同一份。
5. **同源用 `gitHead` 对账**，不要把 shasum 写进 tag message（tag 在发布前就打好了，那时还没有 shasum）：

   ```bash
   git rev-list -n1 plugin-sdk-v3.7.5                                    # tag 指向的提交
   npm view @openlearn/plugin-sdk@3.8.0 gitHead --registry=https://registry.npmjs.org
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
`.readthedocs.yaml` 已开 `fail_on_warning: true` —— **任何警告都会让线上构建失败**。CI 的
`docs-drift-audit` job 会用同一组参数（`scripts/build-docs.sh`）再构建一遍，所以这类问题在 PR 阶段
就会暴露，不必等合进 main 后 RTD 才报红。推送前先在本地验一遍：

```bash
# 1) 装依赖（用 --target 到临时目录，避免污染本机 python）
python3 -m pip install --target=$HOME/.cache/pylibs -r docs/requirements.txt

# 2) 严格构建（-W 等价于 fail_on_warning，--keep-going 让所有问题一次暴露）
PYTHONPATH=$HOME/.cache/pylibs bash scripts/build-docs.sh $HOME/.cache/docs-build
```

**为什么必须真构建一次**：`audit-tools/run.sh` 的检查全是文本级比对（路径是否存在、符号是否在源码里、
代码块的调用形状），它看不见 Markdown 的**解析结果**。2026-10-29 踩过：MyST 指令块的标题里写了一对
反引号，`docs/agent` 27 页手册的 204 个提示框从未渲染出来，而当时的漂移审计是**全绿**的。判据与排查
路径见 [文档漂移门禁](../developer-guide/docs-drift-audit.md)。

两个环境相关的坑：

- **`/tmp` 是 tmpfs（10 MB）时装不下**：`pip` 会把下载物解到 `TMPDIR`，默认就是 `/tmp`，
  于是报 `No space left on device`。上面两处路径已指到 `$HOME`，若仍失败再显式设一次
  `TMPDIR=$HOME/.cache/pip-tmp`。
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

## 5. AI Agent 协作开发规范 (AI Agent Guidelines)

为了保障代码库的长期演进质量、保证变更可追溯并避免自动化工具污染主干分支，所有参与本项目开发的 AI Agent（包括 Antigravity、CodeBuddy、Cursor、Claude Code、GitHub Copilot 等）均须遵守以下规范：

> 🔁 **仓库托管双平台**：主仓 [github.com/aymwoo/OpenLearn-Next-V2](https://github.com/aymwoo/OpenLearn-Next-V2)（Issue / PR / CI / Release 主入口）；镜像 [gitee.com/aymwoo/openlearn-next](https://gitee.com/aymwoo/openlearn-next)（**国内网络访问 GitHub 受限**时用于克隆源码与提 Issue，**单向同步**，不跑 CI / 不发 Release）。
> 迁移规则：**一个变更只在一个平台开一份 Issue / PR**；**禁止在 Gitee 侧开启自动双向镜像**；issue / PR 编号不跨平台复用。
>
> **镜像快进已自动化**：`.github/workflows/sync-gitee-mirror.yml` 在 `main` 推送后自动同步（单向、只快进，发现分叉就停下并报错，绝不 force-push）；未配 `GITEE_USERNAME` / `GITEE_TOKEN` 时自动跳过，不阻塞主干 CI。
>
> 需要手动兜底时（维护者，需 Gitee 写权限）：
>
> ```bash
> git remote add gitee https://gitee.com/aymwoo/openlearn-next.git   # 已有则跳过
> git push gitee main --tags                                        # 只快进，不 force-push
> ```
>
> 普通贡献者只管在 GitHub 提 Issue 与 PR，镜像由维护者同步。若你本来是从 Gitee 克隆的（`origin` 已是镜像），`git push origin main --tags` 即为快进。

### 5.1 问题驱动（Issue-First 流程）

- **优先提 Issue**：无论是发现系统缺陷、安全隐患、性能退化，还是设计新特性，推荐优先在 GitHub 上发起 Issue（使用 `gh issue create` 或 Web 界面）；国内网络无法访问 GitHub 时，改为在 Gitee 镜像发起（`gitee issue create -R aymwoo/openlearn-next`，编号为 `I...` 字符串），**同一问题不要两边各提一份**。
- **完整记录上下文**：Issue 应阐明问题现象、影响范围、复现步骤、根本原因分析及预期的解决方案。
- **方案对齐**：对于涉及跨模块、架构变动或公共 API 的复杂任务，先就方案与人类维护者达成一致，再切入实现。

### 5.2 分支隔离与 PR 驱动（PR-Driven 协作）

- **严禁直推主干**：AI Agent **绝对禁止**直接向 `main` / `master` 分支 push 代码。
- **专用特性分支**：每次开发任务必须创建专用分支，命名推荐遵循 `<agent-name>/<issue-id>-<slug>`（例如 `codebuddy/issue-383-ai-provider-isolation`）。
- **提交规范**：严格执行 Conventional Commits 格式（如 `feat(kernel): ...`、`fix(whiteboard): ...`、`chore(release): ...`）。
- **规范发起 PR**：使用 `gh pr create` 发起 Pull Request，说明改动内容、原因、绑定 Issue（如 `Fixes #383`），并附带清晰的测试计划；涉及前端界面的修改强制提供截图或操作证据。

### 5.3 本地全套质量门禁（Pre-PR Quality Gates）

在发起 PR 或推送代码前，AI Agent 必须在本地按顺序完整运行并通过以下门禁：

```bash
# 1. 代码格式检查
pnpm format:check

# 2. 基础与严格 TypeScript 类型检查
pnpm lint
pnpm lint:strict

# 3. ESLint 告警预算控制（不得超过 baseline 阈值）
node scripts/check-lint-budget.mjs

# 4. 单元与集成测试套件
pnpm test

# 5. 文档与代码一致性验证（若涉及文档修改）
PYTHONPATH=$HOME/.cache/pylibs bash scripts/build-docs.sh $HOME/.cache/docs-build
bash audit-tools/run.sh
```

### 5.4 人类授权合并与分支生命周期闭环

- **严禁自主合并**：AI Agent **不得自行合并任何 PR**。必须在人类维护者进行代码审查并给出明确指令后，方可执行合并。
- **推荐 Squash Merge**：授权合并时推荐采用 `gh pr merge <pr_number> --squash --delete-branch`，保持主分支 git 历史扁平清晰。
- **分支清理与对齐**：合并后及时切回 `main` 分支拉取最新代码，并清理已合入的本地临时分支。
