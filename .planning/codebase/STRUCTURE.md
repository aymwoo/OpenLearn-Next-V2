# Codebase Structure

**Analysis Date:** 2026-06-17

## Directory Layout

```
openlearnv2/
├── server.ts                          # Backend entry: Express + Socket.IO + API routes (5008 lines)
├── vite.config.ts                     # Vite 6 config: React plugin, TailwindCSS, @/ alias
├── tsconfig.json                      # TypeScript 5.8 config: ES2022, bundler resolution, @/* paths
├── package.json                       # Dependencies & scripts (dev/build/start/lint)
├── pnpm-lock.yaml                     # pnpm lockfile
├── package-lock.json                  # npm lockfile (dual package manager)
├── pnpm-workspace.yaml                # pnpm workspace config
├── metadata.json                      # Project metadata
├── CLAUDE.md                          # Developer guide for AI tools
├── README.md                          # Project readme
├── AI_Courseware_Runtime_Prompt.md    # AI prompt for courseware runtime
├── src/                               # Frontend source
│   ├── main.tsx                       # React entry point (renders App into #root)
│   ├── App.tsx                        # Main SPA component (11159 lines, all UI + business logic)
│   ├── i18n.ts                        # Chinese/English translations (~150 entries)
│   ├── index.css                      # Global styles
│   └── components/                    # React sub-components
│       ├── InteractiveWhiteboard.tsx   # Konva-based interactive whiteboard (4174 lines)
│       ├── TimetableManager.tsx        # Weekly timetable scheduling (2627 lines)
│       ├── LiveClassroomView.tsx       # Live classroom interactive view (1434 lines)
│       ├── AdminPanel.tsx             # Administrator panel (995 lines)
│       ├── SemesterGradeManager.tsx    # Semester grade management (873 lines)
│       ├── ClassAttendanceSummaryChart.tsx  # Attendance summary chart (635 lines)
│       ├── SemesterGradeTrendChart.tsx      # Grade trend chart (508 lines)
│       ├── StudentPrivateNotesEditor.tsx    # Student private notes (500 lines)
│       ├── StudentGradedTimeline.tsx        # Grade timeline visualization (490 lines)
│       ├── QuickActionsMenu.tsx             # Quick action buttons (483 lines)
│       ├── StudentCompareGrowthChart.tsx    # Growth comparison chart (466 lines)
│       ├── AcademicGrowthTrajectoryChart.tsx # Growth trajectory chart (425 lines)
│       ├── ComputerLabManager.tsx           # Computer lab seating (392 lines)
│       ├── RecentThreeMonthsPerformanceChart.tsx # 3-month performance (325 lines)
│       ├── RollCallHistoryStatsChart.tsx         # Roll call stats (327 lines)
│       ├── LoginPage.tsx                        # Login form (318 lines)
│       ├── ScheduledLessonsProgressChart.tsx     # Progress chart (286 lines)
│       ├── CountdownTimer.tsx                   # Countdown timer widget (94 lines)
│       └── InteractiveCoursewareViewer.tsx      # Courseware player (85 lines)
├── packages/                          # OS Kernel + built-in plugins
│   ├── core/                          # Kernel subsystems
│   │   ├── kernel/index.ts            # Kernel container (singleton, assembles 6 subsystems)
│   │   ├── command-bus/index.ts       # CommandBus (register handler, execute with interceptor)
│   │   ├── event-bus/index.ts         # EventBus (publish/subscribe with wildcard support)
│   │   ├── registry/index.ts          # ActionRegistry (AI tool discovery, JSON Schema output)
│   │   ├── capability-system/index.ts # CapabilityGuard (capability-based RBAC)
│   │   ├── plugin-runtime/index.ts    # PluginRuntime (VM sandbox, install/activate/deactivate)
│   │   ├── process-manager/index.ts   # ProcessManager (spawn/kill/list/logs + intervals)
│   │   ├── db/index.ts                # SQLite init: 30+ tables, default users, AI providers
│   │   └── db/educational_os.db       # SQLite database file (gitignored, created at runtime)
│   └── plugins/                       # Built-in plugins (command handlers + action registrations)
│       ├── builtin.ts                 # Lesson CRUD, whiteboard, quiz, courseware, plugin install (1268 lines)
│       ├── management.ts              # Class, student, assignment, schedule, attendance CRUD (882 lines)
│       ├── vfs.ts                     # Virtual filesystem: write, read, list, mkdir (175 lines)
│       ├── process.ts                 # Process management: spawn, kill, list, logs (123 lines)
│       ├── ai-planner.ts              # AI planner background tasks + high-risk approval (182 lines)
│       └── ai-submit-injector.ts      # AI-powered courseware score submission injector (93 lines)
├── assets/                            # Static bundled assets
│   ├── .aistudio/                     # AI Studio configuration
│   ├── ext-countdown-timer.zip        # Pre-built Countdown Timer plugin
│   └── ext-grading-assistant.zip      # Pre-built Grading Assistant plugin
├── dist/                              # Production build output (Vite frontend + esbuild server)
│   ├── assets/                        # Vite-built frontend assets
│   ├── index.html                     # SPA entry HTML
│   └── server.cjs                     # Bundled server (esbuild output)
├── storage/                           # Runtime file storage
│   └── courseware/                    # Uploaded courseware files (HTML/ZIP extracted)
│       └── <uuid>/                    # Per-courseware directory
├── scratch/                           # Temporary scripts and experiments
│   └── countdown-timer-plugin/        # Scratch workspace for countdown timer plugin dev
├── artifacts/                         # Build artifacts
├── .claude/                           # Claude Code configuration
└── .planning/codebase/                # Codebase documentation (this directory)
```

## Directory Purposes

**`src/`:**
- Purpose: Frontend SPA source code
- Contains: React components, i18n translations, CSS styles
- Key files: `App.tsx` (monolith component), `main.tsx` (entry), `i18n.ts` (translations)

**`src/components/`:**
- Purpose: React sub-components extracted from App.tsx
- Contains: 19 component files (85 to 4174 lines each)
- Key files: `InteractiveWhiteboard.tsx` (4174 lines, Konva canvas), `LiveClassroomView.tsx` (1434 lines), `TimetableManager.tsx` (2627 lines), `AdminPanel.tsx` (995 lines)

**`packages/core/`:**
- Purpose: OS kernel subsystems (the "kernel")
- Contains: 8 TypeScript modules, each a single `index.ts` per subsystem
- Key files: `kernel/index.ts` (assembles all subsystems), `db/index.ts` (schema initialization)

**`packages/plugins/`:**
- Purpose: Built-in plugins that register command handlers and actions
- Contains: 6 plugin bootstrap files, each exports a `bootstrap*Plugins()` function
- Key files: `builtin.ts` (core operations), `management.ts` (class/student management)

**`assets/`:**
- Purpose: Pre-built distributable assets (plugin zip packages)
- Contains: `.zip` files for Countdown Timer and Grading Assistant plugins
- Key files: `ext-countdown-timer.zip`, `ext-grading-assistant.zip`

**`dist/`:**
- Purpose: Production build output
- Contains: Vite-built frontend assets + esbuild-bundled server
- Key files: `server.cjs` (production server bundle)

**`storage/`:**
- Purpose: Runtime file data (separate from SQLite database)
- Contains: Courseware HTML/ZIP extracted files under `courseware/<uuid>/`
- Key files: Courseware content served at `/runtime/:uuid/`

**`scratch/`:**
- Purpose: Temporary development workspace, experiments
- Contains: Countdown timer plugin development workspace, build scripts
- Key files: `build_countdown_timer_zip.mjs` (zip packaging script)

## Key File Locations

**Entry Points:**
- `server.ts`: Backend server entry (Express + Socket.IO + all routes + Vite middleware) — run via `tsx server.ts`
- `src/main.tsx`: Frontend React entry — renders `<App />` into `#root`
- `src/App.tsx`: Main SPA component with all business logic, routing, and UI

**Configuration:**
- `package.json`: Scripts (`dev`, `build`, `start`, `lint`, `clean`) and dependencies
- `tsconfig.json`: TypeScript config with `@/*` path alias, ES2022 target, bundler module resolution
- `vite.config.ts`: Vite config with React plugin, TailwindCSS plugin, HMR settings
- `pnpm-workspace.yaml`: pnpm workspace definition

**Core Logic:**
- `packages/core/kernel/index.ts`: Kernel singleton (`kernelContainer`) — assembles all subsystems
- `packages/core/command-bus/index.ts`: Command execution pipeline with interceptor support
- `packages/core/event-bus/index.ts`: Publish/subscribe with wildcard matching
- `packages/core/plugin-runtime/index.ts`: VM sandbox plugin lifecycle management
- `packages/core/db/index.ts`: SQLite initialization (30+ tables, default data seeding)

**Plugin Logic:**
- `packages/plugins/builtin.ts`: Lesson, whiteboard, quiz, courseware, plugin management commands
- `packages/plugins/management.ts`: Class, student, assignment, schedule, attendance commands
- `packages/plugins/vfs.ts`: Virtual file system commands
- `packages/plugins/process.ts`: Process management commands
- `packages/plugins/ai-planner.ts`: AI background generation + high-risk approval flow
- `packages/plugins/ai-submit-injector.ts`: AI-powered courseware LMS SDK injection

**Testing:** Not detected — no test files, no test configuration, no test runner defined.

## Naming Conventions

**Files:**
- Backend modules: Single `index.ts` per subsystem, named by subsystem purpose (`command-bus/`, `event-bus/`)
- Plugin files: Named by domain area (`builtin.ts`, `management.ts`, `vfs.ts`)
- Frontend components: PascalCase `.tsx` files (`InteractiveWhiteboard.tsx`, `LiveClassroomView.tsx`)
- Bootstrap functions: `bootstrap<Name>Plugins()` pattern

**Command/Action Names:**
- Namespaced with dots: `<domain>.<verb>` (e.g., `lesson.create`, `vfs.write_file`, `process.spawn`)
- Event names: Past-tense, same namespace: `lesson.created`, `vfs.file_written`, `process.spawned`

**Directories:**
- Flat within `packages/core/` — one subdirectory per subsystem
- Flat within `packages/plugins/` — one file per plugin group
- Flat within `src/components/` — all components at same level, no subdirectories

**Functions/Variables:**
- camelCase for functions and variables (`createLesson`, `getCookieToken`, `checkIsTeacherOrAdmin`)
- PascalCase for classes and React components (`CommandBus`, `InteractiveWhiteboard`)
- TypeScript interfaces/types prefixed with `Platform` or domain name (`PlatformCommand`, `ActionDescriptor`)

## Where to Add New Code

**New Built-in Plugin:**
- Create `packages/plugins/<domain>.ts` exporting a `bootstrap<Domain>Plugins()` function
- Import and call in `server.ts` alongside existing bootstrap calls (around line 56-60)
- The function should: access `kernelContainer` destructured subsystems, call `actionRegistry.register()` and `commandBus.registerHandler()`

**New Kernel Subsystem:**
- Create `packages/core/<subsystem>/index.ts` exporting the class
- Import and instantiate in `packages/core/kernel/index.ts` `Kernel` constructor
- Expose as public readonly property on Kernel

**New Frontend Component:**
- Create `src/components/<ComponentName>.tsx` as a React functional component
- Import in `src/App.tsx` and use conditionally based on `teacherTab` value (for teacher views) or `studentViewStatus` (for student views)

**New API Route:**
- Add `app.<method>('/api/<path>', async (req, res) => { ... })` in `server.ts` in the `startServer()` function
- For mutable operations, consider going through `kernelContainer.commandBus.execute()` to get capability checks and audit logging
- For read operations, direct `kernelContainer.db.prepare(...)` is acceptable

**New AI Agent Tool:**
- In a plugin file, call `actionRegistry.register({ id, commandType, description, inputSchema, capabilityRequired, isHighRisk? })`
- Call `commandBus.registerHandler(commandType, { execute: async (command) => { ... } })`
- The tool is automatically exposed to AI Agent via `actionRegistry.getAgentTools()` called during chat

**Tests:**
- No test infrastructure exists. To add tests: create `tests/` or `__tests__/` directory, add test framework to `package.json` devDependencies, add test runner config (jest.config.ts / vitest.config.ts), add `test` script to `package.json`

## Special Directories

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (via pnpm/npm install)
- Committed: No

**`dist/`:**
- Purpose: Production build output
- Generated: Yes (via `npm run build` — Vite + esbuild)
- Committed: No

**`storage/courseware/`:**
- Purpose: Uploaded courseware files served at `/runtime/:uuid/`
- Generated: Yes (at runtime when courseware is uploaded)
- Committed: No (gitignored)

**`packages/core/db/educational_os.db`:**
- Purpose: SQLite database file
- Generated: Yes (at first server startup via `db/index.ts`)
- Committed: No (gitignored)

**`scratch/`:**
- Purpose: Temporary scripts and experiments
- Generated: Partially (manual development workspace)
- Committed: Not committed (gitignored)

**`.planning/codebase/`:**
- Purpose: Codebase analysis documentation for GSD workflow
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes (for reference by plan and execute phases)

---

*Structure analysis: 2026-06-17*
