# Codebase Concerns

**Analysis Date:** 2026-06-17

---

## Security Concerns

### 1. Student Passwords Stored in Plaintext

- **Risk:** Student passwords are stored directly as plaintext in the `students.password` column with zero hashing. Default password on creation is `123456`. This is a critical data breach risk.
- **Files:** `server.ts:3070-3071` (INSERT), `server.ts:3084` (UPDATE), `server.ts:2811` (comparison: `studentObj.password.trim() === providedPassword`)
- **Current mitigation:** None. Students table has no password_hash mechanism whatsoever.
- **Recommendations:**
  - Hash student passwords using bcrypt/argon2 at minimum (SHA-256 used for teacher accounts is insufficient but present; students have nothing)
  - Remove default password assignment of `123456`
  - Implement student password reset flow requiring current password verification

### 2. Weak Password Hashing for Admin/Teacher Accounts (SHA-256, No Salt)

- **Risk:** Admin and teacher passwords are hashed with unsalted single-round SHA-256 (`crypto.createHash('sha256').update(pwd).digest('hex')`), making them vulnerable to rainbow table attacks.
- **Files:** `packages/core/db/index.ts:414`, `server.ts:2785`
- **Recommendations:** Replace with bcrypt (add `bcrypt` or `@node-rs/bcrypt` dependency) using appropriate cost factor (10+ rounds).

### 3. Session Token: No Expiration, No Secure Flag, No Relational Integrity

- **Risk:** Session tokens (`edu_os_token`) are set with `HttpOnly` and `SameSite=Strict` but lack the `Secure` flag (required for HTTPS). There is no server-side session expiration mechanism — tokens live for `Max-Age=31536000` (1 year) with no cleanup. Sessions have no foreign key reference to the users table.
- **Files:** `server.ts:2847`, `server.ts:2749`
- **Recommendations:**
  - Add `Secure` flag to Set-Cookie when in production
  - Implement session expiration (e.g., 24 hours idle, 7 days absolute)
  - Add a background job or on-login cleanup to delete expired `client_sessions` rows
  - Consider associating sessions with user/student IDs for audit and revocation

### 4. No Rate Limiting on Login Endpoint

- **Risk:** `/api/auth/login` has no rate limiting, allowing brute-force attacks against teacher and student credentials.
- **Files:** `server.ts:2769-2857`
- **Recommendations:** Add `express-rate-limit` middleware, particularly 5 attempts per minute per IP on login route.

### 5. CORS: Open Wildcard

- **Risk:** Socket.IO is configured with `cors: { origin: '*' }`, allowing any origin to connect. Combined with the bridge SDK (`bridge.js`) that hooks `fetch`, `XMLHttpRequest`, and `axios`, cross-origin data exfiltration may be possible from the courseware iframe context.
- **Files:** `server.ts:4791`
- **Recommendations:** Restrict CORS to the actual frontend domain in production.

### 6. No Security Middleware

- **Risk:** Express app uses no `helmet` (security headers), no `express-rate-limit`, no CSRF protection, no input sanitization library. This exposes the entire API surface to standard web attacks.
- **Files:** `server.ts:591-595` (app initialization)
- **Recommendations:** Add `helmet`, rate limiting, and input validation middleware.

### 7. VM Sandbox Escape Risk in Plugin Runtime

- **Risk:** The plugin system uses Node.js `vm` module (`vm.Script` + `vm.createContext`) to execute arbitrary plugin source code. While there are hardening measures (prototype severing with `Object.setPrototypeOf(obj, null)`, timeout of 1000ms for compilation and 5000ms for activation), the `vm` module is explicitly documented by Node.js as **not a security mechanism** and does not prevent escape to the host process. A malicious plugin could:
  - Access `process`, `require`, or the filesystem via constructor chains not fully blocked
  - Exploit the `async activate()` function that returns a Promise (timeout only applies to compilation, not the activation Promise internals)
  - Use the `fetch` available inside `wrappedAI.generateText` (line 390) to exfiltrate data
  - Exploit the `wrappedStorage` to write arbitrary data to the SQLite database
- **Files:** `packages/core/plugin-runtime/index.ts:150-515`
- **Current hardening:** Prototype chain severing on wrapper objects (lines 443-449), `Object.defineProperty` non-writable on context (lines 464-470), timeout-based execution limits
- **Recommendations:**
  - For production, replace `vm` with isolated worker threads (`worker_threads`) or a sandboxed process
  - Add `--experimental-vm-modules` flags consideration; Node.js 24+ deprecates vm module APIs
  - Implement plugin code review/approval workflow before activation
  - Add allowlist-based capability limits (only capabilities explicitly listed in manifest can be granted)

### 8. VM Module Deprecation

- **Risk:** Node.js `vm` module is deprecated in newer versions. The `vm.Script` and `vm.createContext` APIs used here may be removed in future Node.js releases, breaking the entire plugin system.
- **Files:** `packages/core/plugin-runtime/index.ts:5,157-158,473,475`
- **Recommendations:** Plan migration to `worker_threads` or a WebAssembly-based sandbox.

### 9. AI Provider API Keys Stored in Plaintext Database

- **Risk:** Third-party AI provider API keys are stored as plaintext in the `ai_providers.api_key` column and returned to the frontend in `/api/ai-providers` responses. The same keys are used to construct `Authorization: Bearer` headers server-side. Anyone with database access or a compromised admin session can exfiltrate all API keys.
- **Files:** `packages/core/db/index.ts:229-232` (table schema, api_key TEXT), `server.ts:2773` (bearer auth construction)
- **Recommendations:**
  - Encrypt API keys at rest using a server-side encryption key (e.g., `crypto.createCipheriv`)
  - Do NOT return `api_key` in the `/api/ai-providers` GET response; mask it (e.g., `sk-****...`)
  - Consider environment-variable-based key injection instead of database storage

### 10. AI Prompt Injection via Plugin and Agent Chat

- **Risk:** The agent chat system (`runGeminiAgentChat`, `runOpenAIAgentChat`) constructs prompts with user-supplied `message` and `attachments` content directly injected. No output sanitization is performed on AI-generated responses before sending to the client.
- **Files:** `server.ts:63-73`, `server.ts:75-88`
- **Recommendations:** Sanitize user inputs, validate attachment types, add content security policy headers.

---

## Architectural Risks

### 11. 5000+ Line Monolithic Server (server.ts)

- **Issue:** `server.ts` contains 5008 lines combining Express route handlers, AI agent orchestration, Socket.IO event handling, database queries, bridge SDK injection, OCR processing, and timetable scheduling logic — all in a single file.
- **Files:** `server.ts` (5008 lines)
- **Impact:** Any change requires navigating 5000 lines. No route can be modified or tested independently. Risk of unintended side effects is high.
- **Fix approach:**
  - Split into route modules: `routes/auth.ts`, `routes/courseware.ts`, `routes/lessons.ts`, `routes/ai.ts`, `routes/admin.ts`
  - Extract bridge SDK (`bridge.js`) into its own file
  - Extract AI agent orchestration into `services/agent.ts`
  - Extract helper functions (`injectLmsSdk`, `extractScoreCommentCompletion`, `normalizeToolSchema`) into utility modules

### 12. 11,159-Line Monolithic React Component (App.tsx)

- **Issue:** `src/App.tsx` is over 11,000 lines containing the entire frontend application — all state, all views, all side effects, all WebSocket handling — in a single component.
- **Files:** `src/App.tsx` (11159 lines)
- **Impact:** Impossible to test, review, or modify without risk of breaking unrelated functionality. Component re-renders cascade through everything.
- **Fix approach:**
  - Extract pages/views into route-based components
  - Extract shared state into Zustand stores (zustand is already a dependency)
  - Extract Socket.IO hooks into custom `useSocket` hook
  - Extract data-fetching logic into custom hooks or React Query

### 13. Opaque Monolithic Plugin Implementations

- **Issue:** `builtin.ts` (1268 lines) and `management.ts` (882 lines) are large, dense files registering dozens of commands. `InteractiveWhiteboard.tsx` is 4174 lines. These contain intertwined business logic, database queries, and UI state that cannot be tested in isolation.
- **Files:** `packages/plugins/builtin.ts`, `packages/plugins/management.ts`, `src/components/InteractiveWhiteboard.tsx`
- **Impact:** Debugging a single feature (e.g., `student.create`) requires tracing through hundreds of lines of unrelated code.

### 14. SQLite: No WAL Mode, No Concurrency Strategy

- **Issue:** `better-sqlite3` is initialized with default journal mode (likely `delete` or `truncate` based on the `PRAGMA journal_mode` diagnostic query at `server.ts:2670`). WAL mode is not explicitly enabled, meaning writes block reads. There is no connection pooling, no read-replica strategy.
- **Files:** `packages/core/db/index.ts:25` (no PRAGMA configuration), `server.ts:2670` (reads journal_mode but never sets WAL)
- **Impact:** Under concurrent load (Socket.IO events + API requests + plugin operations), write contention will cause degraded performance or SQLITE_BUSY errors.
- **Recommendations:**
  - Enable WAL mode at DB init: `db.pragma('journal_mode = WAL')`
  - Set `db.pragma('busy_timeout = 5000')`
  - Set `db.pragma('synchronous = NORMAL')` for better write performance
  - Consider `db.pragma('cache_size = -64000')` (64MB cache)

### 15. No Database Migration System

- **Issue:** Schema evolution is done via `try { ALTER TABLE ... } catch (e) { /* column already exists */ }` blocks in `db/index.ts` (lines 318-396) and inline `CREATE TABLE IF NOT EXISTS` in `server.ts` (lines 398-410). There is no migration versioning, no rollback mechanism, and no way to determine the current schema state.
- **Files:** `packages/core/db/index.ts:318-396`, `server.ts:398-410`
- **Impact:**
  - Impossible to know which migrations have been applied
  - Cannot rollback a bad schema change
  - ALTER TABLE errors from unrelated causes are silently swallowed
  - Database corruption risk if ALTER TABLE partially fails
- **Recommendations:**
  - Adopt a migration tool (e.g., `better-sqlite3`'s built-in migration support, or `sqlite-migration`)
  - Create a `migrations/` directory with numbered SQL files
  - Track applied migrations in a `_migrations` meta-table

### 16. Singleton Global State: kernelContainer

- **Issue:** `kernelContainer` is a module-level singleton (`packages/core/kernel/index.ts:76`) that holds all runtime state. This means:
  - Only one server instance can run per process
  - Shared mutable state across all API routes, WebSocket handlers, and plugins
  - Testing any component requires the entire Kernel to be initialized
- **Files:** `packages/core/kernel/index.ts:76`
- **Recommendations:** Make `Kernel` injectable. Use dependency injection for plugin runtime, command bus, and event bus. Reserve singleton for production convenience but allow constructor injection for testing.

### 17. Auto-Generated Synthetic Data in Production API

- **Issue:** Multiple API endpoints auto-generate fake/synthetic data when real data is absent:
  - Attendance summary auto-generates 7 fake schedules with randomized attendance (`server.ts:3942-3981`)
  - Rollcall plugin falls back to hardcoded mock students when `class.get_students` fails (`plugin-runtime/index.ts` via rollcall plugin)
  - Agent chat creates mock courseware attempts for guest/teacher test users
- **Files:** `server.ts:3942-3981`, inline rollcall plugin code `server.ts:536-544`
- **Impact:** Production users may see fabricated data and mistake it for real data. Data integrity guarantees are violated.

---

## Testing & Quality

### 18. Zero Test Files

- **Issue:** The codebase has **no test files whatsoever** — no `*.test.ts`, `*.spec.ts`, no test directory, no test runner configuration.
- **Files:** None found
- **Impact:** Every code change is a regression risk. Plugin updates, schema changes, and route modifications have no safety net.
- **Recommendations:**
  - Start with critical-path integration tests: auth flow, lesson CRUD, student management
  - Add unit tests for plugin runtime evaluation logic
  - Add database migration tests

### 19. No CI/CD Pipeline

- **Issue:** No CI configuration files exist (no `.github/workflows/`, no `.gitlab-ci.yml`, no Dockerfile, no Jenkinsfile).
- **Impact:** No automated builds, no linting enforcement, no type checking in CI, no deployment automation.
- **Recommendations:** Add GitHub Actions workflow with `tsc --noEmit`, `npm run build`, and basic smoke tests.

### 20. No Linting or Formatting Configuration

- **Issue:** No ESLint config, no Prettier config, no Biome config. Only `tsc --noEmit` in the `lint` script, and `skipLibCheck: true` in tsconfig.js which skips library type checking.
- **Files:** `package.json` (lint script), `tsconfig.json` (skipLibCheck)
- **Impact:** Inconsistent code style across 14 components and 5000-line server. Type errors in library dependencies are silently ignored.
- **Recommendations:** Add ESLint with TypeScript plugin; enable `skipLibCheck: false` or add targeted exclude patterns.

---

## Infrastructure & Operations

### 21. No Error Tracking / Monitoring

- **Issue:** All error logging is via `console.error` and `console.log`. There is no structured logging, no log aggregation, no error tracking service (Sentry, etc.), and no health check endpoint beyond `/api/db-status`.
- **Files:** `server.ts` (51 `console.log`/`console.error` calls), `packages/` (28 calls)
- **Impact:** Production errors are invisible. Debugging requires SSH access to read process stdout.
- **Recommendations:**
  - Add a structured logger (e.g., `pino` or `winston`)
  - Add Sentry or similar error tracking
  - Add `/health` endpoint with dependency checks

### 22. No Graceful Shutdown

- **Issue:** `startServer()` starts the HTTP server but there is no `SIGTERM`/`SIGINT` handler to gracefully close Socket.IO connections, stop plugin intervals, or flush database writes.
- **Files:** `server.ts:5005-5007`
- **Recommendations:** Add process signal handlers that close `httpServer`, `io`, and `kernelContainer.db` cleanly.

### 23. File Uploads: 100MB Body Limit, No Validation for Non-PDF/PPTX

- **Issue:** Express body parser is configured with `limit: '100mb'` but only `.pdf` and `.pptx` extension checks are performed on the filename. The upload route itself (`/api/upload`) only checks extension but `/api/plugins/upload-zip` accepts arbitrary ZIP content with no size per-file validation within the ZIP.
- **Files:** `server.ts:594-595`, `server.ts:598-659`
- **Recommendations:** Add content-type validation (magic bytes), file size limits per endpoint, and Zip bomb protection for plugin uploads.

### 24. No HTTPS in Production Configuration

- **Issue:** `httpServer.listen(PORT, '0.0.0.0')` binds to plain HTTP. The session cookie lacks the `Secure` flag. There's no mention of TLS termination or reverse proxy configuration.
- **Files:** `server.ts:5005`
- **Recommendations:** Document reverse proxy (nginx/Caddy) setup for TLS termination. Add `Secure` cookie flag conditional on `NODE_ENV === 'production'`.

---

## Data Concerns

### 25. No Database Backup Strategy

- **Issue:** SQLite database is a single file (`educational_os.db`) in the project root. There is no backup mechanism, no backup schedule, and no documented recovery procedure.
- **Files:** `packages/core/db/index.ts:23` (dbPath)
- **Recommendations:**
  - Implement periodic `VACUUM INTO` or file-copy backup
  - Store backups off-instance
  - Document disaster recovery procedure

### 26. Student Data Privacy

- **Issue:** Student names, emails, passwords, attendance records, grades, private notes are all stored in a single unencrypted SQLite file. No data retention policy, no GDPR/CCPA compliance measures (no export API, no deletion API for individual student data).
- **Files:** `packages/core/db/index.ts:112-121` (students table), `server.ts` grade/attendance endpoints
- **Recommendations:**
  - Add student data export endpoint
  - Add complete student data deletion (right to be forgotten)
  - Implement data retention policy

---

## Performance Concerns

### 27. No Caching Layer

- **Issue:** Every API request hits the database directly. Frequently accessed data (lesson lists, class rosters, schedules) is re-queried on every render with no in-memory or distributed cache.
- **Impact:** Under classroom load (30 students + teacher all polling), SQLite will become the bottleneck.
- **Recommendations:** Add in-memory cache (LRU cache or `Map` with TTL) for read-heavy endpoints like `/api/lessons`, `/api/classes`, `/api/schedules`.

### 28. Vite Middleware in Development with File Watching

- **Issue:** In development mode, Vite runs with full HMR and file watching (`watch: {}` by default unless `DISABLE_HMR=true`). This consumes significant CPU/memory on the same process as the API server.
- **Files:** `server.ts:4970-4975`, `vite.config.ts:17-19`
- **Recommendations:** Document `DISABLE_HMR=true` as a performance optimization for development.

### 29. Bridge.js MutationObserver on Every Page

- **Issue:** The bridge SDK (`bridge.js`) attaches a `MutationObserver` on `document.body` with `subtree: true` on every courseware page, and scans the entire DOM for score elements. On large DOM trees this will cause jank.
- **Files:** `server.ts:1824-1828` (bridge SDK inline code)
- **Recommendations:** Limit observer scope; use debounced observation; add observer disconnect when score is successfully extracted.

---

## Dependencies at Risk

### 30. better-sqlite3 Native Dependency

- **Risk:** `better-sqlite3` is a native compiled module (C++ addon). It requires `node-gyp`, Python, and a C++ toolchain for installation. This adds deployment complexity and CI overhead.
- **Impact:** Any Node.js version upgrade or platform change may fail to install.
- **Migration plan:** Consider `sql.js` (WebAssembly) for simpler deployment, or ensure prebuilt binaries via `@jitl/quickjs-singlefile`-style packages.

### 31. TypeScript `~5.8.2` — Frequent Major Updates

- **Risk:** Using tilde-range `~5.8.2` pins to minor patches only. TypeScript frequently introduces breaking changes; staying on a specific minor may miss security fixes.
- **Recommendations:** Use `^5.8.2` for semver-compatible updates, and add `typescript` to Dependabot/renovate monitoring.

---

## Missing Critical Features

### 32. No Student Account Management Self-Service

- **Issue:** Students cannot change their own passwords, cannot manage their profiles, cannot self-register. All student management must be done by a teacher/administrator.
- **Files:** `server.ts:3080-3088` (update endpoint requires teacher role check)

### 33. No Audit Trail Retention

- **Issue:** Events are logged to the `events` table (`kernel.initAuditLog()`) but there is no log rotation, no archive policy, and no query interface. The events table will grow unbounded.
- **Files:** `packages/core/kernel/index.ts:58-72`
- **Recommendations:** Add periodic cleanup of old events (e.g., retain 90 days). Provide an admin API to query the audit log.

---

*Concerns audit: 2026-06-17*
