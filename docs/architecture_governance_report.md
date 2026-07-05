# OpenLearn Plugin Platform — Architecture Governance Report

**Purpose**: For each proposed platform improvement, answer 8 mandatory governance questions before any implementation decision.
**Principle**: The goal is not "most features" but **a consistent, minimal, extensible, evolvable** plugin architecture.

---

# Proposal 1: Plugin SDK Package (`@openlearn/plugin-sdk`)

## Q1: Why is this needed? What real problem does it solve?

Today, plugin authors import types via relative filesystem paths:

```typescript
import type { PluginContext } from '../../core/plugin-host/types.js';
import { IDatabaseToken } from '../../core/di/interfaces.js';
```

This creates three concrete problems:
- **External authoring is impossible.** A developer outside the monorepo cannot write a plugin. There is no published contract.
- **Version coupling is invisible.** When `PluginContext` changes, no SemVer boundary signals the break. Plugins silently compile against whatever `types.ts` happens to be in the tree.
- **IDE support degrades.** Standalone plugin projects have no IntelliSense, no type checking, no autocompletion for the platform API.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The current mechanism is "copy the types file into your plugin project." This works for in-monorepo plugins but breaks the fundamental contract between a platform and its ecosystem: **the platform publishes a stable interface; developers code against it.**

No existing mechanism provides versioned, published type contracts.

## Q3: Classification

**SDK (Developer Experience).** The SDK does not change runtime behavior. It is a packaging and distribution concern.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Can author plugins outside the monorepo. Gets IntelliSense, type checking, autocompletion. Knows exactly which API version they target. |
| **Platform maintainer** | Can enforce SemVer on the public API surface. Internal refactoring no longer accidentally breaks plugin contracts. |
| **End user** | Indirect: more plugins exist because authoring is easier. Plugins are more reliable because types are checked. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: One new npm package to publish and version. A build step to extract public types from internal sources.

**Complexity removed**: Eliminates the implicit, fragile coupling between plugin code and monorepo directory layout. Eliminates the "which version of types.ts am I using?" question.

**Verdict**: Net reduction in system-wide complexity. Worth it unconditionally.

## Q6: Industry precedent

| Platform | Approach | Key difference from OpenLearn's situation |
|---|---|---|
| **VS Code** | `@types/vscode` — a DefinitelyTyped package auto-generated from the engine. Developers install it as a devDependency and target a specific `engines.vscode` version. | VS Code's API surface is vastly larger (~2,000 types). OpenLearn's is compact (~20 types), so the SDK can be hand-curated rather than auto-generated. |
| **Obsidian** | `obsidian` npm package — contains the full API as TypeScript declarations. Developers `import { Plugin, PluginSettingTab } from 'obsidian'`. | Obsidian ships the SDK as a single package with runtime code. OpenLearn should ship types-only to keep the SDK lightweight and avoid bundling runtime dependencies. |
| **Chrome Extensions** | `@types/chrome` — purely declarative. No runtime code. | Chrome's API is message-based, similar to OpenLearn's RPC model. The type-declaration-only approach is the right fit. |

**Recommendation**: Follow the Obsidian model (single `@openlearn/plugin-sdk` package) but with VS Code's discipline (types + Token exports only, no runtime code).

## Q7: When to introduce?

**V2.5.** This is a prerequisite for every other improvement. Without a published SDK, no external developer can use any new feature. It gates the entire ecosystem roadmap.

## Q8: Integration with existing architecture

The SDK is a **projection** of existing architecture, not a new system:

```
packages/core/plugin-host/types.ts  →  re-exported as  →  @openlearn/plugin-sdk/PluginContext
packages/core/di/interfaces.ts      →  re-exported as  →  @openlearn/plugin-sdk/services
packages/core/di/interfaces.ts      →  re-exported as  →  @openlearn/plugin-sdk/tokens
packages/core/esm-loader/manifest-schema.ts  →  re-exported as  →  @openlearn/plugin-sdk/manifest
```

It introduces zero new runtime concepts. It is a build-time packaging concern that wraps existing interfaces.

---

# Proposal 2: Contribution Registry (Declarative Extension Points)

## Q1: Why is this needed? What real problem does it solve?

Today, UI extensions are registered imperatively at runtime:

```javascript
// Frontend plugin code
frontendCtx.registerMenu({ id: 'ext-my-menu', label: '...', ... });
frontendCtx.registerPanel({ slot: 'teacher.panel', ... });
frontendCtx.registerToolbarButton({ slot: 'classroom.tool', ... });
```

This creates four concrete problems:

1. **The host cannot enumerate all contributions at install time.** An admin installs a plugin but cannot see what it will add to the UI until it runs. No preview, no review, no approval.
2. **Adding a new extension point requires kernel code changes.** If a future version needs an `admin.dashboard` slot, the host frontend must add support, the backend must add routing, and documentation must be updated. Plugins cannot define new extension points.
3. **No schema validation at install time.** A malformed panel registration only fails at runtime, not at install time.
4. **No composability.** Plugin A cannot extend Plugin B's extension point. The set of extension points is closed to the kernel.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The current `frontendCtx.registerMenu/registerPanel/registerToolbarButton` API **works for registration** but provides no **declaration, validation, or enumeration** capabilities. The problem is not that registration fails — it is that the platform has no model of what plugins *intend* to contribute.

The CommandBus could theoretically carry contribution metadata, but that conflates two orthogonal concerns: commands are runtime operations; contributions are static declarations.

## Q3: Classification

**Core (Platform Kernel).** The Contribution Registry is a fundamental extension point mechanism. It changes how the kernel discovers and loads plugin capabilities.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Declares contributions in manifest. Gets validation at install time, not runtime. Can contribute to extension points defined by other plugins. |
| **Platform maintainer** | Can enumerate all contributions across all plugins. Can validate contribution schemas before activation. Can build admin tools that show "this plugin adds 2 menu items and 1 panel." |
| **End user** | Can see what a plugin will do before enabling it. Admin can review and approve contributions. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: A new registry in the kernel. A new `"contributes"` section in manifest.json. Schema definitions for each extension point type.

**Complexity removed**: Eliminates ad-hoc `frontendCtx.register*` methods. Replaces N imperative APIs with one declarative mechanism. Makes the extension point surface explicit and discoverable.

**Verdict**: This is the single most impactful architectural investment for long-term platform scalability. The complexity is structural — it moves complexity from N plugin authors (who each must understand imperative APIs) to one platform team (who defines schemas once). **Worth it if the platform intends to support >50 plugins.**

If the platform will remain at <20 plugins for the foreseeable future, the current imperative approach is sufficient and this should be deferred.

## Q6: Industry precedent

| Platform | Approach | Analysis |
|---|---|---|
| **VS Code** | `"contributes"` in `package.json` — declarative JSON for commands, menus, views, settings, languages, themes, keybindings, etc. Each contribution type has a JSON Schema. The host validates at install time and uses declarations to build UI without activating the extension. | VS Code's model is the gold standard. However, VS Code has ~30 contribution types built over 10 years. OpenLearn should start with 3–5 (menu, panel, toolbar, action, settings) and grow incrementally. |
| **JetBrains** | `plugin.xml` — XML declarations for extension points. Plugins declare `<extensions>` and can also define `<extensionPoints>` for other plugins to extend. | JetBrains allows plugins to define *new* extension points. This is extremely powerful but also complex. OpenLearn should defer plugin-defined extension points to V4.0+. |
| **Chrome** | `manifest.json` — declares `"permissions"`, `"content_scripts"`, `"action"`, `"side_panel"`, etc. All validated at install time. | Chrome's model is simpler than VS Code's because the set of contribution types is smaller and more stable. This is the right complexity level for OpenLearn V3.0. |
| **Home Assistant** | YAML manifest — declares `iot_class`, `config_flow`, integration type. Validated by `hassfest`. | HA's model is declarative but domain-specific. OpenLearn can learn from HA's validation tooling (`hassfest` → `openlearn validate`). |

**Key difference**: VS Code and JetBrains are desktop applications where extension activation is cheap (same process). OpenLearn's plugins run in Worker sandboxes where activation is expensive (thread creation + RPC setup). This makes **declarative contributions even more valuable** for OpenLearn — the host can enumerate what a plugin contributes without activating it.

## Q7: When to introduce?

**V3.0.** Requires the SDK (V2.5) to be in place first so that contribution types have published schemas. Also requires the manifest schema to be stabilized.

Not V2.5 because the imperative API still works for the current plugin count, and designing contribution schemas well requires experience with real plugin patterns.

## Q8: Integration with existing architecture

The Contribution Registry **does not replace** the existing services; it **layers on top**:

```
manifest.json "contributes" section
        ↓ (parsed at install time by PluginHost)
ContributionRegistry (kernel-side, stores declarations)
        ↓ (on activation, converted to runtime calls)
existing frontendCtx.registerMenu / registerPanel / registerToolbarButton
        ↓ (no change to runtime behavior)
MFE Slots render contributions
```

- **CommandBus**: Not affected. Commands are runtime operations, not declarations.
- **EventBus**: The registry emits `contributions:changed` events when plugins are installed/removed.
- **PluginContext**: Gains a read-only `ctx.contributions` accessor for introspection.
- **Capability**: Each contribution type can declare required capabilities (e.g., contributing to `teacher.panel` requires `ui:panel`).
- **Manifest Schema**: Extended with a `"contributes"` section validated by Zod.

---

# Proposal 3: Structured Logger (`ctx.log`)

## Q1: Why is this needed? What real problem does it solve?

Today, plugins log by dispatching a command:

```typescript
await ctx.services.commandBus.execute({
  type: 'system.log',
  payload: { level: 'INFO', pluginId: ctx.pluginId, message: 'hello' }
} as any);
```

Three concrete problems:

1. **Semantic mismatch.** Logging is observation, not mutation. The CommandBus is designed for state-changing operations with interceptors, undo/redo, and approval workflows. None of these apply to log messages. Using CommandBus for logging pollutes the command stream and confuses the audit trail.
2. **Verbosity.** A simple log statement requires 5 lines of code with manual `pluginId` injection and `as any` casts. Compare to `ctx.log.info('hello')`.
3. **No level filtering.** The host cannot filter debug logs from production without inspecting command payloads.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The `system.log` command works mechanically. But it is the wrong abstraction. It is like using HTTP POST to record a console.log — technically possible, architecturally wrong.

`console.log` from within the Worker also works but provides no structure, no levels, no trace correlation, and no routing to the host's log aggregation system.

## Q3: Classification

**SDK (Developer Experience).** The logger is a convenience wrapper around existing infrastructure. The underlying transport can still use the IPC channel, but the developer-facing API should be a proper Logger interface.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | `ctx.log.info('message')` instead of 5 lines of boilerplate. Automatic `pluginId` and `traceId` injection. |
| **Platform maintainer** | Can filter by level. Can route plugin logs to separate sinks. Audit trail is clean (commands are mutations, logs are observations). |
| **End user** | Indirect: better logging → faster debugging → more reliable plugins. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: One new interface (`ILoggerService`) and one new property on `PluginContext` (`ctx.log`).

**Complexity removed**: Eliminates the `system.log` command from the CommandBus stream. Eliminates `as any` casts in every plugin that logs.

**Verdict**: Trivially worth it. This is a ~50-line change with immediate DX improvement.

## Q6: Industry precedent

Every major platform provides a first-class logger:
- **VS Code**: `vscode.window.createOutputChannel()` — channel-based logging with level control.
- **JetBrains**: `Logger.getInstance(MyPlugin::class.java)` — class-based logger with IDE log viewer.
- **Home Assistant**: `_LOGGER = logging.getLogger(__name__)` — Python standard library logger.
- **Chrome**: No dedicated API; uses `console.*`. This is widely considered a weakness of the Chrome extension platform.

OpenLearn should follow the JetBrains/HA pattern: a simple, level-aware logger injected into the plugin context. Unlike VS Code's channel model, OpenLearn does not need per-channel logs because plugins are already isolated by Worker.

## Q7: When to introduce?

**V2.5.** Zero architectural risk. Tiny implementation surface. Immediate DX improvement. No dependencies on other proposals.

## Q8: Integration with existing architecture

```typescript
// Implementation: ctx.log is constructed by ContextBuilder
// It internally calls the existing IPC mechanism to send logs to the host
// The host routes logs to its structured logging system (pino, if Phase 21 completes)

interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// In PluginContext:
log: IPluginLogger;  // auto-injected, auto-scoped to pluginId
```

- **CommandBus**: `system.log` command is **deprecated** in V2.5, **removed** in V3.0. Logging no longer flows through the command pipeline.
- **Worker RPC**: Logs still cross the Worker boundary via MessagePort, but as a dedicated `LOG` message type, not as `RPC_CALL`.
- **ResourceTracker**: No interaction. Logging is stateless.
- **PluginContext**: Gains `log` property. No other changes.

---

# Proposal 4: `engines.openlearn` Manifest Field

## Q1: Why is this needed? What real problem does it solve?

Today, when the platform upgrades from v2.4 to v3.0 and changes an API, **there is no mechanism to prevent a plugin built for v2.4 from being installed on v3.0** (or vice versa). The plugin will load, attempt to call a removed API, and crash at runtime.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The `requires` field in manifest specifies DI tokens, not platform version. A plugin can declare `"requires": ["@openlearn/core:ICommandBusService"]` but cannot say "I need ICommandBusService as it existed in v2.4, not the v3.0 version with breaking changes."

The `version` field in manifest is the *plugin's* version, not the *platform's* version.

## Q3: Classification

**Core (Platform Kernel).** This is a manifest schema change with host-side validation.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Declares minimum platform version. Gets clear error message at install time if the host is incompatible, instead of a runtime crash. |
| **Platform maintainer** | Can evolve APIs with confidence that old plugins won't silently break. Can plan deprecation cycles based on the `engines` field distribution across the ecosystem. |
| **End user** | Sees "This plugin requires OpenLearn v3.0 or later" instead of a mysterious crash. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: One new optional field in the Zod manifest schema. One SemVer comparison check in the install pipeline (~5 lines).

**Complexity removed**: Eliminates an entire class of "plugin incompatible with host version" runtime errors.

**Verdict**: Trivially worth it. The lowest-cost, highest-ROI change in this entire report.

## Q6: Industry precedent

| Platform | Mechanism |
|---|---|
| **VS Code** | `"engines": { "vscode": "^1.80.0" }` in `package.json`. Marketplace and runtime both enforce. |
| **JetBrains** | `<idea-version since-build="231" until-build="233.*"/>` in `plugin.xml`. Marketplace rejects incompatible uploads. |
| **Chrome** | `"minimum_chrome_version": "116"` in `manifest.json`. Chrome Web Store validates. |
| **Node.js** | `"engines": { "node": ">=18" }` in `package.json`. npm warns on mismatch. |

All major platforms have this. It is table stakes. OpenLearn's implementation should follow the VS Code `"engines"` pattern because it uses SemVer ranges, which are more expressive than Chrome's simple minimum version.

## Q7: When to introduce?

**V2.5.** One Zod field. One version check. No dependencies.

## Q8: Integration with existing architecture

```json
// manifest.json
{
  "id": "ext-my-plugin",
  "engines": { "openlearn": "^2.4.0" }
}
```

- **Manifest Schema**: Extended with `engines` object. Validated by Zod.
- **PluginHost.installPlugin()**: Adds a SemVer satisfies check before proceeding.
- **No other systems affected.** This is a gate in the install pipeline, nothing more.

---

# Proposal 5: Command Namespace Enforcement

## Q1: Why is this needed? What real problem does it solve?

Today, any plugin can register any command type string:

```typescript
await commandBus.registerHandler('scores.update', handler);
```

If two plugins both register `scores.update`, the second registration silently overwrites the first. There is no namespace isolation, no conflict detection, and no way to trace which plugin owns which command.

At 10 plugins this is manageable. At 100 plugins, command collisions become inevitable.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The documentation *recommends* naming conventions but the runtime does not enforce them. Convention without enforcement is not architecture — it is hope.

## Q3: Classification

**Core (Platform Kernel).** This is a runtime enforcement change in the CommandBus.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Commands are guaranteed unique. No silent overwrites. Clear ownership. |
| **Platform maintainer** | Can trace every command to its owning plugin. Can build admin tools showing command ownership. |
| **End user** | Indirect: eliminates a class of subtle bugs where Plugin A's behavior breaks when Plugin B is installed. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: The ContextBuilder automatically prefixes command types with the plugin's `manifest.id` when a plugin calls `registerHandler`. A mapping layer translates between the plugin's local name and the prefixed global name.

**Complexity concern**: Existing built-in commands (e.g., `whiteboard.draw`, `vfs.write_file`) use unprefixed names. These must remain unprefixed since they are kernel commands, not plugin commands. The system needs to distinguish "kernel command" from "plugin command."

**Verdict**: Worth it, but requires careful design of the kernel-vs-plugin command namespace boundary. The rule should be: **plugins can only register handlers for commands prefixed with their own ID, but can execute any command they have capability for.**

## Q6: Industry precedent

| Platform | Approach | Analysis |
|---|---|---|
| **VS Code** | Commands are conventionally prefixed (`extension.myCommand`) but not enforced by the runtime. The marketplace review process catches conflicts. | VS Code chose convention over enforcement because it predates automated tooling. OpenLearn has the advantage of enforcing from day one. |
| **Chrome** | Content scripts and background scripts share a message namespace. Collisions are common. | Chrome's lack of namespacing is a known weakness. Do not follow. |
| **Kubernetes** | API groups (`apps/v1`, `batch/v1`) provide strict namespacing. CRD groups are namespaced to the publisher. | K8s enforces namespacing at the schema level. OpenLearn should enforce at the runtime level. |

**Recommendation**: Enforce at runtime (unlike VS Code) but with the K8s principle of publisher-namespaced types.

## Q7: When to introduce?

**V2.5.** But with a migration period: in V2.5, emit a deprecation warning for unprefixed plugin command registrations. In V3.0, enforce prefixing.

## Q8: Integration with existing architecture

- **CommandBus**: `registerHandler(type, handler)` internally prepends `{pluginId}.` to the type when called from a plugin context. When a plugin calls `execute({ type: 'scores.update' })`, the bus checks if `{callerPluginId}.scores.update` exists first, then falls back to the global namespace (for kernel commands like `whiteboard.draw`).
- **ActionRegistry**: The `commandType` in ActionDescriptor is also auto-prefixed, maintaining the 1:1 mapping between Actions and Commands.
- **EventBus**: Events are **not** namespaced by this proposal. Events are broadcast notifications where global naming is intentional.
- **PluginContext**: No changes.
- **Backward compatibility**: Existing plugins with unprefixed commands continue to work during the migration period (V2.5). The prefix is transparently applied.

---

# Proposal 6: Plugin Dependency Resolver

## Q1: Why is this needed? What real problem does it solve?

Today, a plugin that consumes a service provided by another plugin has no way to express this dependency:

```json
{
  "id": "ext-grade-reporter",
  "requires": ["@openlearn/core:ISemesterGradeService"]
}
```

The `requires` field references *kernel* DI tokens, not *other plugins*. If `ext-grade-reporter` depends on `ext-grade-calculator`, there is:
- No way to declare it.
- No way to ensure `ext-grade-calculator` activates before `ext-grade-reporter`.
- No way to prevent `ext-grade-reporter` from being installed without `ext-grade-calculator`.
- No cycle detection if both depend on each other.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The `requires` array exists but is limited to DI tokens in the `@openlearn/core` namespace. Plugins cannot export their own DI tokens for other plugins to consume (they can register services in the container, but the manifest doesn't express cross-plugin dependencies).

The EventBus provides decoupled communication but cannot express ordering guarantees.

## Q3: Classification

**Core (Platform Kernel).** Dependency resolution affects plugin activation order, which is a kernel-level concern.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Can build plugins that compose. Can declare "I need ext-question-bank >= 2.0" and get a clear error if it's missing. |
| **Platform maintainer** | Can enforce activation order. Can detect cycles. Can show dependency graphs in admin UI. |
| **End user** | Gets clear error messages: "Plugin X requires Plugin Y to be installed." Instead of silent failures. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: Topological sort in plugin activation pipeline. SemVer constraint resolution. Cycle detection.

**Complexity concern**: Dependency resolution is a well-understood problem (npm, Maven, Gradle all solve it) but it is non-trivial to implement correctly, especially with optional dependencies and version ranges.

**Verdict**: Worth it **only if the platform expects a significant number of plugins that build on each other**. For a platform with 10 standalone plugins, this is over-engineering. For a platform aiming to support an ecosystem where plugins compose, it is essential.

**Recommendation**: Implement a minimal version in V3.0 — only support exact plugin ID dependencies without version ranges. Add SemVer constraint resolution in V4.0 if the ecosystem grows.

## Q6: Industry precedent

| Platform | Approach | Analysis |
|---|---|---|
| **VS Code** | `"extensionDependencies": ["publisher.other-extension"]` in `package.json`. VS Code ensures dependent extensions activate first. No version constraints. | VS Code's approach is deliberately simple: ID-only, no version ranges. This simplicity has served them well for a decade. OpenLearn should start here. |
| **JetBrains** | `<depends>com.intellij.modules.platform</depends>` in `plugin.xml`. Supports optional dependencies with `<depends optional="true" config-file="...">`. | JetBrains' optional dependency model is powerful but complex. Defer to V4.0. |
| **npm** | Full SemVer constraint resolution with `peerDependencies`, `optionalDependencies`, hoisting, deduplication. | npm's complexity is a cautionary tale. OpenLearn should not replicate it. |

**Recommendation**: Start with VS Code's model (ID-only, no version ranges) in V3.0. This covers 90% of use cases with 10% of the complexity.

## Q7: When to introduce?

**V3.0.** Requires the SDK and manifest schema stabilization from V2.5. Also requires real-world experience with plugin composition patterns before designing the resolution algorithm.

## Q8: Integration with existing architecture

```json
// manifest.json
{
  "id": "ext-grade-reporter",
  "pluginDependencies": ["ext-grade-calculator"]
}
```

- **PluginHost**: The `activatePlugin` method performs a topological sort across all installed plugins' `pluginDependencies` before activating. If a dependency is missing or in `error` state, the dependent plugin transitions to `error` with a clear message.
- **Manifest Schema**: Extended with `pluginDependencies: z.array(z.string()).optional()`.
- **Lifecycle**: The state machine gains a new edge: `Installed → Error` when a required dependency is missing.
- **ResourceTracker**: When a dependency is deactivated, the system optionally cascades deactivation to dependents (configurable).
- **CommandBus, EventBus, PluginContext**: No changes.

---

# Proposal 7: Configuration Service

## Q1: Why is this needed? What real problem does it solve?

Today, plugin settings are read via an ad-hoc command:

```typescript
const settings = await ctx.services.commandBus.execute({
  type: 'system.get_plugin_settings',
  payload: { pluginId: ctx.pluginId }
} as any) as { defaultLimit: number };
```

Four concrete problems:
1. **No schema.** The platform doesn't know what settings a plugin accepts. It can't validate values, show defaults, or generate a UI.
2. **No scoping.** A "max questions" setting that should differ per organization or per lesson has no scoping mechanism.
3. **No admin UI.** Administrators must manually edit database records to configure plugins.
4. **No type safety.** Settings are `any`-typed. A developer misspelling a setting name gets no compile-time error.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The `system.get_plugin_settings` command and `IStorageService` KV store can *store* settings. But they provide no **schema, validation, scoping, or UI generation**. The storage layer is sufficient; the metadata and governance layer is missing.

## Q3: Classification

**Core (Platform Kernel) + SDK.** The schema declaration is manifest-level (Core). The `ctx.config` accessor is SDK-level.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Declares settings in manifest. Gets typed, validated settings via `ctx.config.get('maxQuestions')`. No boilerplate. |
| **Platform maintainer** | Can auto-generate a settings UI for every plugin. Can validate settings before they reach plugin code. |
| **End user (admin)** | Gets a consistent settings interface across all plugins. No more editing database records. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: A new manifest section (`"configuration"`), a JSON Schema validator, a settings storage backend, and an auto-generated admin UI component.

**Complexity concern**: This is a medium-sized feature. The auto-generated UI is the most complex part and can be deferred to V3.1 (just provide the schema and API in V3.0; build the UI later).

**Verdict**: Worth it **if the platform has >10 plugins with configurable behavior**. Currently, configuration needs are minimal. But once plugins like "exam builder" or "attendance tracker" arrive, every one will need settings. Build the infrastructure before the demand becomes urgent.

## Q6: Industry precedent

| Platform | Approach | Analysis |
|---|---|---|
| **VS Code** | `"contributes.configuration"` in `package.json` with JSON Schema. VS Code auto-generates a Settings UI from the schema. | VS Code's auto-generated Settings UI is one of its best features. OpenLearn should aspire to this but can start with a simpler implementation. |
| **Home Assistant** | `config_flow` — a Python class that defines a multi-step configuration wizard. Fully type-safe with `vol.Schema`. | HA's config flow is more powerful (multi-step wizards) but also more complex. OpenLearn should start with flat JSON Schema, not wizards. |
| **Obsidian** | `PluginSettingTab` — imperative API where developers build settings UI manually. | Obsidian's approach is the opposite of declarative. It works but doesn't scale. Do not follow. |

**Recommendation**: Follow VS Code's JSON Schema approach. Declare in manifest, validate at runtime, auto-generate admin UI.

## Q7: When to introduce?

**V3.0.** Schema declaration in manifest and `ctx.config.get()` API. Auto-generated admin UI can follow in V3.1.

Not V2.5 because the current number of plugins doesn't justify the investment, and the manifest schema needs to stabilize first.

## Q8: Integration with existing architecture

```json
// manifest.json
{
  "configuration": {
    "properties": {
      "maxQuestions": { "type": "number", "default": 50, "description": "单次考试最大题目数" },
      "allowRetake": { "type": "boolean", "default": false }
    }
  }
}
```

- **PluginContext**: Gains `ctx.config: IConfigService` with `get<T>(key): T`, `getAll(): Record<string, unknown>`, `onChange(key, callback)`.
- **IStorageService**: Config values are *stored* in the existing `plugin_storage` table with a `config:` prefix. No new storage backend needed.
- **CommandBus**: `system.get_plugin_settings` command is **deprecated**. `ctx.config.get()` replaces it.
- **Capability**: No capability required to read own config. Writing config requires `config:write` (admin-only).
- **Manifest Schema**: Extended with `configuration` section. Validated by Zod against JSON Schema meta-schema.
- **Contribution Registry** (if implemented): Configuration becomes a contribution type — the settings UI is "contributed" by the plugin.

---

# Proposal 8: Plugin-to-Plugin Typed RPC

## Q1: Why is this needed? What real problem does it solve?

Today, Plugin A can call Plugin B's logic only through indirect mechanisms:
1. **CommandBus**: Plugin A dispatches a command that Plugin B has registered a handler for. But there is no guarantee that Plugin B is installed, no type safety on the payload, and no namespace isolation preventing collision.
2. **EventBus**: Fire-and-forget. No request-response pattern.
3. **DI Resolution**: Plugin A can `ctx.resolve(ISomethingToken)` if the service is registered in the container. But plugins cannot export their own DI tokens — only the kernel defines tokens.

The real problem: **there is no contract-based, type-safe mechanism for plugin-to-plugin communication.**

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

The CommandBus *can* carry cross-plugin calls, but it conflates "plugin A calling plugin B's service" with "user triggering a UI action." These are architecturally different concerns.

With command namespace enforcement (Proposal 5), Plugin A calling `ext-question-bank.getQuestion` is possible but requires Plugin A to know Plugin B's internal command types. There is no published contract.

## Q3: Classification

**Core (Platform Kernel).** Cross-plugin communication is a kernel-level concern because it involves Worker-to-Worker or Worker-to-Host routing.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | Can build composable plugins with typed contracts. Plugin A declares "I provide IQuestionBank" and Plugin B declares "I consume IQuestionBank from ext-question-bank." |
| **Platform maintainer** | Can trace cross-plugin dependencies. Can enforce capability checks on cross-plugin calls. |
| **End user** | More capable plugins built by composing smaller, focused plugins. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: A service export/import declaration in manifest. A routing mechanism in the PluginHost. Type contracts published via the SDK.

**Complexity concern**: This is significant. Cross-Worker RPC adds latency, failure modes, and debugging complexity. The question is whether the use cases justify it.

**Current plugin count**: ~10. **Cross-plugin communication need**: low (only one example: `ISemesterGradeService`).

**Verdict**: **Defer to V3.0 and implement minimally.** Use the existing DI container as the routing mechanism — allow plugins to register tokens that other plugins can resolve. Do not build a separate RPC channel. The DI container already handles this; it just needs to be opened to plugin-defined tokens.

## Q6: Industry precedent

| Platform | Approach | Analysis |
|---|---|---|
| **VS Code** | Extensions can export APIs via `vscode.extensions.getExtension('publisher.name')?.exports`. Typed via `@types/vscode` augmentation. | VS Code's model is simple: "activate the other extension and grab its exports." This works because VS Code extensions run in the same process. OpenLearn's Worker isolation makes this harder. |
| **JetBrains** | Extension points allow any plugin to contribute and any plugin to consume. The platform routes contributions. | JetBrains' model is powerful but requires the Contribution Registry (Proposal 2) as a foundation. |
| **Eclipse/OSGi** | Full service registry with dynamic wiring. Plugins export/import services by interface. | OSGi is the most sophisticated model but also the most complex. Over-engineering for OpenLearn. |

**Recommendation**: Extend the existing DI container to allow plugins to register and resolve plugin-defined tokens. This is the minimal viable cross-plugin communication mechanism that reuses existing infrastructure.

## Q7: When to introduce?

**V3.0.** Depends on Plugin Dependency Resolver (to ensure correct activation order) and SDK (to publish typed contracts).

## Q8: Integration with existing architecture

```json
// ext-question-bank/manifest.json
{
  "provides": ["ext-question-bank:IQuestionBankService"]
}
```

```json
// ext-exam-builder/manifest.json
{
  "pluginDependencies": ["ext-question-bank"],
  "requires": ["ext-question-bank:IQuestionBankService"]
}
```

- **DI Container (ServiceRegistry)**: Accepts token registrations from plugins, not just the kernel. The `provides` array in manifest maps to `serviceRegistry.register(token, implementation)` during activation.
- **PluginContext.resolve()**: Already supports generic token resolution. No API change needed.
- **PluginHost**: Validates that `provides` tokens are registered during activation. Validates that `requires` tokens are available before activation.
- **CommandBus, EventBus**: Not affected. This is a DI-level mechanism.
- **Worker RPC**: The existing `RPC_CALL` mechanism already routes `resolve()` calls to the host. Plugin-defined tokens use the same channel.

---

# Proposal 9: Plugin Test Kit

## Q1: Why is this needed? What real problem does it solve?

Today, testing a plugin requires booting a full `Kernel`:

```typescript
const kernel = new Kernel();
await kernel.ready;
const manifest = await kernel.pluginHost.installPlugin(sourceCode);
```

This is a heavy integration test. There is no way to unit test a plugin's `activate` function with mocked services. Developers must either test nothing or test everything.

## Q2: Can existing mechanisms satisfy this? Why are they insufficient?

Developers can manually create mock objects, but there is no standard set of mocks, no test helpers, and no documentation on how to test plugins. Each plugin author reinvents the wheel.

## Q3: Classification

**SDK (Developer Experience).** A test kit is a development-time tool, not a runtime system.

## Q4: Value to each stakeholder

| Stakeholder | Value |
|---|---|
| **Plugin developer** | `const ctx = createMockContext()` → write unit tests in 5 lines instead of 50. |
| **Platform maintainer** | Plugins are better tested → fewer bug reports → less support burden. |
| **End user** | More reliable plugins. |

## Q5: Does it increase platform complexity? Is the complexity worth it?

**Complexity added**: One new npm package (`@openlearn/plugin-test-kit`). ~200 lines of mock implementations.

**Complexity removed**: None directly. But prevents the organic growth of N incompatible mock implementations across N plugins.

**Verdict**: Trivially worth it. Low cost, high value.

## Q6: Industry precedent

| Platform | Approach |
|---|---|
| **VS Code** | `@vscode/test-electron` and `@vscode/test-web` — official test runners that launch a VS Code instance. For unit tests, developers mock `vscode` API manually. |
| **JetBrains** | `intellij-test-framework` — launches a headless IDE for integration tests. `LightPlatformTestCase` for lightweight tests. |

VS Code's unit testing story is actually weak — there is no official mock library. JetBrains' is better but coupled to the IDE runtime. OpenLearn has an opportunity to provide a first-class mock-based test kit from day one.

## Q7: When to introduce?

**V2.5.** No dependencies. Can be built in parallel with the SDK package.

## Q8: Integration with existing architecture

```typescript
import { createMockContext } from '@openlearn/plugin-test-kit';

const ctx = createMockContext({
  pluginId: 'ext-test',
  capabilities: ['whiteboard:write']
});

// ctx.services.commandBus is a mock with jest/vitest spy capabilities
// ctx.db is an in-memory SQLite mock
// ctx.log is a capturing logger

await myPlugin.activate(ctx);

expect(ctx.services.commandBus.registerHandler).toHaveBeenCalledWith('my.command', expect.any(Object));
```

The test kit creates mock implementations of all 7 services in `PluginContext.services`, plus `ctx.db`, `ctx.log`, and `ctx.resolve`. It does not depend on any runtime kernel code.

---

# Proposals Evaluated and Rejected (or Deferred Indefinitely)

## Rejected: MCP Bridge (Model Context Protocol)

**Why rejected**: MCP is an evolving standard for LLM tool interoperability. OpenLearn's ActionRegistry already provides the same capability internally (AI agents can discover and call plugin-registered tools). Building an MCP bridge would add external protocol dependencies, compliance burden, and attack surface for a feature that serves external AI agents — not the platform's primary users (teachers and students).

**When to reconsider**: If OpenLearn needs to integrate with external AI orchestration platforms (e.g., an institution's custom AI pipeline), MCP becomes relevant. This is an integration concern, not a platform architecture concern. Build it when a concrete customer requires it, not as speculative infrastructure.

## Rejected: Plugin Profiler

**Why rejected**: Per-plugin CPU/memory profiling is a specialized operations tool that serves platform operators, not plugin developers or end users. Node.js already provides `--inspect`, `clinic.js`, and `perf_hooks` for profiling Worker threads. Building a custom profiler duplicates existing tooling.

**Alternative**: Document how to use `node --inspect` with Worker threads. Provide a `ctx.metrics.increment()` API for application-level metrics (this is part of the Observability phase, not the plugin platform).

## Rejected: Plugin Analytics Service

**Why rejected**: Usage analytics (activation counts, error rates, feature usage) are a product concern, not a platform architecture concern. They can be built as a plugin themselves (`ext-plugin-analytics`) using the existing EventBus to collect activation/deactivation events and the existing Database API to store metrics.

**Key insight**: If your analytics system can't be built as a plugin on your own platform, your platform has a design problem. If it can, it should be.

---

# Architectural Coherence Assessment

## Unified API Surface Vision

After all accepted proposals, the plugin-facing API surface would be:

```typescript
interface PluginContext {
  // Identity
  pluginId: string;
  manifest: Manifest;

  // Core Services (existing, stable)
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
  };

  // Data (existing, stable)
  db: PluginDatabaseAPI;

  // DI (existing, extended for cross-plugin)
  resolve<T>(token: Token<T>): Promise<T>;

  // V2.5 additions
  log: IPluginLogger;          // replaces system.log command

  // V3.0 additions
  config: IConfigService;      // replaces system.get_plugin_settings command
  contributions: ContributionAccessor;  // read-only view of own contributions
}
```

**Design coherence checks:**
- ✅ All new APIs are accessed via `ctx.*` — consistent with existing patterns.
- ✅ No new global services or singletons introduced.
- ✅ `ctx.log` and `ctx.config` replace existing CommandBus-based workarounds — reducing the API surface, not expanding it.
- ✅ Cross-plugin RPC uses the existing `ctx.resolve()` mechanism — no new communication channel.
- ✅ Contributions are declared in manifest and accessed via `ctx.contributions` — declarative, not imperative.

## Implementation Dependency Graph

```
V2.5 (no dependencies between items):
  ├── @openlearn/plugin-sdk          (independent)
  ├── @openlearn/plugin-test-kit     (independent)
  ├── ctx.log                        (independent)
  ├── engines.openlearn              (independent)
  └── Command namespace warnings     (independent)

V3.0 (depends on V2.5 SDK):
  ├── Contribution Registry          (depends on: SDK, manifest schema)
  ├── Plugin Dependency Resolver     (depends on: SDK, manifest schema)
  ├── Configuration Service          (depends on: SDK, manifest schema)
  ├── Plugin-to-Plugin DI tokens     (depends on: Dependency Resolver)
  └── Command namespace enforcement  (depends on: namespace warnings from V2.5)
```

All V2.5 items are independent and can be implemented in parallel.
All V3.0 items depend on the SDK from V2.5 but most are independent of each other, except Plugin-to-Plugin DI which requires the Dependency Resolver.

---

## Summary Decision Matrix

| Proposal | Accepted? | Version | Category | Complexity | ROI |
|---|---|---|---|---|---|
| Plugin SDK | ✅ Yes | V2.5 | SDK | Low | Very High |
| Structured Logger | ✅ Yes | V2.5 | SDK | Trivial | High |
| `engines.openlearn` | ✅ Yes | V2.5 | Core | Trivial | High |
| Plugin Test Kit | ✅ Yes | V2.5 | SDK | Low | High |
| Command Namespace | ✅ Yes | V2.5 warn, V3.0 enforce | Core | Medium | High |
| Contribution Registry | ✅ Yes | V3.0 | Core | High | Very High (long-term) |
| Plugin Dependencies | ✅ Yes (minimal) | V3.0 | Core | Medium | Medium |
| Configuration Service | ✅ Yes | V3.0 | Core + SDK | Medium | High |
| Plugin-to-Plugin RPC | ✅ Yes (via DI) | V3.0 | Core | Medium | Medium |
| MCP Bridge | ❌ Deferred | — | Integration | High | Speculative |
| Plugin Profiler | ❌ Rejected | — | Operations | High | Low |
| Plugin Analytics | ❌ Rejected | — | Product | Medium | Build as plugin |
