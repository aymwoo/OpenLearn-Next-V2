# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

OpenLearnV2 是一个教育操作系统（Educational OS / LMS）平台。基于"OS 内核"设计理念：一个插件驱动的命令-事件总线架构，AI Agent 作为 Shell 控制器，通过调用工具命令来完成教学管理操作。

## 常用命令

```bash
# 开发（启动服务器 + Vite HMR，端口 9000）
npm run dev

# TypeScript 类型检查
npm run lint

# 生产构建（Vite 构建前端 + esbuild 打包 server.ts → dist/server.cjs）
npm run build

# 生产运行
npm start

# 清理构建产物
npm run clean
```

环境要求：在 `.env.local` 或 `.env` 中配置 `GEMINI_API_KEY`（默认 AI 服务）。也可在管理后台配置第三方 AI 提供商。

## 技术栈

- **前端**：React 19, Vite 6, TailwindCSS 4, TypeScript 5.8
- **后端**：Express 4, better-sqlite3, tsx（开发运行时）, esbuild（生产打包）
- **实时通信**：Socket.IO（WebSocket）
- **AI 集成**：`@google/genai` SDK + OpenAI 兼容 API
- **关键库**：konva/react-konva（交互白板）, recharts（图表）, jspdf（PDF导出）, zustand（状态管理）, react-markdown, jszip, reveal.js, lucide-react, motion

## 项目结构

```
├── server.ts              # 后端入口：Express + Socket.IO + API 路由（5000+ 行）
├── src/
│   ├── App.tsx            # 前端主组件（大单体，包含所有业务逻辑和 UI）
│   ├── main.tsx           # React 入口
│   ├── i18n.ts            # 中英文翻译
│   └── components/        # 子组件（白板、课件查看器、图表等）
├── packages/
│   ├── core/              # OS 内核子系统
│   │   ├── kernel/        # 内核容器：组装各子系统，拦截器处理权限和高危审批
│   │   ├── command-bus/   # 命令总线：注册 handler，执行命令
│   │   ├── event-bus/     # 事件总线：发布/订阅
│   │   ├── registry/      # Action 注册表：供 AI Agent 发现可用工具
│   │   ├── capability-system/  # 权限守卫
│   │   ├── plugin-runtime/     # 插件运行时：VM 沙箱加载/卸载插件
│   │   ├── process-manager/    # 进程管理器（定时器、后台任务）
│   │   └── db/            # SQLite 数据库初始化（30+ 表）
│   └── plugins/           # 内置插件
│       ├── builtin.ts     # 课程、白板、课件、插件安装等核心命令
│       ├── vfs.ts         # 虚拟文件系统（vfs.write_file, vfs.read_file 等）
│       ├── process.ts     # 进程管理（spawn, kill, list, logs）
│       ├── management.ts  # 班级、学生、作业、排课、考勤等管理命令
│       ├── ai-planner.ts  # AI 自动规划器（后台任务 + 高危审批）
│       └── ai-submit-injector.ts  # 自动提分 SDK 注入器
├── assets/                # 静态资源（插件 zip 等）
├── scratch/               # 临时脚本/实验
└── storage/               # 课件文件存储（运行时生成）
```

## 核心架构

### 内核设计

`kernelContainer` 是全局单例，组装了 6 个核心子系统：

1. **EventBus** — 发布/订阅事件，所有事件自动写入 SQLite 审计日志
2. **CommandBus** — 命令执行管线。注册 handler → 执行命令。内置拦截器做权限检查和高危操作审批
3. **ActionRegistry** — 注册可被 AI Agent 调用的工具。每个 action 有 commandType、description、inputSchema
4. **CapabilityGuard** — 基于字符串能力的权限控制（如 `lesson:write`, `management:read`）
5. **PluginRuntime** — 使用 Node.js `vm` 模块在沙箱中加载第三方插件。插件通过包装器访问内核 API
6. **ProcessManager** — 管理后台进程和定时任务

### 插件系统

插件是 JavaScript 字符串，存储在 SQLite 的 `plugins` 表中。格式：

```js
exports.default = {
  manifest: { id, name, version, capabilitiesProposed, classroomTools },
  activate: async (ctx) => {
    // ctx 包含安全包装的：commandBus, eventBus, actionRegistry, processManager, storage, ai, console
    ctx.actionRegistry.register({ ... });
    ctx.commandBus.registerHandler('command.type', { execute: async (cmd) => { ... } });
  }
}
```

插件通过 `vm.createContext` 沙箱执行，所有内核 API 都经过包装器保护（冻结原型链、超时限制、演员身份绑定）。

### AI Agent 流程

1. 前端发送聊天消息 → `POST /api/agent/chat`
2. 服务端根据选择的 AI 提供商，调用 Gemini 或 OpenAI 兼容 API
3. AI 返回 functionCall → 通过 CommandBus 执行对应 action
4. 工具执行结果返回给 AI → AI 继续思考或产出最终回复
5. 最多循环 5 轮

`systemInstruction` 定义了 AI 的角色（教育 OS 内核助手）和可用工具的引导。

### 数据库

SQLite (`better-sqlite3`)，文件位于 `packages/core/db/educational_os.db`。表包括：lessons, whiteboard_elements, plugins, classes, students, assignments, schedules, attendance, courseware, courseware_attempt, submission_raw, submission_result, users, client_sessions, ai_providers, exams, exam_scores, student_semester_reports 等 30+ 张表。

默认用户：admin/admin（administrator）, teacher/teacher（teacher）。

### 登录与权限

基于 Cookie 的 Session 认证（`edu_os_token`）。角色：`student`, `teacher`, `administrator`。`checkIsTeacherOrAdmin()` 用于保护 API 端点。admin 角色在执行 AI Agent 工具调用时会自动绕过高危审批。

### WebSocket（Socket.IO）

用于实时推送：
- `courseware-attempt-updated` — 课件提交更新
- `student-progress-updated` — 学生进度更新
- `assignment-graded-toast` — 作业批改通知
- `student-picked` — 随机点名结果
- `presence-update` — 在线学生状态
- `whiteboard-sync` — 白板同步
- `student-active-segment-changed` — 课堂环节切换

### 课件系统

支持上传 HTML 文件或 ZIP 包。上传后自动注入 LMS SDK（`bridge.js` + `injectLmsSdk`），使第三方课件能通过 `window.LMS.submit()` 提交成绩。同时自动检测是否有成绩显示但没有提交逻辑，通过 AI 修改 HTML 创建 `[自动提交版]`。

课件运行时通过 `/runtime/:uuid/` 路径访问，文件存储在 `storage/courseware/<uuid>/`。

### 白板系统

每个课程有一个交互式白板，基于 Konva 实现。创建课程时自动拍快照（`snapshot-<lessonId>`），支持重置到初始状态。元素通过 `whiteboard_elements` 表持久化。

### 前端架构

`App.tsx` 是主组件（非常大），包含所有业务逻辑和 UI。通过 Tab/面板切换展示不同功能：课程管理、白板、班级/学生管理、排课、考勤、作业批改、图表分析、课件查看、插件中心、管理面板等。使用 zustand 管理少量状态，大部分数据通过 REST API 获取。

<!-- GSD:project-start source:PROJECT.md -->
## Project

**OpenLearnV2 — 插件系统重构**

OpenLearnV2 是一个教育操作系统（Educational OS / LMS）平台，采用插件驱动的命令-事件总线架构。本项目对其进行插件系统重构，从当前基于 Node.js `vm` 模块的沙箱执行方案，迁移到基于 Blob URL + `import()` 的动态 ESM 模块导入方案，参考 JupyterLab 插件系统架构设计。

目标用户：教育科技开发者，能够为平台编写和分发 TypeScript/JavaScript 插件来扩展教学功能。

**Core Value:** **一个类型安全、跨运行时（浏览器/Node.js）、支持依赖注入和热重载的插件执行环境**，使第三方开发者能像写 ESM 模块一样自然地为平台编写插件。

### Constraints

- **兼容性**：现有 REST API 和前端 UI 尽量不改动，插件系统重构对上层透明 — 降低变更风险，聚焦核心目标
- **运行时**：必须同时支持 Node.js（>=20）和现代浏览器 — 用户明确要求双运行时
- **安全性**：Worker Thread 隔离替代 vm 沙箱 — 不能降低现有安全水平
- **类型安全**：新系统应充分利用 TypeScript 泛型和 Token 类型推导 — 提升插件开发体验
- **数据库**：继续使用现有 SQLite 存储插件元数据和持久化数据 — 不引入新数据库
- **渐进式**：支持新旧插件系统并行运行过渡期 — 允许逐步迁移
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.8 - Entire project (frontend and backend), type-checked with `tsc --noEmit`
- Target: ES2022; module: ESNext; moduleResolution: bundler
- HTML - Entry point `index.html`
- CSS - TailwindCSS 4 utility classes; index.css for base styles
## Runtime
- Node.js (ES modules, `"type": "module"` in `package.json`)
- Development: `tsx` runs `server.ts` directly (ESM, on-the-fly TypeScript transpilation)
- Production: `node dist/server.cjs` (CommonJS bundle produced by esbuild)
- pnpm (primary, `pnpm-workspace.yaml` present with workspace configuration)
- npm (secondary, `package-lock.json` present)
- Lockfile: `pnpm-lock.yaml` (148KB) and `package-lock.json` (249KB)
## Frameworks
- Express 4.21 - HTTP server framework, drives the entire REST API in `server.ts`
- React 19.0 - Frontend UI framework, single-page app
- Vite 6.2 - Frontend dev server (HMR) and production bundler, configured via `vite.config.ts`
- TailwindCSS 4.1 - Utility-first CSS framework, used via `@tailwindcss/vite` Vite plugin
- 未检测到测试框架。项目中未发现 `jest`、`vitest`、`mocha` 等测试依赖，也没有测试文件（无 `*.test.*` 或 `*.spec.*` 文件）。
- esbuild 0.25 - Production bundler for server code (`server.ts` to `dist/server.cjs`)
- tsx 4.21 - Development runtime for TypeScript (ESM transpilation on the fly)
- autoprefixer 10.4 - PostCSS plugin for CSS vendor prefixes (bundled with TailwindCSS)
- `@vitejs/plugin-react` 5.0 - Vite plugin for React Fast Refresh and JSX transforms
## Key Dependencies
- `@google/genai` 2.8 - Google Generative AI SDK, used for Gemini model calls (`gemini-3.5-flash`, `gemini-2.5-flash`)
- `better-sqlite3` 12.10 - Synchronous SQLite3 driver for Node.js; stores all persistent data in `packages/core/db/educational_os.db`
- `socket.io` 4.8 + `socket.io-client` 4.8 - WebSocket real-time communication (server + client)
- `zustand` 5.0 - Lightweight React state management library
- `dotenv` 17.2 - Environment variable loading from `.env` files
- `konva` 10.3 + `react-konva` 19.2 - HTML5 Canvas 2D rendering for the interactive whiteboard
- `react-konva-utils` 2.0 - Utility helpers for react-konva
- `recharts` 3.8 - Charting library for statistical visualizations (academic performance, attendance)
- `reveal.js` 6.0 + `@types/reveal.js` 5.2 - Web-based presentation framework for slideshow-style courseware
- `motion` 12.23 - Animation library (formerly Framer Motion)
- `lucide-react` 0.546 - Icon library
- `jspdf` 4.2 + `jspdf-autotable` 5.0 - Client-side PDF generation (reports, score exports)
- `jszip` 3.10 - ZIP archive creation/reading (courseware packaging, plugin packaging)
- `pptx-preview` 1.0 - PowerPoint file preview (uploaded teaching materials)
- `react-markdown` 10.1 - Markdown rendering for AI responses and lesson content
- `uuid` 14.0 - Unique ID generation
- `@types/better-sqlite3` 7.6
- `@types/express` 4.17
- `@types/node` 22.14
- `@types/uuid` 10.0
## Configuration
- Config: `tsconfig.json`
- Key settings: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, path alias `@/*` maps to `./*`
- Config: `vite.config.ts`
- Plugins: `@vitejs/plugin-react` (React Fast Refresh), `@tailwindcss/vite` (Tailwind CSS 4 integration)
- Path alias: `@` maps to project root
- HMR disabled via `DISABLE_HMR` env var (for AI Studio compatibility)
- Config: `pnpm-workspace.yaml`
- Key setting: Allows native builds for `@google/genai`, `better-sqlite3`, `core-js`, `esbuild`, `protobufjs`
- `.env.example` 文件存在 — 定义两个必需变量:
- 开发模式：根目录放置 `.env` 文件（`dotenv` 自动加载）
- 生产模式：AI Studio 运行时环境自动注入
## Platform Requirements
- Node.js (支持 ES2022 modules)
- pnpm 或 npm
- 有效的 GEMINI_API_KEY（或配置第三方 AI 提供商）
- AI Studio 平台（Google Cloud Run 部署）
- Metadata config `metadata.json` 声明 `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` 能力
- 构建流程：`vite build`（前端）+ `esbuild server.ts --bundle --platform=node --format=cjs --packages=external`（后端）
- `packages/external` 标志确保 `better-sqlite3` 等原生模块不被打包，由生产环境的 `node_modules` 提供
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Server-side packages use kebab-case directories with `index.ts` barrel files: `packages/core/command-bus/index.ts`, `packages/core/plugin-runtime/index.ts`
- Plugin modules use lowercase with hyphens: `packages/plugins/builtin.ts`, `packages/plugins/ai-planner.ts`, `packages/plugins/ai-submit-injector.ts`
- Frontend components use PascalCase: `src/components/InteractiveWhiteboard.tsx`, `src/components/LiveClassroomView.tsx`, `src/components/StudentGradedTimeline.tsx`
- The main app file is `src/App.tsx` (PascalCase)
- Utility/config files use lowercase: `src/i18n.ts`, `vite.config.ts`, `server.ts`
- Bootstrap functions for plugin registration: `bootstrapBuiltinPlugins()`, `bootstrapVFSPlugins()`, `bootstrapManagementPlugins()`
- Handler execute methods: `async execute(command) { ... }` (lowercase, object method)
- Components use `export default function App()` or `export function InteractiveWhiteboard(...)`
- Helper functions use camelCase: `copyFolderSync()`, `resolvePath()`, `hashPassword()`, `parsePluginSource()`
- Callback-style inline functions use arrow functions extensively: `async (command) => { ... }`
- camelCase for local variables and state: `selectedStudent`, `isActive`, `socketRef`
- PascalCase for component names and React refs: `Socket`, `Markdown`
- State-updater pairs follow the `[value, setValue]` convention: `const [lang, setLang] = useState<Language>('zh')`
- Database references use short names: `db`, `stmt`, `cmd`
- Plugin entity IDs use snake_case pattern: `usr_admin`, `prov_deepseek`, `ext-quiz-generator`
- Command types use dot-separated namespacing: `lesson.create`, `whiteboard.draw`, `vfs.write_file`, `ai.start_generation`
- Interfaces are PascalCase: `PlatformCommand`, `CommandHandler`, `ActionDescriptor`, `PluginRegistration`
- Type aliases are PascalCase: `ProcessHandler`, `EventSubscriber`, `VFSNode`, `Lesson`, `AgentChatAttachment`
- Props interfaces add "Props" suffix: `InteractiveWhiteboardProps`, `AnimatedCounterProps`
- Generic type parameter is `T` everywhere
- Discriminated unions are rare; `any` type is used heavily instead
- UPPER_SNAKE_CASE for configuration: `DEFAULT_PLUGIN`, `AGENT_PROVIDER_STORAGE_KEY`, `CAPABILITY_INFO`
- Enum-like lookup objects as `const` records: `translations` (zh/en keyed object)
## Code Style
- No formatter detected (no `.prettierrc`, `eslint.config.*`, or `biome.json` files exist)
- Inconsistent spacing patterns observed: some files use 1-space indentation (`builtin.ts`), others 2-space (`App.tsx`, `server.ts`), others mixed
- No auto-formatting pipeline in the build process
- No ESLint or Biome configuration files exist
- The `lint` script runs `tsc --noEmit` only (pure type checking)
- TypeScript strict mode is NOT enabled (no `"strict": true` in `tsconfig.json`)
- `target`: ES2022
- `module`: ESNext
- `moduleResolution`: bundler
- `jsx`: react-jsx
- `skipLibCheck`: true (library type checking skipped)
- `isolatedModules`: true
- `allowJs`: true
- `noEmit`: true
- Path alias `@/*` maps to `./*` but is not used in the codebase — relative imports are used everywhere instead
## Import Organization
- Frontend (`src/`): relative imports without `.tsx` extension: `from './components/InteractiveWhiteboard'`
- Backend (`packages/` and `server.ts`): relative imports WITH `.js` extension (for ESM compatibility): `from '../core/kernel/index.js'`
- The `@/*` alias is defined in tsconfig/Vite but unused in practice
## Error Handling
- Error types are universally typed as `any` — no structured error hierarchy
- No custom error classes exist in the codebase
- Console logging is the primary error reporting mechanism — no structured logging framework
- No error tracking/alerting integration
- Database errors bubble up as generic strings through `err.message`
## Logging
- Backend: Tagged with subsystem prefix: `[CommandBus]`, `[Plugin:<id>]`, `[AI Planner]`
- `server.ts`: Start/stop messages at the top level, route-level errors via `console.error`
- Some `console.error` calls log error objects directly; others use string interpolation
- No log levels, no structured JSON logging, no log rotation
- `kernelContainer.initAuditLog()` writes all events to the `events` SQLite table
- Process logs are stored in `processes.logs` as appended text
- No external log file or stdout capture
- Error swallowing in `plugin-runtime/index.ts` clean-up code: `try { ... } catch {}` (empty catch block)
- Inconsistent tag formats: some use `[Plugin:X]`, others use raw strings
## Comments
- Section headers in large files: `// 1. LESSON HANDLER`, `// 2. WHITEBOARD HANDLER`, `// --- COURSEWARE UPLOAD HANDLER ---`
- Inline explanations for non-obvious logic: `// Safely replace non-word chars with underscore for function names`
- Business logic clarification: `// When the caller is an administrator, elevate the agent to superadmin`
- Very sparse overall — most code relies on self-documenting naming
- Not used anywhere in the codebase
- No `@param`, `@returns`, or `@throws` annotations
## Function Design
- Backend plugin registration functions are moderately sized (50-200 lines per handler)
- `bootstrapBuiltinPlugins()` is 1268 lines — a single function registering 15+ handlers
- `App()` component is 9600+ lines with 160+ `useState` hooks — the largest function in the codebase
- Sub-components in `src/components/` range from 200 to 2600 lines
- Command handlers always receive a single `command` parameter with typed payload
- Plugin activate functions receive a single `ctx` context object
- React component props are destructured inline
- Command handlers return arbitrary objects or void: `Promise<void | any>`
- REST endpoints return `{ success: true, result }` or `{ success: false, error: message }`
- Some routes return raw data without wrapper: `res.json(rows)`
## Module Design
- Core modules export a named class and a singleton instance: `export class Kernel` + `export const kernelContainer = new Kernel()`
- Plugin modules export a single bootstrap function: `export function bootstrapBuiltinPlugins()`
- Frontend components use default export: `export default function App()`
- Types are exported using `export interface` / `export type` inline
- Every `packages/core/*/` directory has an `index.ts` barrel file
- No barrel files in `src/` — components imported directly by name
## Code Organization
- `server.ts` (5008 lines): Express routes, middleware, AI agent chat, courseware runtime, bridge.js, OCR endpoints — everything in one file
- `src/App.tsx` (11159 lines): All business logic, UI rendering, data fetching, state management, plugin preview, CSV parsing — everything in one component
- `packages/core/`: Cleanly separated by subsystem (command-bus, event-bus, registry, etc.)
- `packages/plugins/`: Each plugin file handles one domain (builtin, vfs, management, etc.)
- Frontend: React `useState` (160+ instantiations in App.tsx) and `useRef` — no zustand usage detected despite being a dependency
- Backend: Kernel singleton with in-memory Maps for handlers/subscribers/registrations
- Database: SQLite via `better-sqlite3` synchronous API — no ORM, raw SQL throughout
## API Design Patterns
- Imperative verb-noun format with namespacing: `lesson.create`, `whiteboard.draw`, `vfs.write_file`, `plugin.install_zip`
- Events use past tense: `lesson.created`, `whiteboard.element_drawn`, `user.updated`
- Manual route-by-route registration: `app.post('/api/agent/chat', ...)`
- Response wrapper: `{ success: true, result }` or `{ success: false, error: message }` — but inconsistent across routes
- No middleware-based validation (Joi/Zod) — manual checks in route handlers
- No authentication middleware abstraction — session cookie parsing is duplicated in each route
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| Kernel | Global singleton container, assembles all 6 subsystems, sets up interceptor pipeline for capability check + high-risk approval | `packages/core/kernel/index.ts` |
| CommandBus | Command execution pipeline: register handler, execute command via interceptor chain | `packages/core/command-bus/index.ts` |
| EventBus | Publish/subscribe event system, supports wildcard subscriptions (`*`) | `packages/core/event-bus/index.ts` |
| ActionRegistry | Registers tools discoverable by AI Agent, generates `functionDeclarations` for @google/genai | `packages/core/registry/index.ts` |
| CapabilityGuard | String-based capability RBAC: grant/revoke per actorId, supports wildcard matching (`lesson:*`) | `packages/core/capability-system/index.ts` |
| PluginRuntime | VM sandbox lifecycle manager: install, activate, deactivate, uninstall plugins from SQLite | `packages/core/plugin-runtime/index.ts` |
| ProcessManager | Background task & interval management: spawn, kill, restore, logs | `packages/core/process-manager/index.ts` |
| DB | SQLite initialization, 30+ tables, default user/AI-provider seeding | `packages/core/db/index.ts` |
| Express Server | HTTP server + Socket.IO, all REST APIs, auth, AI agent chat orchestration, Vite integration | `server.ts` |
| Built-in Plugins | Lesson CRUD, whiteboard, courseware, plugin install | `packages/plugins/builtin.ts` |
| VFS Plugins | Virtual file system: write_file, read_file, list_dir, mkdir | `packages/plugins/vfs.ts` |
| Process Plugins | Process management: spawn, kill, list, logs | `packages/plugins/process.ts` |
| Management Plugins | Class, student, assignment, schedule, attendance CRUD | `packages/plugins/management.ts` |
| AI Planner Plugins | Background AI generation tasks + high-risk approval flow | `packages/plugins/ai-planner.ts` |
| AI Submit Injector | Auto-injects LMS SDK bridge into uploaded courseware HTML | `packages/plugins/ai-submit-injector.ts` |
| Frontend App | Single-page application, all UI, teacher/student views, REST API calls | `src/App.tsx` |
## Pattern Overview
- Monolithic kernel singleton (`kernelContainer`) centralizes all subsystem access
- Commands are namespaced strings (e.g., `lesson.create`, `vfs.write_file`) routed through CommandBus
- All commands pass through a single kernel-level interceptor for capability check + high-risk approval gating
- Plugins are stored as JavaScript source strings in SQLite, executed in `vm.createContext` sandbox
- AI Agent (Gemini/OpenAI) acts as autonomous Shell, calling tools via CommandBus
- Frontend is a monolith `App.tsx` with conditional rendering of 11 teacher tabs and 3 student views
## Layers
### 1. Frontend Presentation Layer
- Purpose: Render UI, handle user interactions, make REST API calls and WebSocket connections
- Location: `src/App.tsx`, `src/components/`, `src/main.tsx`
- Contains: React components, i18n, CSS, zustand state (minimal), Socket.IO client
- Depends on: REST API endpoints in server.ts, Socket.IO server
- Used by: End users (teacher/student/administrator)
### 2. Server Transport Layer
- Purpose: HTTP request handling, WebSocket management, session auth, Vite dev middleware, static file serving
- Location: `server.ts` (lines 591-5006)
- Contains: Express app, Socket.IO server, 40+ REST routes, cooke-based auth, AI agent chat orchestration
- Depends on: OS Kernel, @google/genai, OpenAI-compatible API
- Used by: Frontend, courseware runtime clients
### 3. OS Kernel Layer
- Purpose: Core execution engine, command routing, event propagation, plugin lifecycle, security
- Location: `packages/core/`
- Contains: Kernel, CommandBus, EventBus, ActionRegistry, CapabilityGuard, PluginRuntime, ProcessManager
- Depends on: SQLite (better-sqlite3), Node.js `vm` module
- Used by: Server layer, plugins
### 4. Plugin Layer
- Purpose: Implement business logic as registered command handlers and actions
- Location: `packages/plugins/`
- Contains: builtin.ts, vfs.ts, process.ts, management.ts, ai-planner.ts, ai-submit-injector.ts
- Depends on: OS Kernel (commandBus, actionRegistry, db, eventBus)
- Used by: OS Kernel (loaded at startup via bootstrap functions)
### 5. Data Layer
- Purpose: Persistent storage
- Location: `packages/core/db/index.ts` (schema), `packages/core/db/educational_os.db` (data), `storage/courseware/` (files)
- Contains: SQLite with 30+ tables, file-based courseware storage
- Depends on: better-sqlite3
- Used by: All layers via kernelContainer.db
## Data Flow
### Primary Request Path: Agent Chat
### REST API Direct Path
### Socket.IO Real-Time Path
### Courseware Runtime Path
- Server: In-memory Maps for online students, active lessons, active segments (ephemeral, not persisted)
- Frontend: React `useState` in App.tsx for tab, lesson, session, etc.; zustand used minimally
- Plugin: Plugin storage via `plugin_storage` SQLite table (key-value)
- Kernel: All state in SQLite; EventBus, CommandBus, ActionRegistry hold in-memory registrations that must be rebuilt on server restart
## Key Abstractions
- Purpose: Normalized command envelope for all operations
- Examples: All command handlers receive this type
- Pattern: `{ id, type, actorId, payload, timestamp, metadata }` from `packages/core/command-bus/index.ts`
- Purpose: Past-tense event envelope published after state changes
- Examples: `lesson.created`, `vfs.file_written`, `process.spawned`, `assignment.graded`
- Pattern: `{ id, type, source, payload, timestamp, correlationId }` from `packages/core/event-bus/index.ts`
- Purpose: Declares a tool available to AI Agent with JSON Schema
- Examples: All calls to `actionRegistry.register()`
- Pattern: `{ id, commandType, description, inputSchema, capabilityRequired, isHighRisk? }` from `packages/core/registry/index.ts`
- Purpose: Self-contained extension with manifest and activate function
- Examples: Extensions installed via plugin center UI
- Pattern: `{ manifest: { id, name, version, capabilitiesProposed, classroomTools }, activate: async (ctx) => { ... } }` — stored as JS string in `plugins` table
- Purpose: Identity that executes commands, subject to capability checks
- Examples: `'agent-system-0'` (AI Agent), `'plugin:ext-quiz-generator'` (plugin), `'user-demo'`, `'teacher-demo'`
- Pattern: String identifier assigned at command time, checked against CapabilityGuard
## Entry Points
- Location: `server.ts` function `startServer()`, invoked at bottom via `startServer().catch(console.error)`
- Triggers: `npm run dev` (tsx) or `npm start` (node dist/server.cjs)
- Responsibilities: Bootstrap built-in plugins, load DB plugins, initialize Express + Socket.IO, setup Vite middleware, start HTTP server on port 9000
- Location: `src/main.tsx` renders `<App />` into `#root`
- Triggers: Browser loads page
- Responsibilities: Login page (conditional), render teacher/student UI with 11 teacher tabs
- Location: `server.ts:689` — `POST /api/agent/chat`
- Triggers: User sends message in agent panel
- Responsibilities: Orchestrate AI chat loop with tool calling, execute commands through CommandBus
## Architectural Constraints
- **Single-threaded event loop:** Node.js default model. Long-running tasks use `ProcessManager` (simulated with `setTimeout`, not real workers)
- **Global state:** `kernelContainer` is a module-level singleton instantiated at import time in `packages/core/kernel/index.ts:77`. All subsystems in memory. Server restart wipes all registrations and must re-bootstrap.
- **No database migrations:** Schema evolves through `CREATE TABLE IF NOT EXISTS` and incremental `ALTER TABLE ADD COLUMN` in `db/index.ts`. No migration framework — all schema changes are manual and additive.
- **Plugin sandboxing:** Uses Node.js `vm.createContext` with timeout (5s activation, 1s pre-evaluation). API wrappers freeze prototype chains. Not a full process-isolation security boundary.
- **Monolithic server:** `server.ts` (5008 lines) contains all Express routes, Socket.IO handlers, AI agent logic, courseware runtime, LMS SDK injection, and plugin management — all in a single file with no sub-routers.
- **Monolithic frontend:** `App.tsx` (11159 lines) contains all business logic, API calls, state management, and UI rendering. Component extraction is partial (components/ for sub-widgets only).
- **No formal API versioning:** All routes under `/api/` with no version prefix.
- **Circular dependency concern:** Kernel imports depend on subsystem modules, subsystems import Kernel type. PluginRuntime constructor takes `Kernel` instance, creating a tight coupling.
## Anti-Patterns
### Monolithic Entry Points
### Direct DB Access Bypassing CommandBus
### Inline Plugin Source Code
### Schema Evolution via ALTER TABLE
## Error Handling
- API routes: `try { ... } catch (e: any) { res.status(500).json({ success: false, error: e.message }) }`
- CommandBus execution: `try { const result = await handler.execute(command); return result; } catch (error) { console.error(...); throw error; }`
- Event subscribers: `Promise.resolve(sub(event)).catch(err => { console.error(...) })` — errors silently logged
- Plugin activation: Errors trigger full rollback (unregister actions, handlers, events, processes)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
