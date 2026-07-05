# OpenLearn Next V2 Plugin Platform — Architecture Review Report

**Reviewer Perspective**: Platform Architect / Plugin Ecosystem Designer
**Review Date**: 2026-07-05
**Document Scope**: Full plugin platform architecture as described in docs_plugin_guide.md (v2.4), source code interfaces, and planning documents.
**Review Horizon**: 3–5–10 year platform viability

---

# Phase 1: Architecture Review

## 1. Overall Evaluation

| Dimension | Score (1–10) | Assessment |
|---|---|---|
| **Maturity** | 6.5 | Solid v1.0 foundation. Core runtime works. Missing ecosystem infrastructure (marketplace, SDK, CLI, signing). |
| **Extensibility** | 5.0 | Extension points are implicit (hardcoded MFE slots). No formal Contribution Model. Adding new extension types requires kernel changes. |
| **Module Separation** | 7.5 | Clean separation: `di/`, `command-bus/`, `event-bus/`, `plugin-host/`, `registry/`, `worker-runtime/`. Well-factored packages. |
| **Security** | 7.0 | Worker sandbox + Capability guard + require rewrite is solid. Missing: signing, runtime permission escalation, audit log, network policy. |
| **Developer Experience** | 4.5 | No CLI, no generator, no DevTools, no test harness, no type-safe SDK package. Developers import from relative source paths (`../../core/plugin-host/types.js`). |
| **Learning Curve** | 6.0 | Good documentation with 16 cookbook recipes. But dual Action+Command registration pattern is confusing. No interactive playground. |
| **Long-term Maintenance** | 5.5 | No API versioning enforcement. No deprecation tooling. Hard-coded quota values. Single-file manifest schema. |
| **Plugin Ecosystem Capability** | 3.5 | No marketplace, no publisher identity, no plugin discovery, no ratings, no compatibility matrix, no update channel. |
| **AI Native Capability** | 7.0 | ActionRegistry + Planner integration is genuinely ahead of most platforms. Missing: tool cost, composition, agent memory, MCP bridge. |

**Composite Score: 5.8 / 10**

The platform has a well-engineered runtime kernel but lacks the ecosystem scaffolding required to support an open developer community.

---

## 2. Strengths

### S1: Worker Thread Sandbox with Resource Quotas
The decision to use physical Node.js Worker Threads (not `vm` module) provides true process-level isolation. The combination of V8 heap limits (128 MB), execution timeouts (10s), and native module blocking creates a defense-in-depth model that is more robust than most education platform plugins systems. This is on par with VS Code's Extension Host process isolation.

### S2: Capability-Based Security Model
The `CapabilityGuard` with mandatory manifest declaration (`capabilitiesProposed`) follows the Principle of Least Privilege. The pattern of declaring capabilities at install time and checking them at call time mirrors Chrome Extension's permissions model. The high-risk approval gateway for non-admin actors is a thoughtful education-domain-specific addition.

### S3: CommandBus as Unified Operation Channel
Routing all mutations through `CommandBus` with interceptors enables undo/redo, audit logging, teacher approval workflows, and cross-process dispatch through a single chokepoint. This is textbook CQRS and directly enables future features like operation replay, conflict resolution, and distributed sync.

### S4: AI-Native ActionRegistry
The tight integration between `ActionRegistry` and the AI Planner (with Google GenAI-compatible `inputSchema`) positions this platform ahead of VS Code, JetBrains, and Chrome in the AI-native plugin story. Plugins automatically become AI-callable tools without additional integration work. This is a genuine architectural moat.

### S5: ResourceTracker for Deterministic Cleanup
The `Disposable` pattern with ordered cleanup and `snapshot`/`reap` for hot-reload scenarios prevents the most common class of plugin platform bugs: leaked event listeners, orphaned timers, and dangling process references. The implementation is clean and battle-tested.

### S6: Namespace-Isolated Database with Declarative Migration
`ctx.db` with automatic table name prefixing (`plugin_{uuid}_{table}`) and idempotent `migrate()` is a pragmatic solution to the plugin data isolation problem. It avoids the complexity of per-plugin SQLite files while providing clean boundaries.

### S7: Hot Reload with State Transfer (prevState)
The `deactivate() → prevState → activate(ctx, prevState)` pattern for zero-downtime upgrades during live classroom sessions is a domain-aware design that most plugin platforms lack entirely. This is critical for educational contexts where a classroom session cannot be interrupted.

---

## 3. Weaknesses

### W1: No Formal Extension Point / Contribution Model — **Critical**
The platform has no declarative system for plugins to contribute to well-defined extension points. UI contributions (menus, toolbar buttons, panels) are registered via imperative `frontendCtx.registerMenu(...)` calls in JavaScript. There is:
- No manifest-level declaration of contributions (compare VS Code's `"contributes"` in `package.json`).
- No schema validation of contribution shapes at install time.
- No way for the host to enumerate all possible extension points.
- No way for a plugin to contribute to extension points that don't exist yet.

**Future cost**: Every new extension point requires kernel code changes. Plugins cannot compose or extend each other's extension points.

### W2: No Plugin SDK Package — **Critical**
Plugins import types via relative filesystem paths (`../../core/plugin-host/types.js`). This creates:
- Tight coupling to monorepo directory structure.
- No versioned contract between host and plugin.
- No way for external developers to author plugins outside the monorepo.
- No IntelliSense or type checking in standalone plugin projects.

### W3: Implicit Plugin-to-Plugin Communication — **High**
Cross-plugin communication is only possible via:
1. EventBus (broadcast, no request-response).
2. DI Token resolution (tightly coupled to core tokens).
3. CommandBus (no namespace isolation — any plugin can register any command type).

There is no formal Service Export/Import contract. Plugin A cannot declare "I provide `IQuestionBankService`" and Plugin B cannot declare "I require `IQuestionBankService` from `ext-question-bank`".

### W4: Single-Process SQLite Bottleneck — **High**
All plugins share a single SQLite database file. At 100+ plugins with 10,000-row limits each, the single SQLite writer lock becomes a contention point. There is no connection pooling, no read replica strategy, and no per-plugin database file option.

### W5: CommandBus Type Erasure — **Medium**
`commandBus.execute()` returns `Promise<unknown>`. All command payloads are `any`-cast. There is no type-safe contract between command dispatch and handler registration. This will cause increasing maintenance burden as the number of built-in commands grows.

### W6: No Plugin Dependency Resolution — **Medium**
The `requires` field in manifest lists DI tokens, not other plugins. There is:
- No way to declare "this plugin depends on `ext-question-bank >= 2.0.0`".
- No topological sort of plugin activation order based on inter-plugin dependencies.
- No cycle detection between plugins.
- No graceful degradation when optional plugin dependencies are missing.

### W7: Hardcoded MFE Slot Identifiers — **Medium**
Extension slots (`teacher.panel`, `student.panel`, `classroom.tool`) are hardcoded strings. Adding a new slot (e.g., `admin.dashboard`, `parent.view`, `grader.sidebar`) requires coordinated changes across host frontend, backend, and documentation.

### W8: No Configuration Schema System — **Low → Grows to Critical**
Plugin settings are read via `commandBus.execute({ type: 'system.get_plugin_settings' })` with no schema, no validation, no auto-generated settings UI, and no scoping (global vs. per-workspace vs. per-user). Compare VS Code's `"configuration"` contribution with JSON Schema.

---

## 4. Risk Analysis

### Scale: 100 plugins
- **Performance**: Acceptable. 100 Worker threads are manageable on modern servers (2–4 GB overhead).
- **Compatibility**: Manual testing feasible. No automated compatibility matrix needed yet.
- **Command namespace conflicts**: Increasingly likely. Two plugins may register `scores.update`.
- **Risk level**: 🟢 Low

### Scale: 1,000 plugins
- **Performance**: 1,000 Worker threads will require worker pooling or lazy activation. Memory: ~128 GB theoretical max. Need on-demand activation based on context (lesson type, user role).
- **SQLite contention**: Writer lock becomes severe bottleneck. Need WAL mode at minimum, likely per-plugin DB files.
- **Command namespace**: Mandatory namespacing needed (`{pluginId}.{command}`).
- **Dependency resolution**: Manual management impossible. Need automated topological sort.
- **Marketplace**: Essential. Cannot discover plugins without search, categories, ratings.
- **Risk level**: 🟡 Medium — Requires W1, W2, W3, W6 to be resolved.

### Scale: 5,000+ plugins
- **Architecture**: Requires fundamental shift to lazy activation, plugin process pooling, and potentially multi-node distribution.
- **API stability**: Any breaking change affects thousands of developers. Need formal API lifecycle management with deprecation warnings, migration tooling, and compatibility shims.
- **Security**: Need code signing, publisher verification, automated security scanning, sandboxed network policies.
- **Trust**: Need publisher reputation system, plugin review process, abuse reporting.
- **Risk level**: 🔴 High — Requires V3.0+ architectural changes.

### Scale: 10,000+ plugins
- **Beyond current architecture's design horizon.** Would require federated plugin registries, CDN-based distribution, A/B testing infrastructure, and enterprise-grade SLA guarantees.
- **Risk level**: ⚫ Requires platform rewrite for distribution layer.

---

# Phase 2: Architecture Gap Analysis

## Comparison Matrix

| Capability | OpenLearn v2.4 | VS Code | JetBrains | Chrome Ext | K8s | Obsidian | Home Assistant | Moodle |
|---|---|---|---|---|---|---|---|---|
| **Contribution Model** | ❌ Imperative | ✅ Declarative `"contributes"` | ✅ `plugin.xml` | ✅ `manifest.json` | ✅ CRD | ❌ Imperative | ✅ YAML manifest | ✅ `db/install.xml` |
| **Plugin SDK Package** | ❌ Relative imports | ✅ `@types/vscode` | ✅ IntelliJ SDK | ✅ Chrome types | ✅ client-go | ✅ `obsidian` npm | ✅ PyPI package | ✅ Moodle API |
| **Plugin CLI** | ❌ None | ✅ `yo code` | ✅ gradle plugin | ❌ None | ✅ `operator-sdk` | ❌ None | ✅ `ha` CLI | ✅ `moosh` |
| **Marketplace** | ❌ None | ✅ Full | ✅ Full | ✅ Chrome Web Store | ✅ OperatorHub | ✅ Community | ✅ HACS | ✅ Moodle plugins |
| **Plugin Dependencies** | ⚠️ DI tokens only | ✅ `extensionDependencies` | ✅ `depends` | ❌ None | ✅ OLM | ❌ None | ✅ `dependencies` | ✅ `$dependencies` |
| **Configuration Schema** | ❌ None | ✅ JSON Schema | ✅ Settings API | ❌ None | ✅ CRD validation | ✅ `settings` tab | ✅ `config_flow` | ✅ `settings.php` |
| **State Management** | ⚠️ IStorageService KV | ✅ Memento + Secrets | ✅ PersistentState | ✅ `chrome.storage` | ✅ etcd / CRD | ✅ per-vault | ✅ entity state | ✅ DB + cache |
| **Plugin Signing** | ❌ None | ✅ Marketplace | ✅ Marketplace | ✅ CWS | ✅ Image signing | ❌ None | ❌ None | ❌ None |
| **Test Framework** | ⚠️ Manual Vitest | ✅ `@vscode/test-electron` | ✅ `intellij-test-framework` | ❌ None | ✅ envtest | ❌ None | ❌ None | ✅ PHPUnit |
| **API Versioning** | ⚠️ Documented only | ✅ `engines.vscode` | ✅ `since-build` | ✅ `minimum_chrome_version` | ✅ API groups | ❌ None | ✅ HA version | ✅ `$requires` |
| **AI Native** | ✅ ActionRegistry + Planner | ⚠️ Copilot Extension API | ❌ None | ⚠️ Gemini Nano | ❌ None | ❌ None | ❌ None | ❌ None |

## Detailed Gap Analysis

### ① Plugin Dependency
**Gap**: No inter-plugin dependency declaration, no SemVer constraint resolution, no activation ordering, no cycle detection.
**What's needed**: `manifest.json` should support `"pluginDependencies": { "ext-question-bank": "^2.0.0" }` with topological activation sort.

### ② Extension Point / Contribution Model
**Gap**: This is the single largest architectural gap. No declarative `"contributes"` block in manifest. Extension points are implicit string constants.
**What's needed**: A formal `ContributionRegistry` where the host declares extension point schemas and plugins contribute to them declaratively.

### ③ Plugin Service Export/Import
**Gap**: Plugins cannot export typed services for other plugins to consume. All cross-plugin communication goes through EventBus (fire-and-forget) or CommandBus (untyped).
**What's needed**: `manifest.json` should support `"provides": [{ "token": "IQuestionBankService", "implementation": "./services/question-bank.js" }]` and consumers use `"requires": ["ext-question-bank:IQuestionBankService"]`.

### ④ Configuration System
**Gap**: No schema-driven configuration. No per-scope settings. No auto-generated admin UI.
**What's needed**: `manifest.json` → `"configuration": { "properties": { "maxQuestions": { "type": "number", "default": 50 } } }` with JSON Schema validation and auto-generated settings panel.

### ⑤ State Management
**Gap**: Only `IStorageService` (flat KV). No scoped state (workspace/lesson/student/session).
**What's needed**: `ctx.state.global.get(key)`, `ctx.state.lesson(lessonId).get(key)`, `ctx.state.student(studentId).get(key)`.

### ⑥ Storage
**Gap**: No transaction support in `ctx.db`. No blob storage API. No backup/restore per plugin.
**What's needed**: `ctx.db.transaction(async (tx) => { ... })`, `ctx.blob.put(key, buffer)`, `ctx.db.backup()`.

### ⑦ Marketplace
**Gap**: Complete absence. No publisher identity, no discovery, no ratings, no compatibility, no signing, no update channel.
**What's needed**: This is a large infrastructure project that should be planned for V3.0+.

### ⑧ Versioning
**Gap**: API lifecycle stages are documented but not enforced. No `@experimental` decorator. No runtime deprecation warnings. No `engines.openlearn` in manifest.
**What's needed**: `manifest.json` → `"engines": { "openlearn": "^2.4.0" }` with host-side compatibility checking.

### ⑨ Capability Granularity
**Gap**: Capabilities are flat strings. No permission groups, no dynamic/temporary permissions, no runtime permission request.
**What's needed**: Permission groups (`"storage:*"` → `"storage:read"`, `"storage:write"`), runtime request dialog (`ctx.capabilities.request('camera:capture')`).

### ⑩ Lifecycle
**Gap**: Only `Installed → Activating → Active → Deactivating → Error`. Missing: `Disabled`, `Suspended`, `Upgrading`, `Repairing`.
**What's needed**: `Disable` (admin turns off without uninstall), `Suspend` (system pauses under memory pressure), `Upgrade` (distinct from activate, carries migration context).

### ⑪ Plugin Communication
**Gap**: No request-response RPC between plugins. No service discovery. No shared state.
**What's needed**: `ctx.rpc.call('ext-question-bank', 'getQuestion', { id: 'q1' })`.

### ⑫ Background Task
**Gap**: `IProcessService` provides spawn/kill/interval but no job queue, no retry, no cancellation token, no progress reporting.
**What's needed**: `ctx.jobs.schedule({ type: 'export', payload, retries: 3, onProgress })`.

### ⑬ Logging / Observability
**Gap**: Logging is via CommandBus dispatch (`system.log`), not a first-class API. No metrics, no health checks, no telemetry.
**What's needed**: `ctx.log.info('message', { traceId })`, `ctx.metrics.increment('exports.count')`, `ctx.health.report({ status: 'healthy' })`.

### ⑭ Testing
**Gap**: No mock framework, no plugin test host, no fixture system. Developers must boot a full Kernel.
**What's needed**: `@openlearn/plugin-test-kit` with `createMockContext()`, `createMockCommandBus()`, etc.

### ⑮ AI Native
**Gap**: ActionRegistry is strong but missing: tool cost estimation, tool composition chains, agent memory context, MCP (Model Context Protocol) bridge, multi-turn conversation awareness.
**What's needed**: `ActionDescriptor.cost`, `ActionDescriptor.composable`, `ctx.agent.memory`, MCP server adapter.

---

# Phase 3: Design Improvement Proposals

## Proposed New Modules (Priority Order)

| # | Module | Purpose | Priority | Effort |
|---|---|---|---|---|
| 1 | **Plugin SDK (`@openlearn/plugin-sdk`)** | Published npm package with types, base classes, test utilities | P0 | Medium |
| 2 | **Plugin CLI (`@openlearn/cli`)** | `npx @openlearn/cli create`, `build`, `test`, `pack`, `publish` | P0 | Medium |
| 3 | **Plugin Test Kit** | `createMockContext()`, mock services, assertion helpers | P0 | Low |
| 4 | **Contribution Registry** | Declarative extension point system with schema validation | P0 | High |
| 5 | **Plugin Dependency Resolver** | Topological sort, SemVer constraint solving, cycle detection | P1 | Medium |
| 6 | **Configuration Service** | JSON Schema-based settings with scoping and auto UI | P1 | Medium |
| 7 | **Plugin Signing Service** | SHA-256 manifest signing, publisher identity verification | P1 | Medium |
| 8 | **Structured Logger** | First-class `ctx.log` API replacing CommandBus dispatch | P1 | Low |
| 9 | **Scoped State Service** | Global / Workspace / Lesson / Student / Session state | P2 | Medium |
| 10 | **Plugin Marketplace** | Registry, search, ratings, compatibility, update channel | P2 | Very High |
| 11 | **Plugin DevTools / Inspector** | Runtime inspection of registered commands, events, resources | P2 | Medium |
| 12 | **Plugin Health Monitor** | Crash reporting, memory tracking, latency metrics per plugin | P2 | Medium |
| 13 | **Plugin Profiler** | Per-plugin CPU/memory flame graphs, RPC latency histograms | P3 | High |
| 14 | **Plugin Analytics** | Usage metrics, activation counts, error rates | P3 | Medium |
| 15 | **MCP Bridge** | Model Context Protocol server exposing plugin Actions | P3 | Medium |

---

# Phase 4: API Governance Audit

## 4.1 Naming Inconsistencies

| Issue | Current | Recommendation |
|---|---|---|
| Manifest entry field | `main` (v2.4) vs `entry` (legacy code) | Standardize on `main`. Add Zod migration that rejects `entry`. |
| Command type naming | Mix of `verb.noun` (`whiteboard.draw`) and `noun.verb` (`scores.modify`) | Standardize: `{domain}.{verb}` (e.g., `whiteboard.draw`, `scores.modify`). |
| Event type naming | Mix of `:` separator (`scores:updated`) and `.` separator in commands | Events use `:`, Commands use `.`. Document this convention explicitly. |
| Service naming | `processManager` in ctx.services vs `IProcessService` in interface | Keep both; document the mapping. |

## 4.2 Return Type Issues

| API | Current Return | Problem | Recommendation |
|---|---|---|---|
| `commandBus.execute()` | `Promise<unknown>` | Total type erasure | Introduce generic overloads: `execute<R>(cmd): Promise<R>` |
| `actionRegistry.getAgentTools()` | `Promise<unknown[]>` | Should be typed | `Promise<GoogleFunctionDeclaration[]>` |
| `storage.get()` | `Promise<unknown>` | No type safety | `get<T>(key: string): Promise<T \| null>` |

## 4.3 Error Handling Inconsistencies

| Service | Error Strategy | Problem |
|---|---|---|
| CommandBus | Throws `CapabilityDeniedError`, `CommandExecutionError` | ✅ Good — typed errors |
| EventBus | Swallows errors silently | ❌ Should at least log failed subscribers |
| PluginDatabaseAPI | Throws `DatabaseMigrationError` | ✅ Good |
| Capability | Throws `SecurityRevokeError` | ⚠️ Only on revoke. `check()` returns boolean — should this throw? |
| Storage | Returns `null` for missing keys | ⚠️ Inconsistent with DB which throws |

**Recommendation**: Establish an `OpenLearnPluginError` base class hierarchy. All plugin-facing errors should extend it with machine-readable error codes.

## 4.4 Capability String Inconsistencies

| Current Usage | Pattern |
|---|---|
| `whiteboard:write` | `{domain}:{action}` |
| `plugin:read` | `{domain}:{action}` |
| `vfs:write` | `{domain}:{action}` |
| `ui:menu` | `{domain}:{type}` — different pattern! |
| `ui:panel` | `{domain}:{type}` |
| `process:interval` | `{domain}:{type}` — different pattern! |
| `http:outbound` | `{domain}:{direction}` — different pattern! |
| `db:schema` | `{domain}:{aspect}` — different pattern! |

**Recommendation**: Standardize all capabilities to `{domain}:{verb}` pattern: `ui:register`, `process:spawn`, `http:fetch`, `db:migrate`. Publish a capability taxonomy document.

---

# Phase 5: Roadmap

## V2.5 — Developer Experience (Target: Q3 2026)

| Feature | Rationale |
|---|---|
| **`@openlearn/plugin-sdk` npm package** | Break the relative import dependency. Publish versioned types. |
| **`@openlearn/plugin-test-kit`** | `createMockContext()`, service mocks, inline activation test helper. |
| **`npx @openlearn/cli create`** | Scaffold a plugin with manifest, entry file, test, tsconfig. |
| **Structured Logger API** | `ctx.log.info/warn/error` as first-class citizens. |
| **`engines.openlearn` manifest field** | Host-side compatibility check at install time. |
| **Command namespace enforcement** | Auto-prefix all plugin command types with `{pluginId}.` |
| **Capability taxonomy v1** | Published, documented, validated list of all valid capability strings. |

## V3.0 — Platform Foundation (Target: Q1 2027)

| Feature | Rationale |
|---|---|
| **Contribution Registry** | Declarative `"contributes"` in manifest. Schema-validated extension points. |
| **Plugin Dependency Resolver** | Inter-plugin dependencies with SemVer constraints, topological sort, cycle detection. |
| **Configuration Service** | JSON Schema-driven settings with auto-generated admin UI. Scoped (global, org, user). |
| **Scoped State Service** | `ctx.state.global`, `ctx.state.lesson(id)`, `ctx.state.student(id)`. |
| **Plugin Signing** | SHA-256 manifest + bundle hashing. Publisher identity verification. |
| **Plugin-to-Plugin RPC** | `ctx.rpc.call('ext-other-plugin', 'method', args)` with typed contracts. |
| **Lifecycle: Disable/Suspend** | Admin can disable without uninstall. System can suspend under memory pressure. |
| **Job Queue** | Replace `registerInterval` with proper job queue: retry, cancel, progress. |

### Deprecations in V3.0
| API | Replacement | Reason |
|---|---|---|
| `ctx.require(moduleName)` | `import` from SDK or shared package | `require()` is a CJS pattern incompatible with ESM future |
| Relative type imports | `@openlearn/plugin-sdk` | Break monorepo coupling |
| `commandBus.execute({ type: 'system.log' })` | `ctx.log.info()` | Logging is not a command |

## V4.0 — Ecosystem (Target: Q4 2027)

| Feature | Rationale |
|---|---|
| **Plugin Marketplace** | Registry, search, categories, ratings, install-from-marketplace API. |
| **Plugin Update Service** | Automatic update checking, staged rollouts, rollback. |
| **MCP Bridge** | Expose ActionRegistry as MCP server for external AI agents. |
| **Plugin DevTools** | Browser panel showing active plugins, registered commands, events, resource usage. |
| **Plugin Health Monitor** | Crash rates, memory trends, RPC latency per plugin. Dashboard. |
| **Agent Workflow Composition** | Chain multiple Actions into declarative workflows. |
| **Multi-tenant Plugin Scoping** | Per-organization plugin installation and capability policies. |

---

# Phase 6: Design Principles

## The 15 Core Design Principles of the OpenLearn Plugin Platform

### Runtime Principles

**1. Sandbox by Default**
All third-party code executes in an isolated Worker Thread with resource quotas. No exceptions. Trust is earned through capability grants, not assumed.

**2. Capability-First Security**
Every privileged operation requires an explicit, auditable capability declaration in the manifest. The principle of least privilege is not a guideline — it is enforced by the runtime.

**3. Command-Driven Mutation**
All state changes flow through the CommandBus. Direct mutation of shared state is architecturally forbidden. This enables audit trails, undo/redo, approval workflows, and distributed replay.

**4. Event-Driven Observation**
State observation is decoupled from state mutation. Plugins observe the world through EventBus subscriptions, never by polling or direct property access. Events are the only cross-boundary notification mechanism.

### API Principles

**5. Stable Contracts, Evolving Implementations**
Public API surfaces (interfaces, Token identifiers, event type strings, manifest schema) are contracts. They follow strict SemVer. Implementations behind contracts can change freely.

**6. Declare, Don't Impeach**
Plugins should declare their intentions (capabilities, contributions, dependencies, configuration schema) in the manifest. The runtime interprets declarations. Imperative registration is a fallback, not the primary pattern.

**7. Type-Safe Boundaries**
Every API boundary between host and plugin should carry full TypeScript type information. `unknown` and `any` are code smells at API boundaries.

**8. Explicit Over Implicit**
No magic. No convention-over-configuration. If a plugin needs something, it declares it. If the host provides something, it's documented in the SDK. Hidden behaviors are bugs.

### Lifecycle Principles

**9. Graceful Degradation**
A failing plugin must never crash the host. A missing dependency should disable the dependent, not the platform. Resource exhaustion should trigger containment, not propagation.

**10. Deterministic Cleanup**
Every resource allocated by a plugin (listeners, timers, handlers, DB tables, files) must be tracked and deterministically released when the plugin is deactivated. ResourceTracker is not optional — it is the law.

**11. Zero-Downtime Upgrades**
Plugin upgrades during live classroom sessions must preserve in-flight state. The `prevState` transfer mechanism is a core platform guarantee, not a convenience feature.

### Ecosystem Principles

**12. Plugin First**
If a feature can be implemented as a plugin, it should be. Core kernel features exist to enable plugins, not to replace them. The kernel's job is to be small, stable, and extensible.

**13. AI Native**
Every plugin capability should be discoverable and invocable by AI agents. ActionRegistry is not an add-on — it is a first-class pillar equal to CommandBus and EventBus.

**14. Extensibility Over Customization**
The platform provides extension points, not configuration switches. Plugins extend behavior; they don't merely toggle features. The ContributionRegistry is the mechanism; runtime flags are the anti-pattern.

**15. Single Source of Truth**
Every piece of knowledge (an API signature, a capability definition, a configuration default) exists in exactly one place. Cross-references replace duplication. The SDK package is the truth; documentation is generated from it.

---

# Phase 7: Final Recommendations

## ① Current Architecture Score

| Aspect | Score |
|---|---|
| **Runtime Kernel** | 7.5 / 10 |
| **Security Model** | 7.0 / 10 |
| **Developer Experience** | 4.5 / 10 |
| **Ecosystem Readiness** | 3.5 / 10 |
| **AI Integration** | 7.0 / 10 |
| **Overall Platform Maturity** | **5.8 / 10** |

## ② Immediately Actionable Improvements (< 2 weeks each)

1. **Publish `@openlearn/plugin-sdk`** — Extract types, interfaces, and Token exports into a standalone npm package. This is the single highest-ROI change.
2. **Add `engines.openlearn` to manifest schema** — One line in Zod schema. Enables future compatibility checking.
3. **Auto-prefix command types** — When a plugin registers `scores.update`, the host stores it as `ext-my-plugin.scores.update`. Prevents namespace collisions.
4. **Replace `system.log` command with `ctx.log`** — Wrap the existing mechanism behind a proper Logger interface. Zero architectural change, massive DX improvement.
5. **Add `ctx.db.transaction()`** — Wrap `better-sqlite3` transaction API.  Prevents partial writes.

## ③ Recommended for V2.5

- Plugin SDK package
- Plugin CLI scaffolding tool
- Plugin Test Kit with mock context
- Structured logging API
- Command namespace enforcement
- Capability taxonomy v1
- `engines.openlearn` compatibility check

## ④ Recommended for V3.0

- Contribution Registry (declarative extension points)
- Plugin Dependency Resolver
- Configuration Service with auto-UI
- Scoped State Service
- Plugin Signing
- Plugin-to-Plugin typed RPC
- Disable/Suspend lifecycle states
- Job Queue with retry/cancel/progress

## ⑤ Designs to Preserve Long-Term (Do Not Refactor)

| Design | Why |
|---|---|
| **Worker Thread sandbox** | Correct isolation model. Physical process separation is the only reliable security boundary. |
| **CommandBus + Interceptor pipeline** | Fundamental to undo/redo, audit, approval. It is the CQRS backbone. |
| **ResourceTracker + Disposable pattern** | Prevents the #1 class of plugin bugs. |
| **Token-based DI container** | Clean, typed, extensible. |
| **ActionRegistry with inputSchema** | AI-native competitive advantage. |
| **prevState hot-reload mechanism** | Domain-critical for education use case. |
| **Capability manifest declaration** | Right security model. |

## ⑥ Designs That Need Fundamental Rethinking

| Design | Problem | Direction |
|---|---|---|
| **Implicit MFE slot registration** | No extensibility, no composability | → Contribution Registry |
| **`ctx.require()` for shared modules** | CJS pattern, hardcoded whitelist | → ESM imports from SDK, dynamic import() |
| **`commandBus.execute({ type: 'system.log' })` for logging** | Logging is not a mutation command | → First-class Logger service |
| **Flat capability strings with inconsistent patterns** | `ui:menu` vs `whiteboard:write` | → Standardized `{domain}:{verb}` taxonomy |
| **Manifest `main` vs `entry` ambiguity** | Historical artifact | → Strict `main` only, reject `entry` |

## ⑦ New Modules to Build

| Priority | Module |
|---|---|
| **P0** | `@openlearn/plugin-sdk`, `@openlearn/cli`, `@openlearn/plugin-test-kit` |
| **P1** | ContributionRegistry, DependencyResolver, ConfigurationService, PluginSigner |
| **P2** | Marketplace, StateService, DevTools, HealthMonitor |
| **P3** | MCPBridge, PluginProfiler, PluginAnalytics, WorkflowEngine |

## ⑧ Modules to Remove or Merge

| Module | Action | Reason |
|---|---|---|
| `system.log` command pattern | **Remove** | Replace with `ctx.log` first-class API |
| `system.get_plugin_settings` command | **Remove** | Replace with `ctx.config` first-class API |
| `ctx.require()` | **Deprecate in V3.0, Remove in V4.0** | Replace with ESM-native import from SDK |
| `PLUGIN_SHARED_MODULES` hardcoded array | **Deprecate** | Replace with SDK-level package re-exports |

## ⑨ Final Maturity Assessment

| Dimension | Current | After V2.5 | After V3.0 | After V4.0 |
|---|---|---|---|---|
| Runtime Kernel | 7.5 | 8.0 | 8.5 | 9.0 |
| Security | 7.0 | 7.5 | 8.5 | 9.0 |
| Developer Experience | 4.5 | 7.0 | 8.0 | 8.5 |
| Ecosystem | 3.5 | 4.5 | 6.5 | 8.0 |
| AI Native | 7.0 | 7.5 | 8.0 | 9.0 |
| **Overall** | **5.8** | **6.9** | **7.9** | **8.7** |

---

## Closing Statement

The OpenLearn Next V2 plugin platform has built something genuinely valuable: a **secure, AI-native, education-domain-aware** runtime kernel. The Worker sandbox, CommandBus, CapabilityGuard, and ActionRegistry form a strong technical foundation that most competing education platforms lack entirely.

The critical gap is not in the runtime — it is in the **ecosystem infrastructure**. The platform currently resembles a well-engineered engine block without a chassis, dashboard, or dealer network. The path from "a plugin system that works" to "a plugin platform that attracts developers" requires three strategic investments:

1. **Developer Experience** (SDK + CLI + Test Kit) — V2.5
2. **Platform Governance** (Contributions + Dependencies + Configuration + Signing) — V3.0
3. **Ecosystem Infrastructure** (Marketplace + Updates + Analytics + DevTools) — V4.0

The architectural DNA is sound. The roadmap to world-class is clear. Execute V2.5 and V3.0 well, and this platform can genuinely support thousands of plugins over a decade-long lifecycle.
