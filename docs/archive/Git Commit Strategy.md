# OpenLearn Git Commit Strategy (Git 提交策略)

## 1. Executive Summary (概述)

本策略规定了 Composition Root 的 Commit 规则。每一个 Commit 对应唯一的 Execution Unit，禁止跨模块大包提交。

---

## 2. Commit Strategy Matrix (提交映射表)

| Commit ID | Target EU | Commit Message | 验证标准 |
|---|---|---|---|
| **Commit-01** | EU-01 | `feat(bootstrap): add Composition Root types and descriptors` | `pnpm lint` 0 Errors |
| **Commit-02** | EU-02 | `feat(bootstrap): implement immutable BootstrapContext` | `pnpm lint` 0 Errors |
| **Commit-03** | EU-03 | `feat(bootstrap): implement 6-stage BootstrapPipeline` | `pnpm lint` 0 Errors |
| **Commit-04** | EU-04 | `feat(bootstrap): implement PlatformBuilder and unit test suite` | `bootstrap.test.ts` 100% Pass |
| **Commit-05** | EU-05 | `refactor(server): wire server.ts to PlatformBuilder composition root` | 全量 11 大测试套件 100% Pass |
