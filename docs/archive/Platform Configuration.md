# OpenLearn Platform Configuration System (平台配置系统)

> **Scope:** PI-011. The Platform Configuration System is the **single, unified
> abstraction for platform-only configuration** (kernel, infrastructure, and
> reserved application bootstrap settings). It is deliberately **separate from
> business configuration** (courseware settings, plugin config, classroom
> options). It is NOT a general-purpose settings store — it only handles the
> configuration the platform kernel itself needs to boot and run.

Module location: `packages/core/configuration/`

---

## 1. Design Goals

- One registry for all platform configuration, with **priority-based merging**
  of multiple providers (highest priority wins).
- Pluggable **sources**: in-memory, environment variables, JSON files, YAML
  files (optional, requires the `yaml` package).
- Declarative **validation**: required keys, types, numeric ranges, enums, and
  descriptor-driven defaults.
- An **immutable snapshot** read view after each load.
- First-class **integration seams** to the rest of the kernel (ServiceRegistry,
  DI Container, EventBus, PlatformBuilder, BootstrapPipeline, CompositionRoot,
  CapabilityRuntime) — but via structural seams only; no business module is
  modified.
- **Hot-reload** is a reserved seam (the hook point exists, but the live-reload
  mechanism is intentionally NOT implemented in this increment).

---

## 2. Public API

### `PlatformConfiguration` (facade)

Top-level orchestrator. Construct once during bootstrap and share it across the
kernel.

```typescript
const config = new PlatformConfiguration({
  logger?,                 // IPlatformLogger (defaults to DefaultPlatformLogger)
  serviceRegistry?,        // integration seam (register self as a service)
  container?,              // integration seam (register self as an instance)
  eventBus?,               // integration seam (publish ConfigurationLoaded)
  builder?,                // integration seam (onConfigurationLoaded hook)
  bootstrapPipeline?,      // integration seam
  compositionRoot?,        // integration seam
  capabilityRuntime?,      // integration seam
});

await config.load();
```

| Method | Returns | Purpose |
|---|---|---|
| `registerProvider(init)` | `ConfigurationProvider` | Register a full provider (source + descriptors). |
| `registerMemory(values, opts?)` | `ConfigurationProvider` | Convenience in-memory provider. |
| `registerEnvironment(opts)` | `ConfigurationProvider` | Convenience environment-variable provider. |
| `registerJsonFile(path, opts?)` | `ConfigurationProvider` | Convenience JSON file provider. |
| `registerYamlFile(path, opts?)` | `ConfigurationProvider` | Convenience YAML file provider (optional dep). |
| `removeProvider(id)` | `boolean` | Unregister a provider by id. |
| `load(context?)` | `Promise<ConfigurationLoadResult>` | Initial load + merge + validate + snapshot + integrate. |
| `reload(context?)` | `Promise<ConfigurationLoadResult>` | Re-run load using current providers. |
| `get<T>(path, scope?)` | `T` | Strict read — **throws** `ConfigurationError` if absent. |
| `tryGet<T>(path, fallback?, scope?)` | `T \| undefined` | Lenient read — returns `fallback` if absent. |
| `exists(path, scope?)` | `boolean` | Whether a path is present. |
| `list()` | `ReadonlyArray<string>` | Top-level section keys. |
| `snapshot()` | `ConfigurationSnapshot` | Immutable frozen read view. |
| `getValidationReport()` | `ConfigurationValidationReport` | Last validation result. |

`attach*` methods (`attachBuilder`, `attachBootstrapPipeline`,
`attachCompositionRoot`, `attachCapabilityRuntime`, `attachEventBus`) re-bind
integration seams after construction. This supports incremental wiring by the
`PlatformBuilder` without forcing a fixed constructor signature.

---

## 3. Sources

| Kind | Class | Notes |
|---|---|---|
| `memory` | `MemorySource` | Values held in memory; deep-cloned on read. |
| `environment` | `EnvironmentSource` | Reads `process.env` (or injected `env`). Optional `prefix` + `map`. Values are **coerced** (`"true"`→`true`, `"9001"`→`9001`). Dot/underscore keys map to nested paths (`APP_KERNEL_PORT` → `kernel.port`). |
| `json` | `JsonFileSource` | Reads & parses a JSON file. |
| `yaml` | `YamlFileSource` | Reads & parses a YAML file. Requires the `yaml` package (loaded dynamically; fails gracefully with a clear error if absent). |

`buildSource(init)` constructs the right source from the declarative
`ConfigurationSourceInit`.

---

## 4. Scopes

Configuration is partitioned by scope. A `get(path, scope)` that specifies a
scope returns `undefined` when the matching descriptor belongs to a different
scope (it does **not** throw for a scope mismatch — only a truly absent path
throws).

| Scope | Meaning |
|---|---|
| `Platform` | Top-level platform settings. |
| `Kernel` | Kernel / bootstrap internals. |
| `Infrastructure` | Infrastructure wiring (ports, hosts, etc.). |
| `Application` | **Reserved** for application bootstrap (not used by the platform kernel itself). |

---

## 5. Validation

`ConfigurationValidator.validate(config, descriptors)` produces a
`ConfigurationValidationReport` with `isValid`, `errors[]`, and `warnings[]`.
Each `ConfigurationValidationError` carries a `code`:

| Code | Trigger |
|---|---|
| `REQUIRED` | A descriptor marked `required` is missing. |
| `TYPE` | Runtime value does not match the declared `type`. |
| `RANGE_MIN` / `RANGE_MAX` | Numeric value outside `[min, max]`. |
| `ENUM` | Value not in the allowed `enum` set. |

Descriptor `default` values are applied **before** validation, so a key with a
default is never reported as `REQUIRED`.

---

## 6. Loading Lifecycle

1. Providers are sorted **ascending** by priority; lower-priority providers are
   merged first so higher-priority providers override them.
2. Nested objects are deep-merged; scalars and arrays replace.
3. Descriptor `default` values fill any still-missing keys.
4. The merged config is validated.
5. A **frozen** `ConfigurationSnapshot` is produced (immutable read view).
6. Integration seams fire: register self in ServiceRegistry + DI Container
   (`kernel.configuration`), publish `ConfigurationLoaded`, invoke
   `builder.onConfigurationLoaded`, and register a module in `CompositionRoot`.

---

## 7. Integration Seams

The system integrates with the kernel through plain structural interfaces
(defined in `types.ts` as `*IntegrationSource`). None of those modules are
modified; they are passed in (or attached) by the `PlatformBuilder` /
`CompositionRoot`.

| Seam | Interface | Effect |
|---|---|---|
| ServiceRegistry | `ServiceRegistryIntegrationSource` | `register({ id: 'kernel.configuration', ... })`. |
| DI Container | `ContainerIntegrationSource` | `registerInstance('kernel.configuration', this)`. |
| EventBus | `EventBusIntegrationSource` | `publishConfigurationLoaded(config)`. |
| PlatformBuilder | `BuilderIntegrationSource` | `onConfigurationLoaded(this)`. |
| BootstrapPipeline | `BootstrapPipelineIntegrationSource` | Stage notification hook (reserved). |
| CompositionRoot | `CompositionRootIntegrationSource` | `registerModule('configuration', ...)`. |
| CapabilityRuntime | `CapabilityRuntimeIntegrationSource` | Reserved hook for capability-backed config. |

---

See also:

- [`Configuration Specification.md`](Configuration Specification.md) — full type & descriptor reference.
- [`Developer Guide.md`](Developer Guide.md) — usage recipes.
- [`Architecture Notes.md`](Architecture Notes.md) — design rationale & seams.
- [`PI-011 Implementation Report.md`](PI-011 Implementation Report.md) — what was built & verified.
