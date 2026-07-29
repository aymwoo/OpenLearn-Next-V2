# Repository Guidelines

## Project Structure & Module Organization

```
├── server.ts              # Express + Socket.IO backend (API routes, AI agent, auth)
├── server/                # Server-side modules (from v5.0)
│   ├── middleware/        # Auth and security middleware
│   ├── routes/            # Express route handlers
│   └── utils/             # Server utilities
│       └── bridge-sdk.ts  # Bridge SDK Proxy for interactive courseware iframe sandboxes
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
│   ├── plugins/           # Built-in plugins (builtin, vfs, management, ai-planner, etc.)
│   └── mfe-*/             # Micro-frontend packages (whiteboard, courseware)
├── docs/                  # Architecture reports and plugin development tutorials
├── assets/                # Static resources (plugin ZIPs)
├── migrations/            # SQLite schema migrations
└── storage/               # Runtime file storage (courseware uploads)
```

## Build, Test, and Development Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server (Express + Vite HMR) on port 9000 |
| `pnpm build` | Vite frontend build → plugin build → esbuild server bundle |
| `pnpm start` | Run production server from `dist/server.cjs` |
| `pnpm lint` | TypeScript type check (`tsc --noEmit`) |
| `pnpm lint:eslint` | ESLint across all `.ts`/`.tsx` files |
| `pnpm format` | Prettier auto-format |
| `pnpm test` | Run Vitest test suite |

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
- **Config**: Defined in `vitest.config.ts` — file parallelism disabled to prevent SQLite write races; 60s timeout for integration tests
- **Plugin testing**: Use `createMockContext()` from `@openlearn/plugin-test-kit` to isolate plugin tests
- Run a subset with `pnpm vitest run -t "pattern"`

## Commit & Pull Request Guidelines

- **Commit format**: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): message`
- **Types used**: `feat`, `fix`, `docs`, `refactor`, `tool`, `test`
- **Scopes**: Component or domain — `plugin`, `kernel`, `worker`, `whiteboard`, `PluginCenter`, `db`, etc.
- **PR descriptions**: Describe what changed and why, link related issues, include screenshots for UI changes.

## Release & CHANGELOG Workflow

- **Keep a Changelog Standard**: All platform changes are recorded in [CHANGELOG.md](CHANGELOG.md) under SemVer headings (`## [X.Y.Z] - YYYY-MM-DD`) with standard subsections (`### Features`, `### Fixes`, `### Refactor / Performance`, `### Docs`, `### Breaking Changes`).
- **Unreleased Draft Buffer**: Maintain an `## [Unreleased]` section at the top of `CHANGELOG.md` during ongoing development. Move items to `## [X.Y.Z]` when cutting a release.
- **Version Alignment**: When releasing a new version, bump `"version"` in `package.json`, update `CHANGELOG.md`, and create a git tag `vX.Y.Z`.
- **Multi-tier Scope Boundaries**:
  - `CHANGELOG.md`: Platform host (`openlearn-next`).
  - `packages/plugin-sdk/CHANGELOG.md`: Plugin SDK types & DI tokens (`@openlearn/plugin-sdk`).
  - `v2_plugins/<plugin-id>/CHANGELOG.md`: Individual plugins (e.g. `@aymwoo/plugin-research-workflow`).

## Environment

Copy `.env.example` to `.env`. AI features are configured via **AI Providers** in the admin dashboard ("AI Provider Management") — `GEMINI_API_KEY` is optional and only used as a fallback. Default login: `admin/admin` (administrator) or `teacher/teacher` (teacher). The SQLite database is at `packages/core/db/educational_os.db`.

## Plugin Development

See [docs/plugin-development-tutorial.md](docs/plugin-development-tutorial.md) for the full guide. Plugins are ESM modules registered via the `@openlearn/plugin-sdk` types. Use the mock context from `@openlearn/plugin-test-kit` for isolated testing.

## Security & Architecture Constraints

- **CSP & iframe sandboxing**: Interactive courseware runs in `<iframe>` instances with strict sandboxing (`sandbox="allow-scripts allow-forms allow-downloads"`) and no `allow-same-origin`.
- **Bridge SDK**: Because of the sandbox constraints, cross-origin communication requires the Bridge SDK. It uses `Object.defineProperty` and a JavaScript `Proxy` to intercept `.postMessage()` calls, normalizing `targetOrigin: 'null'` to `'*'` so that the courseware can communicate with the platform.
- **CSP frame-src**: The Express server's Helmet middleware enforces `frame-src` directives to govern where iframe content can be loaded from.
