# Coding Conventions

**Analysis Date:** 2026-06-17

## Naming Patterns

**Files:**
- Server-side packages use kebab-case directories with `index.ts` barrel files: `packages/core/command-bus/index.ts`, `packages/core/plugin-runtime/index.ts`
- Plugin modules use lowercase with hyphens: `packages/plugins/builtin.ts`, `packages/plugins/ai-planner.ts`, `packages/plugins/ai-submit-injector.ts`
- Frontend components use PascalCase: `src/components/InteractiveWhiteboard.tsx`, `src/components/LiveClassroomView.tsx`, `src/components/StudentGradedTimeline.tsx`
- The main app file is `src/App.tsx` (PascalCase)
- Utility/config files use lowercase: `src/i18n.ts`, `vite.config.ts`, `server.ts`

**Functions:**
- Bootstrap functions for plugin registration: `bootstrapBuiltinPlugins()`, `bootstrapVFSPlugins()`, `bootstrapManagementPlugins()`
- Handler execute methods: `async execute(command) { ... }` (lowercase, object method)
- Components use `export default function App()` or `export function InteractiveWhiteboard(...)`
- Helper functions use camelCase: `copyFolderSync()`, `resolvePath()`, `hashPassword()`, `parsePluginSource()`
- Callback-style inline functions use arrow functions extensively: `async (command) => { ... }`

**Variables:**
- camelCase for local variables and state: `selectedStudent`, `isActive`, `socketRef`
- PascalCase for component names and React refs: `Socket`, `Markdown`
- State-updater pairs follow the `[value, setValue]` convention: `const [lang, setLang] = useState<Language>('zh')`
- Database references use short names: `db`, `stmt`, `cmd`
- Plugin entity IDs use snake_case pattern: `usr_admin`, `prov_deepseek`, `ext-quiz-generator`
- Command types use dot-separated namespacing: `lesson.create`, `whiteboard.draw`, `vfs.write_file`, `ai.start_generation`

**Types:**
- Interfaces are PascalCase: `PlatformCommand`, `CommandHandler`, `ActionDescriptor`, `PluginRegistration`
- Type aliases are PascalCase: `ProcessHandler`, `EventSubscriber`, `VFSNode`, `Lesson`, `AgentChatAttachment`
- Props interfaces add "Props" suffix: `InteractiveWhiteboardProps`, `AnimatedCounterProps`
- Generic type parameter is `T` everywhere
- Discriminated unions are rare; `any` type is used heavily instead

**Constants:**
- UPPER_SNAKE_CASE for configuration: `DEFAULT_PLUGIN`, `AGENT_PROVIDER_STORAGE_KEY`, `CAPABILITY_INFO`
- Enum-like lookup objects as `const` records: `translations` (zh/en keyed object)

## Code Style

**Formatting:**
- No formatter detected (no `.prettierrc`, `eslint.config.*`, or `biome.json` files exist)
- Inconsistent spacing patterns observed: some files use 1-space indentation (`builtin.ts`), others 2-space (`App.tsx`, `server.ts`), others mixed
- No auto-formatting pipeline in the build process

**Linting:**
- No ESLint or Biome configuration files exist
- The `lint` script runs `tsc --noEmit` only (pure type checking)
- TypeScript strict mode is NOT enabled (no `"strict": true` in `tsconfig.json`)

**TypeScript Configuration (`tsconfig.json`):**
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

**Order:**
1. External libraries (react, express, etc.)
2. Side-effect imports (`dotenv/config`)
3. Internal project modules
4. Components/locals

**Path Style:**
- Frontend (`src/`): relative imports without `.tsx` extension: `from './components/InteractiveWhiteboard'`
- Backend (`packages/` and `server.ts`): relative imports WITH `.js` extension (for ESM compatibility): `from '../core/kernel/index.js'`
- The `@/*` alias is defined in tsconfig/Vite but unused in practice

**Typical import block (from `src/App.tsx`):**
```typescript
import { MessageSquare, Wand2, ... } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { InteractiveWhiteboard } from './components/InteractiveWhiteboard';
import { io } from 'socket.io-client';
```

**Typical backend import block (from `packages/core/kernel/index.ts`):**
```typescript
import { EventBus } from '../event-bus/index.js';
import { CommandBus } from '../command-bus/index.js';
import { db } from '../db/index.js';
```

## Error Handling

**Patterns:**

1. **Express route try-catch wrapper** (every route uses this):
```typescript
app.post('/api/endpoint', async (req, res) => {
  try {
    // ... logic
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

2. **CommandBus execution error propagation** (`packages/core/command-bus/index.ts:63-69`):
```typescript
try {
  const result = await handler.execute(normalizedCommand);
  return result;
} catch (error: any) {
  console.error(`[CommandBus] Failed to execute ${normalizedCommand.type}:`, error);
  throw error; // Re-throws after logging
}
```

3. **Plugin sandbox catch-and-continue** (`packages/core/plugin-runtime/index.ts:213-215`):
```typescript
const safeSubscriber = (event: any) => {
  try {
    return subscriber(event);
  } catch (e) {
    console.error(`[Plugin:${manifest.id}] Error in event subscriber for ${eventType}:`, e);
  }
  // Error is swallowed, subscriber execution continues
};
```

4. **Fire-and-forget try-catch** (used for non-critical AI fallback operations):
```typescript
try {
  // AI auto-submit version injection
} catch (aiErr) {
  console.error('Failed to create AI auto-submit version for html upload:', aiErr);
  // Non-fatal, main flow continues
}
```

5. **Database migration try-catch** (ALTER TABLE idempotency pattern in `packages/core/db/index.ts`):
```typescript
try {
  db.prepare('ALTER TABLE students ADD COLUMN private_notes TEXT').run();
} catch (e) {
  // column already exists
}
```
This pattern is used ~15 times for schema migrations. NOTE: catching all errors and assuming "column already exists" can silently swallow other migration failures.

6. **EventBus subscriber error isolation** (`packages/core/event-bus/index.ts:33-34`):
```typescript
await Promise.all(allSubs.map(sub => Promise.resolve(sub(event)).catch(err => {
  console.error(`Error in event subscriber for ${event.type}:`, err);
})));
```

**Issues:**
- Error types are universally typed as `any` — no structured error hierarchy
- No custom error classes exist in the codebase
- Console logging is the primary error reporting mechanism — no structured logging framework
- No error tracking/alerting integration
- Database errors bubble up as generic strings through `err.message`

## Logging

**Framework:** `console.log` / `console.error` / `console.warn` directly (no logging library)

**Patterns:**
- Backend: Tagged with subsystem prefix: `[CommandBus]`, `[Plugin:<id>]`, `[AI Planner]`
- `server.ts`: Start/stop messages at the top level, route-level errors via `console.error`
- Some `console.error` calls log error objects directly; others use string interpolation
- No log levels, no structured JSON logging, no log rotation

**Log locations:**
- `kernelContainer.initAuditLog()` writes all events to the `events` SQLite table
- Process logs are stored in `processes.logs` as appended text
- No external log file or stdout capture

**Antipatterns observed:**
- Error swallowing in `plugin-runtime/index.ts` clean-up code: `try { ... } catch {}` (empty catch block)
- Inconsistent tag formats: some use `[Plugin:X]`, others use raw strings

## Comments

**When to Comment:**
- Section headers in large files: `// 1. LESSON HANDLER`, `// 2. WHITEBOARD HANDLER`, `// --- COURSEWARE UPLOAD HANDLER ---`
- Inline explanations for non-obvious logic: `// Safely replace non-word chars with underscore for function names`
- Business logic clarification: `// When the caller is an administrator, elevate the agent to superadmin`
- Very sparse overall — most code relies on self-documenting naming

**JSDoc/TSDoc:**
- Not used anywhere in the codebase
- No `@param`, `@returns`, or `@throws` annotations

## Function Design

**Size:**
- Backend plugin registration functions are moderately sized (50-200 lines per handler)
- `bootstrapBuiltinPlugins()` is 1268 lines — a single function registering 15+ handlers
- `App()` component is 9600+ lines with 160+ `useState` hooks — the largest function in the codebase
- Sub-components in `src/components/` range from 200 to 2600 lines

**Parameters:**
- Command handlers always receive a single `command` parameter with typed payload
- Plugin activate functions receive a single `ctx` context object
- React component props are destructured inline

**Return Values:**
- Command handlers return arbitrary objects or void: `Promise<void | any>`
- REST endpoints return `{ success: true, result }` or `{ success: false, error: message }`
- Some routes return raw data without wrapper: `res.json(rows)`

## Module Design

**Exports:**
- Core modules export a named class and a singleton instance: `export class Kernel` + `export const kernelContainer = new Kernel()`
- Plugin modules export a single bootstrap function: `export function bootstrapBuiltinPlugins()`
- Frontend components use default export: `export default function App()`
- Types are exported using `export interface` / `export type` inline

**Barrel Files:**
- Every `packages/core/*/` directory has an `index.ts` barrel file
- No barrel files in `src/` — components imported directly by name

## Code Organization

**Separation of Concerns:**
- `server.ts` (5008 lines): Express routes, middleware, AI agent chat, courseware runtime, bridge.js, OCR endpoints — everything in one file
- `src/App.tsx` (11159 lines): All business logic, UI rendering, data fetching, state management, plugin preview, CSV parsing — everything in one component
- `packages/core/`: Cleanly separated by subsystem (command-bus, event-bus, registry, etc.)
- `packages/plugins/`: Each plugin file handles one domain (builtin, vfs, management, etc.)

**State Management:**
- Frontend: React `useState` (160+ instantiations in App.tsx) and `useRef` — no zustand usage detected despite being a dependency
- Backend: Kernel singleton with in-memory Maps for handlers/subscribers/registrations
- Database: SQLite via `better-sqlite3` synchronous API — no ORM, raw SQL throughout

## API Design Patterns

**Command Types (backend internal):**
- Imperative verb-noun format with namespacing: `lesson.create`, `whiteboard.draw`, `vfs.write_file`, `plugin.install_zip`
- Events use past tense: `lesson.created`, `whiteboard.element_drawn`, `user.updated`

**REST Endpoints (`server.ts`):**
- Manual route-by-route registration: `app.post('/api/agent/chat', ...)`
- Response wrapper: `{ success: true, result }` or `{ success: false, error: message }` — but inconsistent across routes
- No middleware-based validation (Joi/Zod) — manual checks in route handlers
- No authentication middleware abstraction — session cookie parsing is duplicated in each route

**Action Registration (for AI Agent tools):**
```typescript
actionRegistry.register({
  id: 'core-lesson-create',
  commandType: 'lesson.create',
  description: 'Create a new lesson with title and optional initial content',
  capabilityRequired: 'lesson:write',
  inputSchema: { type: 'OBJECT', properties: { ... }, required: [...] },
  isHighRisk: true  // optional flag for approval gating
});
```

---

*Convention analysis: 2026-06-17*
