# PI-009 Implementation Report — Capability Runtime

**Increment:** PI-009 — Capability Runtime
**Module:** `packages/core/capability-runtime/`
**Commit:** `feat(kernel): implement capability runtime (PI-009)`
**Status:** ✅ Complete — 17/17 unit tests passing, `tsc --noEmit` clean for the module.

---

## 1. Objective

Introduce a self-contained **Capability Runtime** as a first-class Platform Kernel
subsystem responsible for capability **registration, resolution, and lifecycle
management**, layered on top of the existing `PlatformServiceRegistry` (PI-007) and
`PlatformContainer` (PI-008), and integrated with `PlatformBuilder`.

The module is **distinct** from the pre-existing `packages/core/capability/` invocation
framework and the `capability-governance` / `capability-system` subsystems. It does **not**
duplicate or modify those subsystems or any business module.

---

## 2. Components Delivered

| File | Type | Responsibility |
|---|---|---|
| `CapabilityStatus.ts` | enum + FSM | `CapabilityStatus` union (`Registered`/`Resolved`/`Active`/`Inactive`/`Disabled`/`Disposed`), `CAPABILITY_STATUS_TRANSITIONS`, `canTransition()`. |
| `CapabilityError.ts` | errors | `CapabilityError` with stable `code`, `capabilityId`, and `resolutionPath`. |
| `types.ts` | contracts | `CapabilityDescriptorInit`, `CapabilityResolutionOptions`, `CapabilityResolutionMode`, `CapabilityActivator`, `CapabilityValidationReport`, `CapabilityResolutionHost`, `BuilderIntegrationSource`, etc. |
| `CapabilityDescriptor.ts` | model | Immutable metadata + mutable `status`; validates non-empty id and requires an activator / contract / provider. |
| `CapabilityProvider.ts` | model | Activation abstraction (`Single`/`Multiple`/`Priority`/`Default`), owns the `activator`, carries `priority`/`isDefault`. |
| `CapabilityContext.ts` | runtime | Handed to activators; resolves siblings/services, records diagnostics, detects circular dependency via a stack. |
| `CapabilityResolver.ts` | engine | Resolves `Single`/`Optional`/`Validation` (by id) and `Multiple`/`Priority`/`Default` (by contract); caches activated instances. |
| `CapabilityRegistry.ts` | store | Source of truth: `register`/`unregister`/`replace`/`exists`/`find`/`list`/`listByContract`, duplicate detection, contract index. |
| `PlatformCapability.ts` | wrapper | Binds descriptor + provider, tracks `status` and caches the activated `instance`; validates all transitions. |
| `CapabilityRuntime.ts` | orchestrator | Public API + integration with `PlatformServiceRegistry`, `PlatformContainer`, `PlatformBuilder`. |
| `index.ts` | barrel | Re-exports the public surface. |

---

## 3. Registration & Resolution API

```
register(descriptor, providerInit?)      unregister(id)      replace(descriptor, providerInit?)
exists(id)   find(id)   list()   listByContract(contract)
resolve<T>(id, options?)   resolveAll<T>(contract)
activate(id)  deactivate(id)  enable(id)  disable(id)  dispose(id)
validate(): CapabilityValidationReport
attachBuilder(source)   isBuilderAware(id)
```

**Resolution modes** (`CapabilityResolutionMode`):
- `Single` — resolve by capability id (default).
- `Optional` — like `Single` but returns `undefined`/`fallback` when missing.
- `Validation` — return the descriptor only; never activates.
- `Multiple` — treat `id` as a *contract*; return every member.
- `Priority` — treat `id` as a *contract*; return the highest-`priority` member.
- `Default` — resolve by id, falling back to an `isDefault` provider of the same contract.

---

## 4. Integration (required by spec)

1. **`PlatformServiceRegistry`** — every activator-backed capability is *also* registered as a
   platform service via a lazy factory (`() => resolveCapability(id)`). The registry therefore
   remains the single source of truth and the capability is resolvable as an ordinary service.
2. **`PlatformContainer` (PI-008)** — when supplied, the runtime mirrors capabilities as DI
   services (`container.registerFactory(...)`), so capabilities participate in the
   dependency-injection graph without bypassing the registry.
3. **`PlatformBuilder`** — `attachBuilder(source)` accepts a builder's `capabilityCatalog`
   (structural `BuilderIntegrationSource`), enabling `isBuilderAware(id)` cross-referencing. No
   modification to `PlatformBuilder` was required.

---

## 5. Lifecycle (FSM)

```
Registered ──▶ Resolved ──▶ Active ⇄ Inactive
    │   │          │           │
    ▼   ▼          ▼           ▼
Disabled ◀── (from Resolved/Active/Inactive)
    │
    ▼
Disposed  (terminal)
```
All transitions are enforced by `canTransition`; illegal transitions throw `CapabilityError`
(`INVALID_TRANSITION`).

---

## 6. Testing

Test file: `packages/core/__tests__/capability-runtime.test.ts` (17 tests).

| Area | Cases |
|---|---|
| Registration | register, duplicate rejection, replace, unregister |
| Resolution | single activation + caching, optional missing, priority selection, multiple (contract), default fallback |
| Lifecycle | full FSM walk (activate/deactivate/disable/enable/dispose), illegal transition rejected |
| Validation | missing dependency reported, circular dependency detected, well-formed graph passes |
| Builder integration | `isBuilderAware` against an attached builder source |
| Regression | capability mirrored into `PlatformContainer` returns the same instance via DI; capability exposed through `PlatformServiceRegistry` |

Result: **17 passed / 17**.

---

## 7. Validation & Conformance

- `npx vitest run packages/core/__tests__/capability-runtime.test.ts` → 17/17 ✅
- `npx tsc --noEmit` → **0 errors** in `packages/core/capability-runtime/**` and
  `packages/core/di/**`. The only remaining `tsc` errors in the repo are pre-existing,
  unrelated scaffold fixtures (`packages/plugin-sdk/scaffold/...`,
  `packages/core/esm-loader/__tests__/fixtures/syntax-error.js`).

---

## 8. Deviations & Notes

- The roadmap listed PI-008 as completed, but at the start of this increment `PlatformContainer`
  did not exist. PI-008 was therefore implemented first (commit `b5fc6bf`) as a prerequisite,
  then PI-009 was built on top of it — consistent with the spec's requirement that PI-009
  integrate with `PlatformContainer`.
- `CapabilityDescriptorInit.isDefault` was added as first-class metadata so a descriptor-only
  registration can declare a default capability without a separate `providerInit`.
- The capability runtime's `CapabilityStatus` (operational: Registered→Active) is intentionally
  separate from the governance `CapabilityLifecycleStatus` (publication: Draft→Archived).
