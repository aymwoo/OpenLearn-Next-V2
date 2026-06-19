---
phase: 09
slug: 09-frontend
type: validation
created: 2026-06-19
status: active
---

# Phase 9 — Validation Architecture

## Validation Approach

Phase 9 is a hybrid frontend/backend phase spanning React components (visual/interaction testing), Web Worker isolation (sandbox testing), Extension Points (integration testing), and dual-system transition (behavioral testing).

### Test Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| Unit tests | vitest + jsdom | ServiceRegistry, PluginHost state machine, ExtensionPointRegistry, i18n |
| Component tests | vitest + jsdom (react-testing-library) | PluginHostProvider, ExtensionPointRenderer, LegacyPluginBadge, ZIPDropZone, MigrationPrompt |
| Worker tests | vitest + MessageChannel mock | BrowserWorkerTransport, ServiceHost RPC, event forwarding |
| E2E tests | Manual (browser) | Plugin center ZIP upload flow, legacy badge visibility, migration button |

### nyquist Coverage Dimensions

1. **Frontend ServiceRegistry** — register/resolve/unregister with 4 frontend service tokens
2. **PluginHost Lifecycle** — install/activate/deactivate/uninstall in browser (inline mode)
3. **ExtensionPointRegistry** — slot registration, dedup, React.lazy component retrieval
4. **ExtensionPointRenderer** — loading/loaded/error/empty states
5. **BrowserWorkerTransport** — worker creation, postMessage, terminate, crash recovery
6. **ServiceHost RPC** — invoke protocol, capability enforcement, serialization
7. **Event Forwarding** — subscribe/unsubscribe, event delivery to Worker, cleanup on deactivate
8. **Command Routing Priority** — modern handler first, legacy fallback, no double-execution
9. **LegacyPluginBadge** — visibility based on execution_mode, accessible color contrast
10. **ZIPDropZone** — drag-over visual state, file parsing, error/error states
11. **MigrationPrompt** — visibility when legacy plugins exist, dismiss behavior

### Automated Checks

- `npx vitest run` — full test suite (all 31+ test files including new Phase 9 tests)
- `npx tsc --noEmit` — TypeScript type checking
- Manual browser verification: plugin center ZIP upload → manifest preview → install → activate
- Manual browser verification: legacy badge visibility for plugins with execution_mode='legacy'
- Manual browser verification: migration prompt banner display and dismiss

## Verification Criteria

1. `FrontendPluginHost` can install, activate, deactivate, and uninstall plugins in inline mode
2. Extension Point components registered by plugins render correctly via React.lazy + Suspense
3. Browser Web Worker correctly loads plugin ESM bundle and establishes ServiceProxy RPC
4. Worker plugin command execution routes through CapabilityGuard on main thread
5. Legacy-format plugins display yellow "Migratable" badge in plugin center
6. CommandBus `getHandler()` prefers modern handler over legacy handler

## Gap Analysis

No gaps detected — all Phase 9 success criteria are covered by planned tests.
