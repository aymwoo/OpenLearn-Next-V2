# Requirements: OpenLearnV2 — 微前端架构改造

**Defined:** 2026-06-19
**Core Value:** 将前端庞大的 App.tsx 拆分为独立的微前端模块，并在前端集成 Vite Module Federation 以支持更灵活的插件渲染。

## v1 Requirements

### Infrastructure & Integration

- [ ] **MFE-INF-01**: Configure `@module-federation/vite` plugin in host and remote applications with strict singleton sharing for `react`, `react-dom`, and `zustand`.
- [ ] **MFE-INF-02**: Setup compilation target to `esnext` in host/remotes and support dynamic base/asset path resolution.
- [ ] **MFE-INF-03**: Configure Tailwind CSS v4 class scanning in Host for Remote modules (using `@source`).

### Dynamic Loading & Lifecycle

- [ ] **MFE-LOAD-01**: Implement `MfeLoader` container component supporting dynamic remote entry resolution via `@module-federation/runtime`.
- [ ] **MFE-LOAD-02**: Implement React Error Boundaries and Loading fallbacks in `MfeLoader` to prevent remote crashes from bringing down the host.
- [ ] **MFE-LOAD-03**: Standardize Remote application export contract with `bootstrap`, `mount`, and `unmount` hooks.
- [ ] **MFE-LOAD-04**: Ensure complete React 19 root unmounting (`root.unmount()`) on remote destruction to avoid memory leaks.

### State Sharing & Services Injection

- [ ] **MFE-BRIDGE-01**: Build `MfeContext` to pass host state and services (Zustand store, Socket.io, DI registry) to remotes.
- [ ] **MFE-BRIDGE-02**: Support Remote subscriptions to the global Zustand store singleton without duplicate state store instantiation.
- [ ] **MFE-BRIDGE-03**: Inject host frontend DI registry (`ServiceRegistry`) services (like API, EventBus) into remote applications.
- [ ] **MFE-BRIDGE-04**: Enable Dynamic Remote components to subscribe to and publish real-time events via Host EventBus.

### Views Refactoring & Sandboxing

- [ ] **MFE-VIEW-01**: Extract and refactor the whiteboard view as an independent remote micro-app module.
- [ ] **MFE-VIEW-02**: Extract and refactor the courseware view as an independent remote micro-app module.
- [ ] **MFE-VIEW-03**: Implement CSS isolation (Tailwind prefixing or CSS module scoping) for whiteboard and courseware remotes.
- [ ] **MFE-VIEW-04**: Integrate micro-frontend dynamic remote registration with database configurations via `FrontendPluginHost` in the Host Shell App.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shadow DOM style injection inside MfeLoader (MFE-SEC-01) | Deferred for simpler CSS module/prefix isolation to reduce implementation complexity. |
| Unverified third-party iframe containment sandbox (MFE-SEC-02) | Focus is on internal first-party view refactoring; third-party sandboxing will be scoped as a separate security milestone. |
| Dynamic remote version mismatch auto-downgrade (MFE-SEC-03) | Simple fail-safe error boundaries are sufficient for this initial migration. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MFE-INF-01 | TBD | Pending |
| MFE-INF-02 | TBD | Pending |
| MFE-INF-03 | TBD | Pending |
| MFE-LOAD-01 | TBD | Pending |
| MFE-LOAD-02 | TBD | Pending |
| MFE-LOAD-03 | TBD | Pending |
| MFE-LOAD-04 | TBD | Pending |
| MFE-BRIDGE-01 | TBD | Pending |
| MFE-BRIDGE-02 | TBD | Pending |
| MFE-BRIDGE-03 | TBD | Pending |
| MFE-BRIDGE-04 | TBD | Pending |
| MFE-VIEW-01 | TBD | Pending |
| MFE-VIEW-02 | TBD | Pending |
| MFE-VIEW-03 | TBD | Pending |
| MFE-VIEW-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15 ⚠️

---
*Requirements defined: 2026-06-19*
*Last updated: 2026-06-19 after initial definition*
