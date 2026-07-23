# OpenLearn Composition Root Rollback Strategy (执行单元回滚策略)

## 1. Executive Summary (概述)

本策略规定了每一个 Execution Unit (EU) 出现故障时的精准回滚指令与应急恢复流程。

---

## 2. EU Rollback Matrix (EU 回滚对应表)

| Execution Unit | 回滚指令 (Rollback Command) | 回滚影响 (Rollback Impact) | 恢复验证 (Verification) |
|---|---|---|---|
| **EU-01** | `git reset --hard HEAD~1` | 移除未引用的 `types` 文件，无副作用 | `pnpm lint` 干净 |
| **EU-02** | `git reset --hard HEAD~1` | 移除未引用的 `context` 文件，无副作用 | `pnpm lint` 干净 |
| **EU-03** | `git reset --hard HEAD~1` | 移除未引用的 `pipeline` 文件，无副作用 | `pnpm lint` 干净 |
| **EU-04** | `git reset --hard HEAD~1` | 移除 `builder` 与测试套件，无副作用 | `pnpm test` 全量通过 |
| **EU-05** | `git revert HEAD` | `server.ts` 回滚至 `new Kernel()`，全服务恢复 | 服务正常启动 & 测试全过 |
