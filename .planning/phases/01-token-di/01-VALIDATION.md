---
phase: 01
slug: token-di
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 |
| **Config file** | `vitest.config.ts`（项目根目录 — Wave 0 创建） |
| **Quick run command** | `npx vitest run packages/core/di/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/core/di/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | SC-1 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/token.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | SC-2 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | SC-3 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | SC-4 | T-01-01 | 循环依赖抛 CircularDependencyError 含 Token 列表 | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | SC-5 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | D-08 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 3 | D-06 | T-01-02 | 缺失依赖注册时抛 MissingDependencyError | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 3 | D-09 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-05 | 03 | 3 | D-10 | — | N/A | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest 配置文件（项目根目录）
- [ ] `packages/core/di/__tests__/token.test.ts` — Token 单元测试桩
- [ ] `packages/core/di/__tests__/service-registry.test.ts` — ServiceRegistry 单元测试桩
- [ ] `package.json` — 添加 `"test": "vitest run"` 脚本
- [ ] vitest 框架安装：`pnpm add -D vitest@^4.1.9`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `import()` 方式加载 DI 模块无运行时错误 | SC-1, SC-2 | ESM 动态导入兼容性验证 | `node -e "import('./packages/core/di/index.js').then(m => console.log(Object.keys(m)))"` |
| `tsc --noEmit` 对 DI 模块零错误 | ALL | 类型级验证，非运行时测试 | `npx tsc --noEmit`（lint 脚本已包含） |
| Token 命名格式正则验证 | SC-1 | 输入验证为防御性设计 | 手动注入非法 Token 名，确认注册时抛异常 |

---

## Security Threat Model

| Threat | STRIDE | Mitigation | Test |
|--------|--------|------------|------|
| 原型链污染 via register(token, malicious) | Tampering | TypeScript 编译期类型约束 + Token<T> 泛型 | D-04 泛型推导保证编译期类型安全 |
| 资源耗尽 via 大量注册 | DoS | Phase 1 不防范（<100 Token 可控） | N/A — Phase 5 Worker 隔离提供真隔离 |
| Token 命名注入（非法字符） | Input Validation | Token 构造函数正则验证命名格式 | Token 测试包含格式验证用例 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
