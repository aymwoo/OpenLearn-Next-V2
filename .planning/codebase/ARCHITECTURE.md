<!-- refreshed: 2026-06-17 -->
# Architecture

**Analysis Date:** 2026-06-17

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Frontend (SPA)                                │
│  `src/App.tsx` (11159 lines) + `src/components/` (15437 lines)      │
│  React 19 + TailwindCSS 4 + Vite 6 HMR                              │
├──────────────────┬──────────────────┬──────────────────┬────────────┤
│   API (REST)     │   Socket.IO      │   Static Assets   │  Vite HMR  │
│  `POST /api/*`   │  `io.emit(...)`  │  `/runtime/:uuid` │  Dev only  │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴──────┬─────┘
         │                  │                  │                │
         ▼                  ▼                  ▼                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Express Server (monolith)                         │
│  `server.ts` (5008 lines)                                            │
│  Routes, Socket.IO management, auth middleware, AI agent orchestration│
├──────────────────────────────────────────────────────────────────────┤
│                      OS Kernel (plugin-driven)                       │
│  `packages/core/kernel/index.ts` — global singleton: kernelContainer  │
│  ┌───────────────┐ ┌──────────────┐ ┌───────────────────┐            │
│  │  CommandBus    │ │  EventBus     │ │ ActionRegistry     │            │
│  │ `command-bus/` │ │ `event-bus/`  │ │ `registry/`        │            │
│  └───────┬───────┘ └──────┬───────┘ └────────┬──────────┘            │
│  ┌───────┴───────┐ ┌──────┴───────┐ ┌────────┴──────────┐            │
│  │CapabilityGuard │ │PluginRuntime  │ │ ProcessManager    │            │
│  │`capability-sys`│ │`plugin-runtim`│ │ `process-manager` │            │
│  └───────────────┘ └──────────────┘ └───────────────────┘            │
├──────────────────────────────────────────────────────────────────────┤
│                        Built-in Plugins                              │
│  `packages/plugins/`                                                 │
│  builtin.ts | vfs.ts | process.ts | management.ts | ai-planner.ts    │
│  ai-submit-injector.ts                                               │
├──────────────────────────────────────────────────────────────────────┤
│                     SQLite (better-sqlite3)                          │
│  `packages/core/db/educational_os.db` — 30+ tables, single file      │
└──────────────────────────────────────────────────────────────────────┘
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

**Overall:** Plugin-Driven OS Kernel with Command-Event Bus architecture

**Key Characteristics:**
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

1. User types message in `App.tsx` right sidebar agent panel → `POST /api/agent/chat` with `{ message, lang, currentLessonId, attachments, providerId }`
2. Server extracts caller role from `edu_os_token` cookie, looks up session in `client_sessions` table (`server.ts:689-712`)
3. Server selects AI provider: OpenAI-compatible (from `ai_providers` table) or Gemini fallback (`server.ts:718-720`)
4. Server builds system instruction + tool list from `kernelContainer.actionRegistry.getAgentTools()` (`server.ts:63-73`)
5. Server enters AI chat loop (max 5 rounds) (`server.ts:handleAgentChat`, lines ~200-370):
   - Sends message + tools to AI API
   - If AI returns `tool_calls`, resolves `ATTACHMENT_BASE64` references
   - Calls `executeAgentToolCall()` which does `kernelContainer.commandBus.execute(cmd)`
   - Feeds tool results back to AI as `tool` role messages
6. CommandBus interceptor checks capability + high-risk approval (`packages/core/kernel/index.ts:28-54`)
7. CommandHandler in plugin executes, writes to SQLite, publishes event to EventBus
8. EventBus `*` wildcard logs to `events` table (`packages/core/kernel/index.ts:58-72`)
9. Specific event subscribers emit Socket.IO notifications (e.g., `assignment.graded` → `io.emit('assignment-graded-toast', ...)`)
10. Final AI response returned to frontend as `{ agentText, toolResults, providerUsed }`

### REST API Direct Path

1. Frontend calls REST endpoints (e.g., `GET /api/resources`, `POST /api/courseware/upload`, `POST /api/auth/login`)
2. Server handler directly queries/updates SQLite via `kernelContainer.db`
3. Response returns as JSON
4. No CommandBus involvement — direct server-to-db path

### Socket.IO Real-Time Path

1. Server subscribes to kernel EventBus for specific events (`server.ts:4794-4811`, `4858-4876`)
2. Student connects → `register-student` → stored in `onlineStudents` Map
3. Real-time events broadcast: `courseware-attempt-updated`, `student-progress-updated`, `assignment-graded-toast`, `student-picked`, `presence-update`, `whiteboard-sync`, `student-active-segment-changed`, `student-pinged`
4. Whiteboard sync: clients send `whiteboard-update` → server broadcasts to room via `socket.to(roomId).emit('whiteboard-sync', data)`

### Courseware Runtime Path

1. Teacher uploads HTML/ZIP via `POST /api/courseware/upload`
2. Server auto-detects if LMS SDK (`bridge.js`) needs injection → `injectLmsSdk()` in server.ts
3. If score display exists but no submit logic → AI auto-injects submit code via `injectScoreSubmissionUsingAI()` from `ai-submit-injector.ts`
4. Courseware served at `/runtime/:uuid/` with injected `bridge.js`
5. Student browser runs courseware, calls `window.LMS.submit()` → `POST /api/courseware/attempts/:attemptId/submit`
6. Raw submissions logged to `submission_raw` table, results to `submission_result`

**State Management:**
- Server: In-memory Maps for online students, active lessons, active segments (ephemeral, not persisted)
- Frontend: React `useState` in App.tsx for tab, lesson, session, etc.; zustand used minimally
- Plugin: Plugin storage via `plugin_storage` SQLite table (key-value)
- Kernel: All state in SQLite; EventBus, CommandBus, ActionRegistry hold in-memory registrations that must be rebuilt on server restart

## Key Abstractions

**PlatformCommand:**
- Purpose: Normalized command envelope for all operations
- Examples: All command handlers receive this type
- Pattern: `{ id, type, actorId, payload, timestamp, metadata }` from `packages/core/command-bus/index.ts`

**PlatformEvent:**
- Purpose: Past-tense event envelope published after state changes
- Examples: `lesson.created`, `vfs.file_written`, `process.spawned`, `assignment.graded`
- Pattern: `{ id, type, source, payload, timestamp, correlationId }` from `packages/core/event-bus/index.ts`

**ActionDescriptor:**
- Purpose: Declares a tool available to AI Agent with JSON Schema
- Examples: All calls to `actionRegistry.register()`
- Pattern: `{ id, commandType, description, inputSchema, capabilityRequired, isHighRisk? }` from `packages/core/registry/index.ts`

**Plugin:**
- Purpose: Self-contained extension with manifest and activate function
- Examples: Extensions installed via plugin center UI
- Pattern: `{ manifest: { id, name, version, capabilitiesProposed, classroomTools }, activate: async (ctx) => { ... } }` — stored as JS string in `plugins` table

**Actor:**
- Purpose: Identity that executes commands, subject to capability checks
- Examples: `'agent-system-0'` (AI Agent), `'plugin:ext-quiz-generator'` (plugin), `'user-demo'`, `'teacher-demo'`
- Pattern: String identifier assigned at command time, checked against CapabilityGuard

## Entry Points

**Server Process:**
- Location: `server.ts` function `startServer()`, invoked at bottom via `startServer().catch(console.error)`
- Triggers: `npm run dev` (tsx) or `npm start` (node dist/server.cjs)
- Responsibilities: Bootstrap built-in plugins, load DB plugins, initialize Express + Socket.IO, setup Vite middleware, start HTTP server on port 9000

**Frontend App:**
- Location: `src/main.tsx` renders `<App />` into `#root`
- Triggers: Browser loads page
- Responsibilities: Login page (conditional), render teacher/student UI with 11 teacher tabs

**Agent Chat:**
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

**What happens:** `server.ts` (5008 lines) and `App.tsx` (11159 lines) contain all routing, business logic, and UI in single files. Express routes are defined inline without Router modules.
**Why it's wrong:** Extremely difficult to navigate, test, or maintain. Any change risks unintended side effects. No modular boundaries for independent development.
**Do this instead:** Extract routes into `routes/` directory using Express Router. Split App.tsx into page-level components in `pages/` or `views/`.

### Direct DB Access Bypassing CommandBus

**What happens:** Many server routes directly query `kernelContainer.db` instead of going through CommandBus commands. This skips capability checks, audit logging, and event publishing.
**Why it's wrong:** Inconsistent behavior. Some operations are audited and evented via CommandBus, others are not. Plugin-based capability restrictions are bypassed.
**Do this instead:** All data mutations should go through CommandBus. Read operations can be direct if they don't need capability enforcement.

### Inline Plugin Source Code

**What happens:** Default plugin source code (Quiz Component Plugin, Roll Call Plugin) is defined as template literals inside `server.ts` and `App.tsx` (~200+ lines each), auto-installed if absent from DB.
**Why it's wrong:** Hard to version, review, or update. Source code mixed with infrastructure code.
**Do this instead:** Store default plugin source as separate `.js` files in `assets/` or `packages/plugins/defaults/`, loaded via `fs.readFileSync` at startup.

### Schema Evolution via ALTER TABLE

**What happens:** `packages/core/db/index.ts` uses a series of `try { ALTER TABLE ... ADD COLUMN } catch` blocks to migrate schema (~15 blocks).
**Why it's wrong:** Fragile, no version tracking, no rollback capability. Cannot handle complex migrations (column renames, type changes).
**Do this instead:** Use a lightweight migration framework or at minimum a `schema_version` table to track applied migrations.

## Error Handling

**Strategy:** Try/catch at API route level, returning `res.status(500).json({ error: e.message })`. CommandBus catches handler errors and re-throws. EventBus catches subscriber errors silently.

**Patterns:**
- API routes: `try { ... } catch (e: any) { res.status(500).json({ success: false, error: e.message }) }`
- CommandBus execution: `try { const result = await handler.execute(command); return result; } catch (error) { console.error(...); throw error; }`
- Event subscribers: `Promise.resolve(sub(event)).catch(err => { console.error(...) })` — errors silently logged
- Plugin activation: Errors trigger full rollback (unregister actions, handlers, events, processes)

## Cross-Cutting Concerns

**Logging:** `console.log`, `console.error`, `console.warn` throughout. No structured logging framework. No log levels or log rotation.

**Validation:** Minimal. API routes validate required fields with simple checks. Command payloads not validated against registered JSON schemas (schemas used only for AI tool declarations).

**Authentication:** Cookie-based session (`edu_os_token`). Sessions stored in `client_sessions` table. `checkIsTeacherOrAdmin()` guard used on protected endpoints. No JWT, no token refresh, no session expiry enforcement.

**Audit:** All events published through EventBus are automatically logged to `events` table via `*` wildcard subscription in `kernel.initAuditLog()`. Commands executed through CommandBus are not directly audited (only through events they publish).

---

*Architecture analysis: 2026-06-17*
