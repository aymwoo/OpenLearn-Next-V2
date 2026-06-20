---
phase: 13
slug: decouple
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
---

# Phase 13 — Validation Strategy

Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/mfe/__tests__/decouple.test.tsx` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/mfe/__tests__/decouple.test.tsx`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | MFE-VIEW-01, MFE-VIEW-02, MFE-VIEW-03, MFE-VIEW-04 | — | N/A | unit | `npx vitest run src/mfe/__tests__/decouple.test.tsx` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | MFE-VIEW-01, MFE-VIEW-02 | — | N/A | config | `pnpm install` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 2 | MFE-VIEW-01, MFE-VIEW-02 | T-13-03 | DI Socket Service Resolving | unit | `npx vitest run src/mfe/__tests__/decouple.test.tsx` | ❌ W0 | ⬜ pending |
| 13-01-04 | 01 | 2 | MFE-VIEW-03 | T-13-01 | CSS Sandbox Verification | style | `pnpm --filter mfe-whiteboard build && pnpm --filter mfe-courseware build` | ❌ W0 | ⬜ pending |
| 13-01-05 | 01 | 2 | MFE-VIEW-01, MFE-VIEW-02, MFE-VIEW-04 | T-13-02 | Secure Seed Verification | unit | `npx vitest run src/mfe/__tests__/decouple.test.tsx` | ❌ W0 | ⬜ pending |
| 13-01-06 | 01 | 3 | MFE-VIEW-01, MFE-VIEW-02, MFE-VIEW-04 | — | N/A | integration | `npm run lint` | ❌ W0 | ⬜ pending |
| 13-01-07 | 01 | 3 | MFE-VIEW-01, MFE-VIEW-02, MFE-VIEW-03, MFE-VIEW-04 | T-13-02, T-13-03 | Fail-Safe & DI Boundary Verification | integration | `npx vitest run src/mfe/__tests__/decouple.test.tsx && npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/mfe/__tests__/decouple.test.tsx` — stubs for MFE-VIEW-*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Collaborative whiteboard sync validation over WebSockets | MFE-VIEW-01 | Requires active socket connection and coordination between multi-user clients | Start Host and Whiteboard dev servers; login as Teacher and Student; paint elements and verify high-frequency drawing coordinates sync in real-time |
| Computed styles leakage inspect | MFE-VIEW-03 | Requires inspection of compiled CSS assets and runtime class applications in DOM | In Chrome DevTools, inspect the Host shell components and subproject elements. Confirm no tailwind preflight rules leak from subproject CSS, and that classes correctly use the `wb:` and `cw:` prefixes |
| Fail-safe dynamic toggle boundary check | MFE-VIEW-04 | Requires dynamic manipulation of sqlite db table records and local server connection | De-register or disable the entry from `mfe_remotes` table, reload the host page, and verify it displays the error/disabled fallback placeholder instead of throwing a blank screen crash |
| DI Whitelist & Zustand scoping verification | MFE-VIEW-01, MFE-VIEW-02 | Requires tracing DI resolving logs and store state values | Inspect subproject console logs to verify that whitelisted services (like ISocketService) resolve without issues, and that private/non-whitelisted services throw 'Access Denied'. Verify that local UI adjustments (brush color, size) do not sync or populate in the host Zustand appStore. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
