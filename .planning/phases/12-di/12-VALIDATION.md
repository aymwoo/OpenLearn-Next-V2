---
phase: 12
slug: di
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/mfe/__tests__` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/mfe/__tests__`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | MFE-BRIDGE-01, MFE-BRIDGE-04 | — | N/A | unit | `npx vitest run src/mfe/__tests__/bridge.test.tsx` | ❌ W0 | ✅ green |
| 12-01-02 | 01 | 1 | MFE-BRIDGE-02 | — | N/A | unit | `npx vitest run src/mfe/__tests__/bridge.test.tsx` | ❌ W0 | ✅ green |
| 12-01-03 | 01 | 2 | MFE-BRIDGE-01, MFE-BRIDGE-04 | — | N/A | unit | `npx vitest run src/mfe/__tests__/bridge.test.tsx` | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 2 | MFE-BRIDGE-03 | T-12-01 | DI Whitelist Enforcement | unit | `npx vitest run src/mfe/__tests__/bridge.test.tsx` | ❌ W0 | ⬜ pending |
| 12-01-05 | 01 | 3 | MFE-BRIDGE-01, MFE-BRIDGE-03, MFE-BRIDGE-04 | — | N/A | integration | `npx vitest run src/mfe/__tests__/bridge.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/mfe/__tests__/bridge.test.tsx` — stubs for MFE-BRIDGE-*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EventBus manual event triggering via HelpTabContent | MFE-BRIDGE-04 | Requires local socket connection to broadcast network events | Trigger a server event via HelpTabContent and confirm it routes to the frontend EventBus without cycle loops |
| Memory leak verification on sub-app unmount | MFE-BRIDGE-01, MFE-BRIDGE-04 | Requires browser heap snapshot analysis | Mount and unmount sub-apps repeatedly while monitoring Chrome DevTools heap snapshots to confirm event wrappers and socket subscriptions are completely garbage collected |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
