---
phase: 03-esm
plan: 04
title: "EsmLoader 集成 — esbuild 预打包、PluginRuntime ESM 分支、Kernel DI 注入、DB schema 扩展"
date: "2026-06-18"
duration_seconds: 449
task_count: 3
file_count: 12
status: complete
tags: [esm-loader, esbuild, jszip, plugin-runtime, kernel, db-schema, integration]
requires: ["03-01", "03-02", "03-03"]
provides: ["esbuild-pre-bundle", "zip-install", "esm-activation-branch", "loader-version-routing"]
tech-stack:
  added: []
  patterns:
    - "esbuild onResolve plugin 精确控制 import 解析（Token 保留/非法拒绝）"
    - "PluginRuntime evaluateAndActivateEsm 复用安全包装器逻辑"
    - "ALTER TABLE try/catch 幂等模式（遵循现有 db/index.ts 风格）"
    - "Kernel 分层初始化（Layer 0 无依赖 → EsmLoader, Layer N → PluginRuntime）"
key-files:
  created:
    - "packages/core/esm-loader/install-utils.ts"  # esbuild + jszip 工具函数
    - "packages/core/esm-loader/__tests__/bundle.test.ts"  # 8 个集成测试
    - "packages/core/esm-loader/__tests__/fixtures/sample.zip"  # 合法 ZIP fixture
    - "packages/core/esm-loader/esm-loader.ts"  # 抽象基类（重建自 upstream）
    - "packages/core/esm-loader/node-loader.ts"  # NodeEsmLoader 实现（重建）
    - "packages/core/esm-loader/browser-loader.ts"  # BrowserEsmLoader 实现（重建）
    - "packages/core/esm-loader/manifest-schema.ts"  # zod 校验 schema（重建）
    - "packages/core/esm-loader/errors.ts"  # 错误类层次（重建）
    - "packages/core/esm-loader/index.ts"  # barrel 导出（重建）
    - "vitest.config.ts"  # 测试配置
  modified:
    - "packages/core/plugin-runtime/index.ts"  # ESM 加载分支 + ZIP 安装
    - "packages/core/kernel/index.ts"  # NodeEsmLoader 创建 + DI 注入
    - "packages/core/db/index.ts"  # loader_version + zip_package 列
    - "package.json"  # vitest/zod/jsdom 依赖
    - "pnpm-lock.yaml"  # lockfile 更新
decisions:
  - "esbuild onResolve plugin 替代 external 模式：external: ['@openlearn/*'] 通配符不匹配无 / 的裸 specifier（如 @openlearn/core:ITest），改用 onResolve 回调精确控制"
  - "evaluateAndActivateEsm 完整复制安全包装器逻辑：虽然代码有重复，但计划要求 vm 路径完全不变，ESM 分支独立以便未来 Phase 8 移除 vm 路径时一步删除"
  - "esm-loader 核心文件（esm-loader.ts, node-loader.ts, browser-loader.ts, manifest-schema.ts, errors.ts, index.ts）在 worktree 中重建以确保 install-utils.ts 和 plugin-runtime/index.ts 能正常导入"
deviations:
  - type: "auto-fix"
    rule: "Rule 1 - Bug"
    description: "esbuild external: ['@openlearn/*'] 通配符不匹配裸 specifier 格式的 Token import（如 @openlearn/core:ITest），且测试中未使用的 import 被 tree-shaking 移除。修复：使用 esbuild onResolve plugin 精确控制 + 测试代码确保 import 被实际引用"
    files: ["packages/core/esm-loader/install-utils.ts", "packages/core/esm-loader/__tests__/bundle.test.ts"]
    commits: ["7417535"]
  - type: "auto-fix"
    rule: "Rule 3 - Blocking Issue"
    description: "worktree 缺少 vitest/zod/jsdom 依赖和 vitest.config.ts，无法运行测试。修复：同步 package.json 并安装依赖，创建 vitest.config.ts"
    files: ["package.json", "pnpm-lock.yaml", "vitest.config.ts"]
    commits: ["173ad11"]
  - type: "auto-fix"
    rule: "Rule 3 - Blocking Issue"
    description: "esm-loader 核心文件（esm-loader.ts, node-loader.ts, browser-loader.ts, manifest-schema.ts, errors.ts, index.ts）在 worktree 中不存在，install-utils.ts 导入失败。修复：从 git history 重建所有文件"
    files: ["packages/core/esm-loader/esm-loader.ts", "packages/core/esm-loader/node-loader.ts", "packages/core/esm-loader/browser-loader.ts", "packages/core/esm-loader/manifest-schema.ts", "packages/core/esm-loader/errors.ts", "packages/core/esm-loader/index.ts"]
    commits: ["22a16eb"]
metrics:
  total_tests: 8
  passed_tests: 8
  failed_tests: 0
  type_errors: 0
---

# Phase 3 Plan 4: EsmLoader 集成 — esbuild 预打包 + PluginRuntime ESM 分支 + Kernel DI + DB Schema

将 EsmLoader 子系统完整集成到 PluginRuntime、Kernel 和数据库层，实现 esbuild 多文件预打包、ZIP 包解压与校验、DB schema 扩展、PluginRuntime ESM 加载分支，以及 Kernel DI 注入。

## 执行摘要

- **Task 1**: 创建 install-utils.ts（`bundlePlugin` + `validateAndBundleZip` + esbuild onResolve plugin）
- **Task 2**: 修改 PluginRuntime（ESM 分支 + ZIP 安装）、Kernel（NodeEsmLoader DI）、DB schema（ALTER TABLE）
- **Task 3**: 创建 bundle.test.ts（8 个集成测试全部 GREEN）+ sample.zip fixture

## 关键决策

1. **esbuild onResolve plugin 替代 external 通配符**：`external: ['@openlearn/*']` 不匹配无 `/` 分隔符的裸 specifier（如 `@openlearn/core:ITest`），改用 `onResolve` 回调精确控制每个导入路径的 external/拒绝行为。

2. **evaluateAndActivateEsm 完整复制安全包装器**：虽然与 vm 路径有大量重复代码，但计划要求现有 vm 路径完全不变，ESM 分支独立以确保 Phase 8 移除 vm 路径时可一步删除。

3. **worktree 中重建 esm-loader 核心文件**：install-utils.ts 和 plugin-runtime 需要导入 esm-loader/*，但 worktree 初始状态缺少这些文件。从 git history 重建全部 7 个核心文件。

## 产出文件

| 文件 | 状态 | 关键内容 |
|------|------|----------|
| `install-utils.ts` | 新建 | bundlePlugin(bundle+onResolve)、validateAndBundleZip(ZIP bomb+路径穿越+zod+esbuild) |
| `plugin-runtime/index.ts` | 修改 | esmLoader 构造函数注入、evaluateAndActivateEsm、installPluginFromZip、loadFromDB loader_version 分支 |
| `kernel/index.ts` | 修改 | NodeEsmLoader 创建、PluginRuntime 构造函数传入 esmLoader |
| `db/index.ts` | 修改 | plugins 表新增 loader_version TEXT DEFAULT 'vm' 和 zip_package BLOB |
| `bundle.test.ts` | 新建 | 8 个集成测试：打包/Token保留/拒绝非法导入/ZIP解压/manifest缺失/路径穿越/E2E/schema |
| `sample.zip` | 新建 | 合法多文件 ZIP fixture（manifest.json + index.js + utils.js） |

## 测试结果

```
npx vitest run packages/core/esm-loader/__tests__/bundle.test.ts --reporter=verbose
PASS (8) FAIL (0)
```

全部 8 个集成测试通过，覆盖：esbuild 打包、Token import 保留、非法导入拒绝、ZIP 解压与校验、E2E 端到端加载、路径穿越防护。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] esbuild external 通配符不匹配 + tree-shaking 移除未使用 import**
- **Found during:** Task 3 (GREEN phase test execution)
- **Issue:** `external: ['@openlearn/*']` 不匹配无 `/` 的裸 specifier（如 `@openlearn/core:ITest`），导致 Token import 被内联而非保留为 external。同时测试代码中 import 语句因未被使用而被 esbuild tree-shaking 移除
- **Fix:** 
  - install-utils.ts: 使用 esbuild onResolve plugin 精确控制，`@openlearn` 开头的导入标记为 external，其他裸 specifier 返回 errors 拒绝
  - bundle.test.ts: 确保 Test 2 和 Test 3 的 import 在代码中被实际引用
- **Files modified:** `install-utils.ts`, `bundle.test.ts`
- **Commit:** 7417535

**2. [Rule 3 - Blocking Issue] worktree 缺少测试依赖和配置**
- **Found during:** Task 3 (vitest run)
- **Issue:** worktree 的 package.json 缺少 vitest, zod, jsdom 依赖，缺少 vitest.config.ts 配置文件。vitest 命令不可用
- **Fix:** 同步 package.json 从主仓库添加依赖，创建 vitest.config.ts
- **Files modified:** `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`
- **Commit:** 173ad11

**3. [Rule 3 - Blocking Issue] esm-loader 核心文件在 worktree 中缺失**
- **Found during:** Task 1 (install-utils.ts import resolution)
- **Issue:** esm-loader/*.ts 文件（esm-loader.ts, node-loader.ts, browser-loader.ts, manifest-schema.ts, errors.ts, index.ts）在 worktree 中不存在，install-utils.ts 和后续修改文件无法导入
- **Fix:** 从 git history（commit 8b4d882, 507b3e9）重建全部 7 个核心文件
- **Files modified:** 全部 `packages/core/esm-loader/*.ts`（除 install-utils.ts 和测试文件）
- **Commit:** 22a16eb

## Known Stubs

- `extractManifestFromBundle()` 保留为备用接口，当前 `throw new Error('not yet implemented')` — 由 validateAndBundleZip 一步完成，无需单独实现

## Commits

| Hash | Message |
|------|---------|
| 22a16eb | feat(03-esm): 创建 install-utils.ts — esbuild 打包 + jszip 解压 + manifest 校验 + ZIP bomb 防护 |
| c50f14d | feat(03-esm): 集成 ESM 加载分支 — PluginRuntime + Kernel + DB schema |
| 173ad11 | test(03-esm): 添加 bundle+ZIP 集成测试 (RED) + vitest 配置 |
| 7417535 | feat(03-esm): 修复 esbuild 打包逻辑 — Token import 保留 + 非法导入拒绝 (GREEN) |
