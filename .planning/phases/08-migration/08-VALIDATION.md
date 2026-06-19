---
phase: 8
slug: migration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run packages/plugins/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/plugins/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/vfs.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/process.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | PLUG-11 | — | N/A | unit | `npx vitest run packages/core/__tests__/kernel-plugins.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/management.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/builtin.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 3 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/ai-planner.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 3 | PLUG-12 | — | N/A | unit | `npx vitest run packages/plugins/__tests__/ai-submit-injector.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-03 | 03 | 3 | PLUG-11 | — | N/A | unit | `npx vitest run packages/core/__tests__/legacy-cleanup.test.ts` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 4 | PLUG-02 | — | N/A | unit | `node scripts/build-plugins.mjs` | ❌ W0 | ⬜ pending |
| 08-04-02 | 04 | 4 | PLUG-12 | — | Worker sandboxing and message routing | unit | `npx vitest run packages/plugins/__tests__/quiz.test.ts` | ❌ W0 | ⬜ pending |
| 08-04-03 | 04 | 4 | PLUG-03 | — | Worker RPC ServiceProxy communication | integration | `npx vitest run packages/core/__tests__/worker-rpc.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/plugins/__tests__/vfs.test.ts` — stubs for VFS commands
- [ ] `packages/plugins/__tests__/process.test.ts` — stubs for Process commands
- [ ] `packages/plugins/__tests__/management.test.ts` — stubs for Management commands
- [ ] `packages/plugins/__tests__/builtin.test.ts` — stubs for Builtin commands

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-19
