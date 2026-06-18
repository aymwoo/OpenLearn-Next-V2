---
phase: 03
slug: esm
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | `vitest.config.ts` (需更新 include 模式以包含 esm-loader 测试) |
| **Quick run command** | `npx vitest run packages/core/esm-loader/__tests__/ --reporter=verbose` |
| **Full suite command** | `npm test` (vitest run) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/core/esm-loader/__tests__/ --reporter=verbose`
- **After every plan wave:** Run `npm test` (full vitest run)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 (esm-loader + errors) | 01 | 1 | PLUG-01 | T-03-06 | 结构化错误不泄露文件系统路径 | type-check | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 03-01-T2 (manifest-schema + test) | 01 | 1 | PLUG-02 | T-03-03 | zod schema 在安装阶段拒绝无效 manifest | unit | `vitest run packages/core/esm-loader/__tests__/manifest-schema.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-T1 (loader 实现 + fixtures) | 02 | 2 | PLUG-01 | T-03-04 | Blob URL 在 load() 后立即 revoke | type-check | `npx tsc --noEmit`（行为验证由 03-02-T2 覆盖） | ❌ W0 | ⬜ pending |
| 03-02-T2 (loader 测试) | 02 | 2 | PLUG-01 | T-03-01 | data: URL 模块无法访问 require/fs | unit | `vitest run .../node-loader.test.ts .../browser-loader.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-T1 (barrel + 全量测试) | 03 | 2 | PLUG-01, PLUG-02 | — | barrel 导出完整，全量测试 green | unit | `vitest run packages/core/esm-loader/__tests__/` | ❌ W0 | ⬜ pending |
| 03-04-T1 (install-utils) | 04 | 3 | PLUG-02 | T-03-02 | ZIP bomb ≤10MB + 路径穿越拒绝 | type-check | `npx tsc --noEmit`（行为验证由 03-04-T3 bundle.test.ts 覆盖） | ❌ W0 | ⬜ pending |
| 03-04-T2 (PRT + Kernel + DB) | 04 | 3 | PLUG-01 | T-03-06 | ALTER TABLE 幂等执行；EsmLoader DI 注入 | type-check | `npx tsc --noEmit`（行为验证由 03-04-T3 bundle.test.ts 覆盖） | ❌ W0 | ⬜ pending |
| 03-04-T3 (集成测试) | 04 | 3 | PLUG-01, PLUG-02 | T-03-01 | esbuild external 保留 @openlearn/* Token import；端到端通过 | integration | `vitest run packages/core/esm-loader/__tests__/bundle.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/esm-loader/__tests__/manifest-schema.test.ts` — manifest 校验测试 (PLUG-02) — Plan 01 Task 2
- [ ] `packages/core/esm-loader/__tests__/node-loader.test.ts` — NodeEsmLoader 完整测试 (PLUG-01) — Plan 02 Task 2
- [ ] `packages/core/esm-loader/__tests__/browser-loader.test.ts` — BrowserEsmLoader smoke 测试 (PLUG-01) — Plan 02 Task 2
- [ ] `packages/core/esm-loader/__tests__/bundle.test.ts` — esbuild + ZIP + E2E 集成测试 (PLUG-01, PLUG-02) — Plan 04 Task 3
- [ ] `packages/core/esm-loader/__tests__/fixtures/` — 测试 fixtures 目录（7 个文件：4 .js + 2 .json + 1 .zip）
- [ ] `vitest.config.ts` — 更新 include 模式以包含 esm-loader 测试
- [ ] 测试基础设施已存在（vitest 已安装，配置可用），主要缺口是测试文件本身

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ZIP 插件包完整安装流程（上传 → 解压 → 校验 → esbuild 打包 → 存储） | PLUG-02 | 需要真实 ZIP 文件上传和 HTTP 请求 | 通过 curl 或浏览器上传测试 ZIP 包，检查插件是否正确出现在已安装列表 |
| 现有 vm 插件在新旧加载器并存时的行为一致性 | PLUG-01 | 需要完整服务器环境 | 启动服务器，安装一个 vm 格式插件和一个 esm 格式插件，验证两者均正常工作且互不干扰 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
