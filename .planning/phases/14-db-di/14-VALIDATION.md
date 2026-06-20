---
phase: 14
slug: db-di
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
---

# Phase 14 — Validation Strategy

Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/core/di/__tests__/semester-grade.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | PLUG-EVAL-04 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | PLUG-EVAL-04 | T-14-03 | DI Whitelist Enforcement | unit | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 2 | PLUG-EVAL-01, PLUG-EVAL-02, PLUG-EVAL-03 | — | N/A | db | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 2 | PLUG-EVAL-04 | T-14-02 | Safe Grade Service Resolving | unit | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-05 | 01 | 2 | PLUG-EVAL-04 | T-14-03 | Frontend Proxy Resolving | integration | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-06 | 01 | 3 | PLUG-EVAL-01, PLUG-EVAL-02, PLUG-EVAL-03 | T-14-01 | Command Authorization & Input Validation | integration | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts` | ❌ W0 | ⬜ pending |
| 14-01-07 | 01 | 3 | PLUG-EVAL-01, PLUG-EVAL-02, PLUG-EVAL-03, PLUG-EVAL-04 | T-14-01, T-14-02 | Full End-to-End Grade Flow Sync | integration | `npx vitest run packages/core/di/__tests__/semester-grade.test.ts && npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/di/__tests__/semester-grade.test.ts` — stubs for PLUG-EVAL-*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Database Migrations Check on dev start | PLUG-EVAL-01 | Verifies DB startup setup | Delete the dev db file, run `npm run dev`, and run SQLite client `.schema` to verify `plugin_submissions` tables were automatically created |
| Frontend API sync test | PLUG-EVAL-04 | Requires full server runtime | Start server via `npm run dev`, trigger a mock sync request from console and verify the SQLite table `student_semester_reports` receives the score |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
