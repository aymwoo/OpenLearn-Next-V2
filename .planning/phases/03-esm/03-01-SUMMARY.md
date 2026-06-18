---
phase: 03-esm
plan: 01
subsystem: esm-loader
tags: [esm-loader, abstract-class, plugin-module, error-hierarchy, manifest-schema, zod, tdd]
requires: []
provides:
  - EsmLoader 抽象基类
  - PluginModule 接口
  - EsmLoaderError 错误类层次
  - manifest-schema.ts（zod 运行时校验）
affects:
  - 后续 NodeEsmLoader / BrowserEsmLoader 实现（plan 02）
  - PluginRuntime ESM 分支（plan 03）
  - ZIP 包安装流程（plan 04）
tech-stack:
  added: [zod@4.4.3]
  patterns: [abstract-class-platform-impl, named-error-hierarchy, barrel-exports, it.each-parametrized-test]
key-files:
  created:
    - packages/core/esm-loader/esm-loader.ts
    - packages/core/esm-loader/errors.ts
    - packages/core/esm-loader/manifest-schema.ts
    - packages/core/esm-loader/__tests__/manifest-schema.test.ts
    - packages/core/esm-loader/__tests__/fixtures/manifest-valid.json
    - packages/core/esm-loader/__tests__/fixtures/manifest-invalid.json
  modified:
    - vitest.config.ts
decisions:
  - 使用 zod .parse() 非 safeParse 模式（Pitfall 3 防范 — Zod v4 safeParse Error 继承变更）
  - 错误类遵循 di/errors.ts 精确模式：extends Error + this.name + [Subsystem] 前缀
  - 测试使用 it.each 参数化模式覆盖缺失字段和空字符串场景
metrics:
  duration: 189 seconds
  completed: "2026-06-18T11:38:27Z"
---

# Phase 3 Plan 1: EsmLoader 类型基础设施 + Manifest schema 校验

**一锤定音：** 建立 EsmLoader 子系统的抽象基类、PluginModule 接口、5 个结构化错误类和 zod 运行时 manifest 校验，为 Phase 3 后续 ESM 加载器和 ZIP 包格式提供类型契约和验证基础设施。

## 任务摘要

| 任务 | 名称 | 类型 | 提交 | 状态 |
|------|------|------|------|------|
| 1 | EsmLoader 抽象基类 + PluginModule 接口 + 错误类层次 | auto | dd6666f | 完成 |
| 2 | manifest-schema.ts + 测试 + fixtures + vitest 配置 (TDD) | auto/tdd | f002416 (RED) / f0bcb62 (GREEN) | 完成 |

## 关键产出

### Task 1: EsmLoader 抽象基类 + PluginModule 接口 + 错误类层次

**提交:** dd6666f

**文件:**
- `packages/core/esm-loader/esm-loader.ts` (38 行): 导出 `PluginModule` 接口（支持 default export 和 named export 两种格式）和 `EsmLoader` 抽象类（定义 `load(code: string): Promise<PluginModule>` 契约）
- `packages/core/esm-loader/errors.ts` (87 行): 导出 5 个具名错误类 — `EsmLoaderError`（基类）、`EsmSyntaxError`（携带 line/column）、`EsmModuleNotFoundError`（携带 specifier）、`EsmLoadTimeoutError`（携带 timeoutMs）、`EsmActivationError`（携带 pluginId）

**设计决策:** 错误类遵循 `packages/core/di/errors.ts` 的精确模式 — `extends Error`、构造器中 `super('[EsmLoader] ${message}')`、设置 `this.name = 'ErrorClassName'`、`public readonly` 属性携带上下文。

### Task 2: manifest-schema.ts + 测试 + fixtures (TDD)

**RED 提交:** f002416 — 13 个失败测试 + 2 个 JSON fixture + vitest 配置更新

**GREEN 提交:** f0bcb62 — manifest-schema.ts 实现，13 个测试全部通过

**文件:**
- `packages/core/esm-loader/manifest-schema.ts` (32 行): zod object schema，必需字段 `id/name/version/main`（`min(1)`），可选字段 `requires/optional/capabilitiesProposed`（字符串数组），导出 `Manifest` 类型（`z.infer`），全部中文错误消息
- `packages/core/esm-loader/__tests__/manifest-schema.test.ts` (99 行): 13 个测试用例 — 合法通过 (1)、缺失字段拒绝 (4, it.each)、空字符串拒绝 (4, it.each)、可选字段 filled (1)、空数组可选字段 (1)、类型推导 (1)、fixture 拒绝 (1)
- `packages/core/esm-loader/__tests__/fixtures/manifest-valid.json`: 完整合法 manifest
- `packages/core/esm-loader/__tests__/fixtures/manifest-invalid.json`: 仅含 id，缺少 name/version/main
- `vitest.config.ts`: include 数组新增 `packages/core/esm-loader/__tests__/**/*.test.ts`

**TDD 门控通过:**
- RED: 测试因 `manifest-schema.ts` 不存在而失败 — 符合预期
- GREEN: 13/13 测试通过，npx tsc --noEmit 对 esm-loader 无错误

## 验证结果

| 验证项 | 命令 | 结果 |
|--------|------|------|
| TypeScript 类型检查 | `npx tsc --noEmit` | esm-loader 无类型错误 |
| Manifest schema 测试 | `npx vitest run packages/core/esm-loader/__tests__/manifest-schema.test.ts` | 13/13 通过 |
| 文件行数检查 | `wc -l` | 全部超过最低要求 |

## 偏差说明

### 自动修复项

无 — 计划完全按预期执行。

### 计划外增强

- Task 2 测试中额外添加了 4 个空字符串拒绝测试（`it.each` 覆盖 id/name/version/main 四个字段的空字符串场景），增强了对 `.min(1)` 校验的覆盖
- 测试文件从计划的 ~50 行扩展到 99 行，包含更全面的边界条件测试

## 已知 Stubs

无 — 所有文件均为完整实现，无占位符或 mock 数据。

## 威胁标记

无 — 新增代码均在 `<threat_model>` 覆盖范围内：
- manifest-schema.ts: T-03-03 manifest 内容注入已在 parse() 阶段被 zod 拒绝
- errors.ts: T-03-04 错误消息使用 [EsmLoader] 标签结构化记录，不泄露敏感信息

## 后续依赖

- Plan 02 (node-loader + browser-loader + 测试): 依赖本 plan 的 `EsmLoader` 抽象基类、`PluginModule` 接口和 `EsmLoaderError` 错误类
- Plan 03 (PluginRuntime ESM 分支): 依赖本 plan 所有产物（EsmLoader、错误类、manifest-schema）
- Plan 04 (ZIP 包 + esbuild 集成): 依赖本 plan 的 `manifest-schema.ts` 和 `Manifest` 类型
