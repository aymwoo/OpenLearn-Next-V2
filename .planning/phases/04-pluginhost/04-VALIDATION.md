---
phase: 04
slug: pluginhost
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | `vitest.config.ts` (needs update to include plugin-host tests) |
| **Quick run command** | `npx vitest run packages/core/plugin-host/__tests__/` |
| **Full suite command** | `npm test` (vitest run) |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/core/plugin-host/__tests__/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PLUG-05-SC5 | T-04-01 | N/A | unit | `npx vitest run packages/core/plugin-host/__tests__/resource-tracker.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | PLUG-05-SC1 | T-04-02 | N/A | unit | `npx vitest run packages/core/plugin-host/__tests__/context-builder.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | PLUG-05-SC1,SC4 | T-04-03 | N/A | unit | `npx vitest run packages/core/plugin-host/__tests__/state-machine.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | PLUG-05-SC2,SC3,SC4 | T-04-04 | N/A | integration | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 4 | PLUG-05-SC1-SC5 | T-04-05 | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/plugin-host/__tests__/resource-tracker.test.ts` — covers SC-5 (resource tracking/cleanup)
- [ ] `packages/core/plugin-host/__tests__/context-builder.test.ts` — covers SC-1 (PluginContext shape, service wrapping, freeze)
- [ ] `packages/core/plugin-host/__tests__/state-machine.test.ts` — covers state transitions and illegal transition rejection
- [ ] `packages/core/plugin-host/__tests__/plugin-host.test.ts` — covers SC-2, SC-3, SC-4 (full lifecycle integration)
- [ ] `vitest.config.ts` update — add `packages/core/plugin-host/__tests__/**/*.test.ts` to include patterns
- [ ] Test fixtures — create minimal plugin source strings for testing activate/deactivate scenarios

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 插件在真实 SQLite 中 install/activate/deactivate 完整生命周期 | PLUG-05-SC4 | 需要真实数据库验证持久化行为 | 通过管理后台或 API 安装插件 → 激活 → 停用 → 卸载，检查 DB 状态 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
