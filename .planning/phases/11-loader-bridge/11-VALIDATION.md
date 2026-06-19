---
phase: 11
slug: loader-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | none — see Wave 0 |
| **Quick run command** | `npx vitest run src/mfe/__tests__/ --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/mfe/__tests__/ --reporter=verbose --changed`
- **After every plan wave:** Run `npx vitest run src/mfe/__tests__/ --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | MFE-LOAD-01 | — | MfeLoader resolves remote entry URL and renders component | integration | `npx vitest run src/mfe/__tests__/MfeLoader.test.tsx` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | MFE-LOAD-02 | — | Error Boundary catches render crash, shows fallback UI with retry/dismiss | integration | `npx vitest run src/mfe/__tests__/MfeErrorBoundary.test.tsx` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | MFE-LOAD-03 | — | createMfeApp lifecycle contract: mount, unmount, update, styles | unit | `npx vitest run src/mfe/__tests__/lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 1 | MFE-LOAD-04 | — | root.unmount() called on MfeLoader unmount, no detached DOM nodes | integration | `npx vitest run src/mfe/__tests__/memory.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/mfe/__tests__/MfeLoader.test.tsx` — covers MFE-LOAD-01
- [ ] `src/mfe/__tests__/MfeErrorBoundary.test.tsx` — covers MFE-LOAD-02
- [ ] `src/mfe/__tests__/lifecycle.test.ts` — covers MFE-LOAD-03
- [ ] `src/mfe/__tests__/memory.test.ts` — covers MFE-LOAD-04
- [ ] `src/mfe/__tests__/test-utils.tsx` — shared test fixtures (mock MfeContext, mock remote module factory)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Memory leak detection (dev mode) | D-20 | Requires DevTools heap profiling across multiple mount/unmount cycles | Open DevTools → Memory tab → take heap snapshot before and after 10 mount/unmount cycles → verify no detached DOM nodes or retained React fibers |
| Remote dev server connectivity | D-23 | Requires running remote dev servers on ports 5174/5175 | Start `npm run dev` for both mfe-whiteboard and mfe-courseware → verify MfeLoader resolves remote entry URLs and renders components |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
