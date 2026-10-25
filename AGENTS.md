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
- **Types used**: `feat`, `fix`, `docs`, `refactor`, `tool`, `test`
- **Scopes**: Component or domain — `plugin`, `kernel`, `worker`, `whiteboard`, `PluginCenter`, `db`, etc.
- **PR descriptions**: Describe what changed and why, link related issues, include screenshots for UI changes.
- **AI agents must submit every change via a Pull Request (never push to `main`)**: This applies to all AI coding agents (CodeBuddy, Cursor, Copilot, etc.) working in this repository. For each change: create a dedicated branch (e.g. `codebuddy/<slug>` or `cursor/<slug>`), commit with the Conventional Commits format above, push the branch, then open a PR with `gh pr create` describing what changed, why, and a test plan (with screenshots for UI changes). Do **not** commit or `git push` directly to `main`/`master`, and do not merge your own PR unless a human explicitly asks you to.

## Release & CHANGELOG Workflow

- **Keep a Changelog Standard**: All platform changes are recorded in [CHANGELOG.md](CHANGELOG.md) under SemVer headings (`## [X.Y.Z] - YYYY-MM-DD`) with standard subsections (`### Features`, `### Fixes`, `### Refactor / Performance`, `### Docs`, `### Breaking Changes`).
- **Unreleased Draft Buffer**: Maintain an `## [Unreleased]` section at the top of `CHANGELOG.md` during ongoing development. Move items to `## [X.Y.Z]` when cutting a release.
- **Version Alignment**: When releasing a new version, bump `"version"` in `package.json`, update `CHANGELOG.md`, and create a git tag `vX.Y.Z`.
- **Multi-tier Scope Boundaries**:
  - `CHANGELOG.md`: Platform host (`openlearn-next`).
  - `packages/plugin-sdk/CHANGELOG.md`: Plugin SDK types & DI tokens (`@openlearn/plugin-sdk`).
  - `packages/plugins/<plugin-id>/CHANGELOG.md`: Individual built-in plugins (no `v2_plugins/` directory in this repo).

## Environment

**Node 版本：用 22（见 `.nvmrc`）**。`pnpm dev` / `pnpm test` / `pnpm test:e2e` 都请在同一版本上跑 —— 换主版本会连带触发两类问题：

1. **原生模块 ABI 不匹配**：`better-sqlite3` 是按主版本编译的（Node 22 → ABI 127、24 → 137、26 → 147）。换版本后不重编就会启动即崩，报 `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` 不匹配。修法：在当前 Node 下执行 `pnpm rebuild better-sqlite3`。
2. **Node 26 无法跑测试**：Node 26 内置了实验性的 Web Storage，`globalThis.localStorage` **存在但值为 `undefined`**（需要 `--localstorage-file` 才可用，否则访问会打 `ExperimentalWarning`）。vitest 的 jsdom 环境会跳过 Node 已经定义过的全局，于是留下那个坏掉的 `localStorage`，表现为大量用例报 `Cannot read properties of undefined (reading 'clear')`（实测：213 个测试文件 / 298 条用例全红；换回 22 或 24 即恢复）。

CI 也钉在 `node-version: 22`，本地对齐它就是对齐合并门禁。

Copy `.env.example` to `.env`. AI features are configured via **AI Providers** in the admin dashboard ("AI Provider Management") with any OpenAI-compatible model provider (such as DeepSeek, Qwen, Ollama, OpenAI, etc.). Seed usernames are `admin` (administrator) and `teacher` (teacher); passwords come from `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD` or a one-time random value in `storage/bootstrap-credentials.txt`. Do not set `PLAYWRIGHT_TEST` in production. `TRUST_PROXY` defaults to off; set it explicitly behind a reverse proxy. The SQLite database is at `packages/core/db/educational_os.db`.

> 跑测试时如果 shell 里导出了 `BACKUP_DIR` / `OPENLEARN_DB_PATH`，请注意 `vitest.setup.ts` 会主动清除它们（防止测试把快照/数据写进真实目录）。这是预期行为，不是配置失效。

## Plugin Development

See [docs/plugin-development-tutorial.md](docs/plugin-development-tutorial.md) for the full guide. Plugins are ESM modules registered via the `@openlearn/plugin-sdk` types. Use the mock context from `@openlearn/plugin-test-kit` for isolated testing.

## Cursor Cloud specific instructions

- Install with Corepack pnpm `10.33.4` and `pnpm install --frozen-lockfile`. This is a pnpm workspace; `npm install` builds a second tree and skips the `better-sqlite3` build allow-list. Node 22 and `build-essential` are enough to compile that native module.
- `pnpm dev` listens on port 9000 (`GET /health`, `GET /health/ready`). The Cloud Agent start script points `OPENLEARN_DATA_DIR`, `OPENLEARN_DB_PATH`, `LOG_DIR`, and `BACKUP_DIR` at `$HOME/openlearn-data` so the dev database and `storage/encryption-key` stay outside the checkout. Vitest sets its own `ENCRYPTION_KEY`; a key file left in the repo `storage/` directory fails the suite with `EncryptionKeyMismatchError`.
- Seed usernames are `admin` and `teacher`. When those passwords are generated, they are written once to `$HOME/openlearn-data/storage/bootstrap-credentials.txt` and `must_change_password` is set. Staff login uses `entrance: "teacher"`. The first session must `POST /api/auth/change-password` (at least 8 characters, letters and numbers, different from the username) before other writes are accepted. Do not set `PLAYWRIGHT_TEST` outside Playwright.
- AI provider API keys are configured in the admin UI and are not required to boot, log in, manage classes, or run `pnpm lint`, `pnpm lint:strict`, and `pnpm test`.

## Security & Architecture Constraints

- **CSP & iframe sandboxing**: Interactive courseware runs in `<iframe>` instances with strict sandboxing (`sandbox="allow-scripts allow-forms allow-downloads"`) and no `allow-same-origin`.
- **Bridge SDK**: Because of the sandbox constraints, cross-origin communication requires the Bridge SDK. It uses `Object.defineProperty` and a JavaScript `Proxy` to intercept `.postMessage()` calls, normalizing `targetOrigin: 'null'` to `'*'` so that the courseware can communicate with the platform.
- **CSP frame-src**: The Express server's Helmet middleware enforces `frame-src` directives to govern where iframe content can be loaded from.
