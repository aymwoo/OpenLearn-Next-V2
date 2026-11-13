# Repository Guidelines

## Project Structure & Module Organization

```
├── server.ts              # Express + Socket.IO backend (API routes, AI agent, auth)
├── server/                # Server-side modules (server modular split)
│   ├── middleware/        # Auth and security middleware
│   ├── routes/            # Express route handlers
│   └── utils/             # Server utilities
│       └── bridge-sdk.ts  # AUTO-GENERATED from packages/bridge-sdk/src/bridge.js via scripts/build-bridge-sdk.mjs — do not edit directly
├── src/                   # React 19 frontend
│   ├── App.tsx            # Main application shell
│   ├── components/        # Shared UI components (PascalCase)
│   ├── features/          # Domain feature modules (courseware, teacher, whiteboard, modals)
│   ├── services/          # API client layer
│   ├── hooks/             # Shared React hooks
│   ├── store/             # Zustand stores
│   └── types/             # TypeScript type definitions
├── packages/
│   ├── core/              # OS kernel subsystems (command-bus, event-bus, plugin-runtime, db, DI)
│   ├── plugin-sdk/        # Plugin development types and tokens
│   ├── plugin-test-kit/   # Mock context factory for plugin testing
│   ├── plugins/           # Built-in plugins (builtin, vfs, process, management, ai-planner, assignment-eval, courseware-score, ai-submit-injector, score-monitor-script)
│   └── bridge-sdk/        # LMS Bridge iframe SDK source (packages/bridge-sdk/src/bridge.js)
├── docs/                  # Architecture reports and plugin development tutorials
├── assets/                # Static resources (plugin ZIPs)
├── migrations/            # SQLite schema migrations
└── storage/               # Runtime file storage (courseware uploads)
```

## Build, Test, and Development Commands

| Command            | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `pnpm dev`         | Start dev server (Express + Vite HMR) on port 9000         |
| `pnpm build`       | Vite frontend build → plugin build → esbuild server bundle |
| `pnpm start`       | Run production server from `dist/server.cjs`               |
| `pnpm lint`        | TypeScript type check (`tsc --noEmit`)                     |
| `pnpm lint:eslint` | ESLint across all `.ts`/`.tsx` files                       |
| `pnpm format`      | Prettier auto-format                                       |
| `pnpm test`        | Run Vitest test suite                                      |

## Coding Style & Naming Conventions

- **Formatting**: Prettier — 2-space indent, single quotes, trailing commas, 120 char width
- **Linting**: ESLint with `@typescript-eslint` and `react-hooks` plugins; `no-explicit-any` is a warning
- **Frontend**: PascalCase components, camelCase hooks/utils, default exports for components
- **Backend**: kebab-case package directories with `index.ts` barrel files; ESM imports use `.js` extensions
- **Command types**: dot-separated namespacing — `lesson.create`, `whiteboard.draw`, `vfs.write_file`
- **Events**: past-tense names — `lesson.created`, `assignment.graded`
- **Plugin IDs**: snake_case — `ext-homework-hub`, `prov_openai`
- **Constants**: UPPER_SNAKE_CASE

## Testing Guidelines

- **Framework**: Vitest with jsdom environment
- **Test location**: `__tests__/` directories co-located with source, files ending in `.test.ts` or `.test.tsx`
- **Config**: Defined in `vitest.config.ts` — `fileParallelism: true` enabled safely via isolated per-worker temporary SQLite databases (keyed by `VITEST_POOL_ID` in `/tmp/openlearn_test_dbs/`); 60s timeout for integration tests
- **Plugin testing**: Use `createMockContext()` from `@openlearn/plugin-test-kit` to isolate plugin tests
- Run a subset with `pnpm vitest run -t "pattern"`

## Commit & Pull Request Guidelines

- **Commit format**: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): message`
- **Types used**: `feat`, `fix`, `docs`, `refactor`, `tool`, `test`, `chore`
- **Scopes**: Component or domain — `plugin`, `kernel`, `worker`, `whiteboard`, `PluginCenter`, `db`, `release`, `auth`, `ai`, etc.
- **PR descriptions**: Describe what changed and why, link related issues, include screenshots for UI changes.

## AI Agent Collaboration & Development Workflow (AI Agent 协作与开发规范)

All AI coding agents (including Antigravity, CodeBuddy, Cursor, Claude Code, Copilot, etc.) working in this repository MUST strictly abide by the following collaboration lifecycle:

> 🔁 **仓库双平台（GitHub 主仓 / Gitee 镜像）**
>
> | 平台           | 地址                                        | 用途                                                                                 |
> | -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
> | GitHub（主仓） | https://github.com/aymwoo/OpenLearn-Next-V2 | **Issue / PR / CI / Release / npm 发布的主入口**                                     |
> | Gitee（镜像）  | https://gitee.com/aymwoo/openlearn-next     | 国内网络访问 GitHub 受限时的**克隆与 Issue 通道**（只读镜像，不跑 CI、不发 Release） |
>
> 镜像由 GitHub **单向同步**（绝不 force-push）。规则：**一个变更只在一个平台开一份 Issue / PR**（不要两边各提一份）；**禁止在 Gitee 侧开启自动双向镜像**（会覆盖分支 / 标签 / 提交，冲掉 GitHub 上的 PR 合并结果）；issue / PR 编号不跨平台复用（GitHub 是整数，Gitee issue 是 `I...` 字符串）。
>
> **镜像快进已自动化**：`.github/workflows/sync-gitee-mirror.yml` 在每次 `main` 推送后自动快进镜像（单向、只快进；发现分叉就停下，**绝不 force-push**）。普通贡献者 / Agent 只管在 GitHub 提 Issue 与 PR，**不需要你做任何镜像相关操作**。
>
> 维护者只需一次性配置 Secret：`GITEE_USERNAME` + `GITEE_TOKEN`（Gitee → 设置 → 私人令牌 → 勾 `projects`）。未配置时该 workflow 自动跳过，不影响主干 CI。
>
> 自动同步失败 / 需手动兜底时：
>
> ```bash
> # 从 GitHub 克隆的仓库：origin=GitHub，需要先把镜像加成第二个远端
> git remote add gitee https://gitee.com/aymwoo/openlearn-next.git   # 已有则跳过（git remote -v 可查）
> git push gitee main --tags                                        # 只快进，不 force-push；--tags 同步 release tag
> ```
>
> 若你本来就是从 Gitee 克隆的（`origin` 已是镜像），则 `git push origin main --tags` 即为快进；想同时保留 GitHub 再 `git remote add github https://github.com/aymwoo/OpenLearn-Next-V2.git`。

### 1. Issue-First 驱动流程 (Issue-Driven Workflow)

- **推荐优先提 Issue**：当发现系统缺陷（Bug）、潜在安全漏洞、性能退化、代码坏味道或构想新功能时，**推荐首先通过 GitHub Issue（命令行 `gh issue create` 或 Web 端）进行完整记录与方案对齐**。国内网络无法访问 GitHub 时，改为在 Gitee 镜像提 Issue（`gitee issue create -R aymwoo/openlearn-next`，注意编号是 `I...` 字符串）；**同一问题只提一处**。
- **Issue 结构要素**：
  - 清晰准确的标题（如 `fix(whiteboard): ...` 或 `feat(ai-provider): ...`）；
  - 问题背景与复现步骤（Reproduction Steps / Impact Scope）；
  - 预期表现与实际异常行为对比；
  - 根因分析（Root Cause）与建议技术方案设计。
- **方案对齐再编码**：对于复杂改动或架构调整，建议先在 Issue 或会话中向人类维护者提供设计方案/工件（Artifact-First），达成一致后再切入代码编写。

### 2. PR-Driven 协作与分支隔离 (Branch Isolation & Pull Requests)

- **严禁直接推送到主干**：AI Agent **绝对不得**直接向 `main` / `master` 分支执行 `git commit` 或 `git push`。
- **专用特性分支**：每次改动必须基于最新的主干（`origin/main`）创建独立的工作分支，分支命名遵循规范：
  - 格式：`<agent-or-tool>/<issue-id>-<slug>` 或 `<agent-or-tool>/<slug>`
  - 示例：`codebuddy/issue-383-ai-provider-isolation`、`cursor/fix-whiteboard-loop`、`codebuddy/release-v0.7.11`。
- **共用一个分支**：同一变更对应的分支与 PR **只在一个平台创建**（默认 GitHub；GitHub 不可达时才走 Gitee），另一个平台只接收 `main` 快进，不接收同名分支。
- **常规提交规范**：提交信息必须严格遵循 Conventional Commits 格式。
- **规范化 PR 交付（`gh pr create`）**：
  - PR 标题使用 Conventional Commits 格式；
  - 关联 Issue 关键词：在正文中通过 `Fixes #xxx`、`Closes #xxx` 或 `Refs #xxx` 绑定问题跟踪；
  - 阐述改动要点：简要罗列变更内容（What）与设计取舍（Why）；
  - 完整的测试计划（Test Plan）：列出执行并通过的单元测试、集成测试或端到端验证；
  - **UI 变更强制附图**：凡修改前端、界面或交互，PR 描述中必须包含实拍截图（Screenshot）或操作录屏证据。

### 3. 本地全套质量门禁 (Pre-PR Quality Gates)

在发起 PR 或推送代码前，AI Agent 必须在本地按顺序完整运行并通过以下质量门禁，**严禁带错提交**：

1. **代码格式**：`pnpm format:check`（Prettier 格式化检查，必要时运行 `pnpm format`）；
2. **类型检查**：`pnpm lint`（`tsc --noEmit` 基础类型检查）；
3. **严格类型检查**：`pnpm lint:strict`（严苛模式类型检查）；
4. **Lint 预算守卫**：`node scripts/check-lint-budget.mjs`（ESLint 告警数严禁超出预算基线）；
5. **单元与集成测试**：`pnpm test`（Vitest 测试套件必须全绿通过）；
6. **文档与代码一致性（若修改了文档）**：`bash scripts/build-docs.sh`（Sphinx 严格构建，禁止任何警告）及 `bash audit-tools/run.sh`（一致性审计）。

### 4. 人类授权合并与闭环守卫 (Human-Authorized Merge & Close)

- **严禁擅自合并**：AI Agent **绝对不得自主合并（Merge）任何 Pull Request**。所有 PR 的合并必须等待人类开发者/维护者的明确授权指令（如「确认合并」、「合并这个 PR」）。
- **合并策略**：在获得人类明确授权后，推荐采用 Squash Merge 方式合并入 `main`（`gh pr merge <pr-number> --squash --delete-branch`），保持主干历史线性清晰。
- **分支生命周期闭环**：合并完成后，切回本地 `main` 分支，执行 `git pull` 对齐最新代码，并清理已合入的本地及远程临时分支。

## Release & CHANGELOG Workflow

- **Keep a Changelog Standard**: All platform changes are recorded in [CHANGELOG.md](CHANGELOG.md) under SemVer headings (`## [X.Y.Z] - YYYY-MM-DD`) with standard subsections (`### Features`, `### Fixes`, `### Refactor / Performance`, `### Docs`, `### Breaking Changes`).
- **Unreleased Draft Buffer**: Maintain an `## [Unreleased]` section at the top of `CHANGELOG.md` during ongoing development. Move items to `## [X.Y.Z]` when cutting a release.
- **Version Alignment**: When releasing a new version, bump `"version"` in `package.json`, update `CHANGELOG.md`, and create a git tag `vX.Y.Z`.
- **Multi-tier Scope Boundaries**:
  - `CHANGELOG.md`: Platform host (`openlearn-next`).
  - `packages/plugin-sdk/CHANGELOG.md`: Plugin SDK types & DI tokens (`@openlearn/plugin-sdk`).
  - `packages/plugins/<plugin-id>/CHANGELOG.md`: Individual built-in plugins (no `v2_plugins/` directory in this repo).

## Environment

**Node 版本：用 24（见 `.nvmrc`）**。`pnpm dev` / `pnpm test` / `pnpm test:e2e` 都请在同一版本上跑 —— 换主版本会连带触发两类问题：

1. **原生模块 ABI 不匹配**：`better-sqlite3` 是按主版本编译的（Node 22 → ABI 127、24 → 137、26 → 147）。换版本后不重编就会启动即崩，报 `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` 不匹配。修法：在当前 Node 下执行 `pnpm rebuild better-sqlite3`。
2. **Node 26 无法跑测试**：Node 26 内置了实验性的 Web Storage，`globalThis.localStorage` **存在但值为 `undefined`**（需要 `--localstorage-file` 才可用，否则访问会打 `ExperimentalWarning`）。vitest 的 jsdom 环境会跳过 Node 已经定义过的全局，于是留下那个坏掉的 `localStorage`，表现为大量用例报 `Cannot read properties of undefined (reading 'clear')`（实测：213 个测试文件 / 298 条用例全红；换回 22 或 24 即恢复）。

CI 也钉在 `node-version: 24`，本地对齐它就是对齐合并门禁。

Copy `.env.example` to `.env`. AI features are configured via **AI Providers** in the admin dashboard ("AI Provider Management") with any OpenAI-compatible model provider (such as DeepSeek, Qwen, Ollama, OpenAI, etc.). Seed usernames are `admin` (administrator) and `teacher` (teacher); passwords come from `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD`, otherwise **default to the username itself** (`admin`/`admin`, `teacher`/`teacher`) with a forced password change on first login. Set `OPENLEARN_SEED_PASSWORD_MODE=random` to get the old behavior (random value written once to `storage/bootstrap-credentials.txt`). Do not set `PLAYWRIGHT_TEST` in production. `TRUST_PROXY` defaults to off; set it explicitly behind a reverse proxy. The SQLite database is at `packages/core/db/educational_os.db`.

> 跑测试时如果 shell 里导出了 `BACKUP_DIR` / `OPENLEARN_DB_PATH`，请注意 `vitest.setup.ts` 会主动清除它们（防止测试把快照/数据写进真实目录）。这是预期行为，不是配置失效。

## Plugin Development

See [docs/tutorials/plugin-development-tutorial.md](docs/tutorials/plugin-development-tutorial.md) for the full guide. Plugins are ESM modules registered via the `@openlearn/plugin-sdk` types. Use the mock context from `@openlearn/plugin-test-kit` for isolated testing.

Documentation map (read the one that matches your goal; the whole tree is published at https://openlearn-next-v2.readthedocs.io/zh-cn/latest/):

| Goal                                          | Read                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Write a third-party plugin (server side)      | [tutorial](docs/tutorials/plugin-development-tutorial.md) → [manifest spec](docs/plugin/plugin-manifest-spec.md)                      |
| Add a frontend to a third-party plugin        | [frontend guide](docs/tutorials/plugin-frontend-guide.md) + [sandbox boundaries](docs/plugin/frontend-sandbox-capability-boundary.md) |
| Extend courseware / palette / segment types   | [courseware extensions](docs/tutorials/plugin-courseware-extensions.md)                                                               |
| Generate a project from scratch               | [scaffold CLI](docs/sdk/scaffold-cli.md)                                                                                              |
| Understand the kernel / plugin host internals | [docs/index.md](docs/index.md) → `architecture/`, `plugin/`                                                                           |
| Deploy or operate                             | [production guide](docs/deployment/production-guide.md)                                                                               |

> Do not trust an audit/report page inside `docs/` as current fact — they are dated snapshots (e.g. `docs/audit/AUDIT_REPORT.md` describes 0.6.0). Archived snapshots live in `docs/audit/`.

## Cursor Cloud specific instructions

- Install with Corepack pnpm `10.33.4` and `pnpm install --frozen-lockfile`. This is a pnpm workspace; `npm install` builds a second tree and skips the `better-sqlite3` build allow-list. Node 24 and `build-essential` are enough to compile that native module.
- `pnpm dev` listens on port 9000 (`GET /health`, `GET /health/ready`). The Cloud Agent start script points `OPENLEARN_DATA_DIR`, `OPENLEARN_DB_PATH`, `LOG_DIR`, and `BACKUP_DIR` at `$HOME/openlearn-data` so the dev database and `storage/encryption-key` stay outside the checkout. Vitest sets its own `ENCRYPTION_KEY`; a key file left in the repo `storage/` directory fails the suite with `EncryptionKeyMismatchError`.
- Seed usernames are `admin` and `teacher`, and their initial password equals the username (`must_change_password = 1`), so the login page can show a first-run hint from `GET /api/auth/seed-status` (public, read-only, reports only whether the default password is still active). With `OPENLEARN_SEED_PASSWORD_MODE=random` the generated password is written once to `$HOME/openlearn-data/storage/bootstrap-credentials.txt` instead. Staff login uses `entrance: "teacher"`. The first session must `POST /api/auth/change-password` (at least 8 characters, letters and numbers, different from the username) before other writes are accepted. Do not set `PLAYWRIGHT_TEST` outside Playwright.
- AI provider API keys are configured in the admin UI and are not required to boot, log in, manage classes, or run `pnpm lint`, `pnpm lint:strict`, and `pnpm test`.

## Security & Architecture Constraints

- **CSP & iframe sandboxing**: Interactive courseware runs in `<iframe>` instances with strict sandboxing (`sandbox="allow-scripts allow-forms allow-downloads"`) and no `allow-same-origin`.
- **Bridge SDK**: Because of the sandbox constraints, cross-origin communication requires the Bridge SDK. It uses `Object.defineProperty` and a JavaScript `Proxy` to intercept `.postMessage()` calls, normalizing `targetOrigin: 'null'` to `'*'` so that the courseware can communicate with the platform.
- **CSP frame-src**: The Express server's Helmet middleware enforces `frame-src` directives to govern where iframe content can be loaded from.
