---
phase: 10
slug: infra-config
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.9 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test packages/core/__tests__/mfe-config.test.ts` |
| **Full suite command** | `node scripts/build-plugins.mjs && pnpm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test packages/core/__tests__/mfe-config.test.ts`
- **After every plan wave:** Run `node scripts/build-plugins.mjs && pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | MFE-INF-01 | — | N/A | unit | `pnpm test packages/core/__tests__/mfe-config.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | MFE-INF-02 | — | N/A | integration | `pnpm test packages/core/__tests__/mfe-build.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | MFE-INF-03 | — | N/A | integration | `pnpm test packages/core/__tests__/tailwind-scan.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/__tests__/mfe-config.test.ts` — stubs for MFE-INF-01
- [ ] `packages/core/__tests__/mfe-build.test.ts` — stubs for MFE-INF-02
- [ ] `packages/core/__tests__/tailwind-scan.test.ts` — stubs for MFE-INF-03

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
