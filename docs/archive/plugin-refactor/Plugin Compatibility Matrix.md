# Plugin Compatibility Matrix (Sprint P7-A2)

> Documents the forward/backward compatibility guarantees that make the refactor safe. Backed by `Plugin Compatibility Report.md` (audit) and the SDK contract in `packages/plugin-sdk`. **Design-only.**

---

## 1. Subsystem Compatibility vs Platform Kernel v1.0

| Subsystem | Interface | Forward Compat | Backward Compat | Notes |
|-----------|-----------|----------------|-----------------|-------|
| Plugin Host | `IPluginHostAdapter` | ✅ 100% | ✅ 100% | Zero intrusion per audit. |
| Plugin SDK | `@openlearn/plugin-sdk` | ✅ 100% | ✅ 100% | Type + Token contract unchanged. |
| Lifecycle Manager | state machine | ✅ 100% | ✅ 100% | Callbacks unchanged. |
| Manifest Parser | `Manifest` schema | ✅ 100% | ✅ 100% | Validation format unchanged. |
| Built-in Plugins (Quiz, Vote, Assignment Evaluator, …) | manifest + context | ✅ 100% | ✅ 100% | Load & run unmodified. |
| Contribution Registry | slot IDs | ✅ 100% | ✅ 100% | Slot IDs stable. |
| Capability Registry | `cap_plugin_*` | ✅ 100% | ✅ 100% | Additive governance only. |
| Permission Manager | Infrastructure perms | ✅ Additive | ✅ Additive | New perms default Allow. |

> Audit verdict: *"对插件系统零破坏，100% 保持向前与向后兼容."*

---

## 2. SDK Public API Compatibility

| API surface | Status after refactor | Impact |
|-------------|----------------------|--------|
| `PluginContext` 7 services | Unchanged | None |
| `Manifest` interface fields | Additive only (`provides`, `configuration`) | Old manifests valid |
| DI Tokens (`ICommandBusServiceToken`, …) | Unchanged + new surfaced tokens | None (additive) |
| `FrontendPluginContext.registerExtensionPoint` | Unchanged | None |
| `ctx.resolve` / `ctx.provide` | Unchanged | None |
| `actionRegistry.register` | Unchanged + typed AI/Prompt/Resource contributions | Additive |
| `IActivityRegistryToken` (P7-01) | Already exported; documented as seam | None |

---

## 3. Manifest Schema Versioning

| Field | Introduced | Required? | Backward behavior |
|-------|-----------|-----------|-------------------|
| `id`, `name`, `version` | v1.0 | Yes | Required |
| `main` | v1.0 | No (default `index.js`) | Default applied |
| `requires` / `optional` | v1.0 | No | Ignored if absent |
| `capabilitiesProposed` | v1.0 | No | Empty → minimal grants |
| `classroomTools` | v1.0 | No | Absent → no tools |
| `provides` | V3.2 | No | Absent → no shared service |
| `configuration` | V3.2 | No | Absent → no config UI |
| `contributions` (audit-doc legacy) | legacy | No | **Deprecated** → maps to `classroomTools`/`provides` |

**Rule:** New fields are *optional and additive*. A v1.0 manifest loads on the target architecture with zero changes.

---

## 4. Terminology Reconciliation (Compatibility-critical)

Drift between audit docs and the SDK must be reconciled **in docs only** (no code change) to avoid contract ambiguity:

| Concept | Audit-doc term | SDK / code term | Canonical (target) |
|---------|---------------|-----------------|--------------------|
| Plugin access decl | `permissions` (plugin.json) | `capabilitiesProposed` (Manifest) | **`capabilitiesProposed`** |
| Plugin UI decl | `contributions` (plugin.json) | `classroomTools` / `provides` | **`classroomTools` / `provides`** |
| Host capability ID | `cap_plugin_management` | `capability_plugin` | **`cap_plugin_management`** |
| Activation hook | `onActivate` (audit) | `activate()` (code) | **`activate()` / `deactivate()`** |
| SDK version label | `V2.5` / `V3.2` | `engines.openlearn: "^0.1.10"` | Normalize to `engines.openlearn` gate |

Reconciling these in documentation (not code) preserves 100% runtime compatibility.

---

## 5. Plugin Permission ↔ Platform Permission Mapping

| Plugin capability | Platform Permission (Infrastructure) | Default Policy | Business RBAC? |
|-------------------|--------------------------------------|----------------|----------------|
| `vfs:read` | `perm_plugin_vfs_read` | Allow | **No** |
| `vfs:write` | `perm_plugin_vfs_write` | Deny (explicit grant) | **No** |
| `network:fetch` | `perm_plugin_network` | Allow | **No** |
| `command:execute` | `perm_plugin_command` | Controlled | **No** |
| `ai:invoke` | `perm_plugin_ai` | Controlled | **No** |
| `sandbox execute` | `perm_plugin_execute` (existing) | Allow | **No** |
| `plugin install` | `perm_plugin_install` (existing) | Allow | **No** |

> **Invariant:** Plugin permissions are strictly isolation-scoped. They never participate in user business RBAC (per PI-012). This is a compatibility guarantee, not a configurable option.

---

## 6. Built-in Plugin Compatibility

All built-in plugins (`packages/plugins/builtin.ts`, `vfs.ts`, `management.ts`, `ai-planner.ts`, `assignment-eval.ts`, `process.ts`) load and run unchanged because:
- Their manifests use the stable field set.
- Their `PluginContext` service usage is unchanged.
- Their extension-point IDs are stable.

---

## 7. Test & Verification Compatibility Gate

Before any stage is marked complete, the following must hold (per `Plugin Compatibility Report.md`):

1. `pnpm test` — all plugin-host, plugin-hardening, plugin-namespace, plugin-platform-integration suites green.
2. `pnpm lint` (`tsc --noEmit`) — SDK + host clean.
3. At least one built-in plugin exercises start → activate → command → event → deactivate without regression.
4. A third-party plugin (using only public SDK) loads on the target architecture.

---

## 8. Compatibility Risk Summary

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Manifest schema break | Very Low | Additive fields only; single source of truth. |
| SDK contract break | Very Low | No removal; additive re-exports. |
| Permission scope creep | Low | Hard Infrastructure-only boundary. |
| Capability ID collision | Low | Single canonical ID registry. |

**Conclusion:** The refactor is **non-breaking** at every stage. Compatibility is asserted by the audit and preserved by the additive-only change policy.
