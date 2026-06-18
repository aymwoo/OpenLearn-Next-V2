---
phase: 01-token-di
plan: 04
status: complete
duration: 3m
completed_at: 2026-06-18T09:00:00Z
type: gap-closure
autonomous: true
wave: 4
depends_on:
  - 01-03
requires:
  - PLUG-04
provides: tsc-strict 配置修正（关闭 G-001 差距）
affects:
  - tsconfig.json
  - package.json
tech-stack:
  added: []
  patterns: []
key-files:
  modified:
    - tsconfig.json (plugins[0].name: "tsc-strict" → "typescript-strict-plugin")
    - package.json (移除 devDependencies 中的 tsc-strict 声明)
decisions: []
metrics:
  tasks_total: 1
  tasks_completed: 1
  plan_duration_seconds: 129
---

# Phase 01 Plan 04: 修复 tsc-strict plugin name 配置不匹配 摘要

**一话总结：** 将 tsconfig.json 中 tsc-strict plugin name 从 "tsc-strict" 修正为 typescript-strict-plugin 包期望的 "typescript-strict-plugin"，同时清理未安装的 tsc-strict devDependency 声明，关闭 VERIFICATION.md 的 G-001 差距。

## 任务执行

### Task 1: 修复 tsconfig.json plugin name 并清理未使用的 tsc-strict devDependency

**操作：**

1. 将 `tsconfig.json` 第 27 行的 `compilerOptions.plugins[0].name` 从 `"tsc-strict"` 改为 `"typescript-strict-plugin"`，与 `typescript-strict-plugin@2.4.4` 包中 `dist/common/constants.js` 的 `PLUGIN_NAME` 常量匹配
2. 从 `package.json` 的 `devDependencies` 中移除 `"tsc-strict": "^2.4.5"` 声明（floklein 独立包从未成功安装）

**修改文件：** `tsconfig.json`，`package.json`

**验证结果：**

| 条件 | 描述 | 结果 |
|------|------|------|
| AC1 | tsconfig.json 中 plugin name 为 "typescript-strict-plugin" | PASS |
| AC2 | tsconfig.json 中 paths 仍为 ["./packages/core/di"] | PASS |
| AC3 | npx tsc-strict 退出 code 0，不再报告 "isn't configured" | PASS (7 strict files all passed) |
| AC4 | package.json devDependencies 中不再包含 "tsc-strict" | PASS |
| AC5 | pnpm vitest run packages/core/di/ 34/34 tests pass | PASS |

**提交：** `f30a1d8` — fix(01-token-di): 修正 tsc-strict plugin name 并清理未使用的 devDependency

## 偏差记录

无 — 计划完全按预期执行。

## Threat Flags

无 — 本计划仅修改配置文件（tsconfig.json + package.json），不涉及代码执行路径变更、新网络端点、新依赖安装或信任边界变动。

## 已知 Stub

无 — 本次修改不涉及任何代码逻辑，仅修正配置值。

## Self-Check: PASSED

- SUMMARY.md exists and is committed
- Commit f30a1d8 verified in git history
- All 5 acceptance criteria verified with automated checks
