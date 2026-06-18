---
phase: 04-pluginhost
plan: 02
subsystem: plugin-host
tags: [context-builder, plugin-host, safety-wrapper]
requires: [04-01]
provides: [PluginContext builder, PluginHost class skeleton]
affects: [packages/core/plugin-host/]
tech-stack:
  added: []
  patterns:
    - "createSafeFunction — 原型链切断 + constructor 阻止"
    - "ServiceRegistry.resolve(Token) — DI 驱动的服务包装"
    - "ResourceTracker.track() — 自动资源清理注册"
    - "VALID_TRANSITIONS 查找表 — 插件状态机验证"
key-files:
  created:
    - packages/core/plugin-host/context-builder.ts
    - packages/core/plugin-host/index.ts
    - packages/core/plugin-host/__tests__/context-builder.test.ts
  modified: []
decisions:
  - "直接从 PluginRuntime.evaluateAndActivateEsm() 迁移 wrapped* 包装器代码，不重新实现"
  - "每个 IService 的 register/subscribe 方法通过 ResourceTracker.track() 注册 dispose"
  - "wrapStorage 通过 db 参数而非 storageService 的内部实现操作 plugin_storage 表"
  - "wrapAI 简化为纯代理 — Phase 2 AIService 已包含 AI 提供者逻辑"
metrics:
  duration: ~5min
  completed_date: "2026-06-18"
---

# Phase 04 Plan 02: PluginContext 构建器与 PluginHost 骨架

**一阶段完成：** 将 PluginRuntime 中的 wrapped* 安全包装器代码迁移到 DI 驱动的 context-builder.ts，并创建 PluginHost 类骨架

## 执行摘要

创建了三个文件：
1. **context-builder.ts**（~418 行）— 7 个 IService 包装函数 + buildContext() 入口函数 + createSafeFunction
2. **index.ts**（~126 行）— PluginHost 类骨架，包含构造函数、状态机、内省方法
3. **context-builder.test.ts**（~324 行）— 8 个单元测试，全部通过

## 任务完成

| 任务 | 名称 | 提交 | 文件 |
|------|------|------|------|
| 1 | context-builder.ts 实现 — wrapped* 代码迁移 | 4d91472 | context-builder.ts |
| 2 | PluginHost 类骨架（index.ts） | d539061 | index.ts |
| 3 | context-builder 测试（TDD — RED+GREEN） | 052f978 | __tests__/context-builder.test.ts |

## 偏离计划

无 — 计划精确执行。

## 测试结果

```
Test Files  1 passed (1) — context-builder.test.ts
Tests    8 passed (8)    — 全部绿色

全回归：
Test Files  10 passed | 1 failed (11)
Tests    95 passed | 5 failed (100)

5 个预存在失败：packages/core/di/__tests__/interfaces.test.ts（kernel.serviceRegistry 未定义）
→ 已知 Phase 2 问题，与本次修改无关
```

## Known Stubs

无 — context-builder.ts 是完整实现，PluginHost 骨架仅包含构造函数和内省方法（生命周期方法由 Plans 03-04 构建）。

## Threat Flags

无新增威胁面 — context-builder.ts 中的安全包装严格从 PluginRuntime 的现有安全代码迁移而来。

## Self-Check: PASSED

- [x] packages/core/plugin-host/context-builder.ts 存在
- [x] packages/core/plugin-host/index.ts 存在
- [x] packages/core/plugin-host/__tests__/context-builder.test.ts 存在
- [x] 提交 4d91472 存在
- [x] 提交 d539061 存在
- [x] 提交 052f978 存在
- [x] 所有 8 个测试通过
