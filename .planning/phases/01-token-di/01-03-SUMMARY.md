---
phase: 01-token-di
plan: 03
type: execute
tags: [di, barrel, kernel-integration, tsc-strict, ci]
requires: [01-01, 01-02]
provides: [kernelContainer.serviceRegistry, barrel-exports, strict-type-checking]
affects: [packages/core/kernel, packages/core/di, package.json, tsconfig.json]
tech-stack:
  added: [tsc-strict@2.4.5]
  patterns: [barrel-export, esm-js-extension, tsc-strict-op-out, kernel-subsystem-integration]
key-files:
  created: [packages/core/di/index.ts]
  modified:
    - packages/core/kernel/index.ts
    - package.json
    - tsconfig.json
    - packages/core/di/__tests__/token.test.ts
decisions:
  - tsc-strict（floklein/tsc-strict）替代 typescript-strict-plugin CLI 方式 — 独立 CLI，路径级配置更简单
  - ServiceRegistry 在构造函数中优先初始化 — 无依赖其他子系统，为 bootstrap 阶段预留前置位置
  - tsc-strict 使用 paths 白名单而非 opt-out 忽略 — 仅 packages/core/di/ 接受 strict 检查，无需修改其他文件
metrics:
  start: "2026-06-18T06:46:12Z"
  end: "2026-06-18T06:54:12Z"
  duration: "8m"
  completed_date: "2026-06-18"
---

# Phase 01 Plan 03: DI 容器集成与 CI Strict 类型检查 Summary

将 DI 容器（Token + ServiceRegistry）正式集成到 Kernel 单例中作为第 7 个子系统，建立 barrel 导出文件，引入 tsc-strict CLI 工具实现文件级 TypeScript strict 模式检查。

## Results

| Task | Status | Commit | Files Changed |
|------|--------|--------|---------------|
| 1: 创建 barrel 导出并集成 ServiceRegistry 到 Kernel | Done | `fd384c7` | `packages/core/di/index.ts` (new), `packages/core/kernel/index.ts` |
| 2: 安装 tsc-strict 并配置 CI 类型检查 | Done | `afe0271` | `package.json`, `tsconfig.json`, `packages/core/di/__tests__/token.test.ts`, `package-lock.json` |

**成功标准达成：**
- `kernelContainer.serviceRegistry` 可通过 Kernel 单例访问（第 7 个子系统）
- barrel 导出 `index.ts` 完整（Token、ServiceRegistry、5 个错误类、3 个类型）
- tsc-strict CI 检查：7 个 strict 文件全部通过
- `di/` 目录源码文件接受 strict 类型检查且全部通过

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 修复 token.test.ts 中多余的 @ts-expect-error 指令**
- **发现于：** Task 2
- **问题：** TypeScript 5.8.3 在非 strict 模式下允许 `new Token(undefined)`（undefined 可赋值给 string），导致 `@ts-expect-error` 指令被标记为 "Unused"
- **修复：** 移除 `@ts-expect-error` 注释，改用 `undefined as any` 显式类型转换
- **修改文件：** `packages/core/di/__tests__/token.test.ts`
- **提交：** `afe0271`

### Plan-Structure Deviations

**1. tsc-strict 独立 CLI 替代 typescript-strict-plugin 配套 CLI**
- **偏离：** Plan 引用的 `typescript-strict-plugin` 配套 CLI 需要先通过 IDE 插件配置才能工作，`tsc-strict`（floklein）是独立 CLI，直接支持路径级配置
- **影响：** tsconfig.json 中 plugin name 使用 `"tsc-strict"` 而非 `"typescript-strict-plugin"`；使用 `paths` 白名单限制 strict 范围
- **结果：** 实际效果更简洁——无需给非 strict 文件添加 `@ts-strict-ignore` 注释，仅 `packages/core/di/` 目录接受 strict 检查

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (di/ 和 kernel/ 文件) | 无新错误 |
| `npx tsc-strict` | 7 个 strict 文件全部通过 |
| `pnpm run test` | 2 个测试文件，34 个测试全部通过 |

## Known Stubs

无。Plan 03 是纯基础设施集成和配置变更，不涉及 UI 或数据流。

## Threat Flags

无。无新增网络端点、认证路径、文件访问模式或信任边界变更。

## Self-Check

- [x] `packages/core/di/index.ts` exists and contains expected exports
- [x] `packages/core/kernel/index.ts` contains `serviceRegistry` property and import
- [x] `tsconfig.json` contains `tsc-strict` plugin config with `paths: ["./packages/core/di"]`
- [x] `package.json` lint script is `"tsc --noEmit && tsc-strict"`
- [x] Commit `fd384c7` exists: feat(01-token-di-03): 创建 DI barrel 导出并集成 ServiceRegistry 到 Kernel
- [x] Commit `afe0271` exists: chore(01-token-di-03): 安装 tsc-strict 并配置 CI strict 类型检查
