---
phase: 02
slug: token
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run packages/core/di/__tests__/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/core/di/__tests__/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PLUG-06 | — | N/A（纯接口定义） | unit | `npx vitest run packages/core/di/__tests__/interfaces.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | PLUG-06 | — | N/A（服务实现） | unit | `npx vitest run packages/core/di/__tests__/storage-service.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | PLUG-06 | — | N/A（服务实现） | unit | `npx vitest run packages/core/di/__tests__/ai-service.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | PLUG-06, PLUG-11 | — | N/A（Kernel 集成） | integration | `npx vitest run packages/core/di/__tests__/kernel-registration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/di/__tests__/interfaces.test.ts` — Token 命名格式 + 接口类型验证
- [ ] `packages/core/di/__tests__/storage-service.test.ts` — StorageService CRUD 操作
- [ ] `packages/core/di/__tests__/ai-service.test.ts` — AIService generateText 调用
- [ ] `packages/core/di/__tests__/kernel-registration.test.ts` — Kernel 中 7 个 IService 注册/解析

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 现有 `kernelContainer.xxx` 直接访问兼容 | PLUG-11 | 需要运行完整应用验证现有路由和插件加载正常 | `npm run dev`，验证教学管理操作（课程创建、白板等）正常 |
| PluginRuntime wrapped* 访问方式不变 | PLUG-11 | 需要加载现有插件验证安全包装器正常工作 | 安装一个现有插件并验证其功能正常 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
