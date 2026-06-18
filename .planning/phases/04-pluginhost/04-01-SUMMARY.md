---
phase: 04-pluginhost
plan: 01
subsystem: plugin-host
tags: [types, errors, resource-tracker, tests]
requires: []
provides: [types, errors, resource-tracker]
affects: []
tech-stack:
  added: []
  patterns:
    - "Error class hierarchy: extends Error + this.name + [PluginHost] prefix (matching di/errors.ts and esm-loader/errors.ts)"
    - "PluginState state machine enum (7 states per RESEARCH.md D-03)"
    - "ResourceTracker: Map<pluginId, Disposable[]> with try/catch per-dispose and idempotent disposeAll"
key-files:
  created:
    - packages/core/plugin-host/types.ts
    - packages/core/plugin-host/errors.ts
    - packages/core/plugin-host/resource-tracker.ts
    - packages/core/plugin-host/__tests__/resource-tracker.test.ts
  modified:
    - vitest.config.ts
decisions: []
metrics:
  duration: 1m19s
  completed_date: "2026-06-18T12:21:09Z"
---

# Phase 04 Plan 01: PluginHost 基础类型层 + ResourceTracker 总结

建立 PluginHost 子系统的基础类型层：`Disposable` 接口、`PluginState` 状态机枚举、`PluginContext`/`PluginInfo` 类型，错误类层次，以及 `ResourceTracker` 资源追踪器 + 6 个单元测试。

## Tasks Executed

### Task 1: 创建 types.ts、errors.ts、resource-tracker.ts

创建了三个源文件：

**types.ts** — 导出 4 个类型/接口：
- `Disposable` 接口：`{ dispose(): void }`
- `PluginState` 枚举：7 个值（INSTALLED, ACTIVATING, ACTIVE, DEACTIVATING, INACTIVE, ERROR, UNINSTALLED）
- `PluginContext` 接口：含 7 个 IService 属性（commandBus, eventBus, actionRegistry, capability, processManager, storage, ai）+ pluginId + manifest
- `PluginInfo` 接口：id, name, version, state

**errors.ts** — 导出 4 个错误类：
- `PluginHostError` — 基类，`extends Error`，`[PluginHost]` 前缀
- `PluginActivateError` — 携带 `pluginId`，模式与 `EsmActivationError` 一致
- `PluginDeactivateTimeoutError` — 携带 `pluginId` + `timeoutMs`
- `IllegalStateTransitionError` — 携带 `pluginId` + `from`/`to` 状态

**resource-tracker.ts** — 导出 `ResourceTracker` 类：
- `track(pluginId, Disposable)` — 按 pluginId 追加资源
- `disposeAll(pluginId)` — 按插入顺序 dispose 所有资源，每个包裹 try/catch，完成后删除 map entry
- 对已清理的 pluginId 再次调用为无操作（幂等）

**Commit:** `0f7286e`

### Task 2: 编写 resource-tracker.test.ts + 更新 vitest.config.ts (TDD)

**RED commit** (`c924810`): 创建 6 个测试用例：
1. track 追加资源（同一 pluginId 两次 track 后，disposeAll 验证 dispose 各被调 1 次）
2. disposeAll 调用所有已追踪资源的 dispose
3. disposeAll 幂等性（二次调用无副作用）
4. 单个 dispose 失败时继续清理其余资源
5. 不同 pluginId 的资源隔离
6. 不存在的 pluginId 调用 disposeAll 静默返回

**GREEN commit** (`d25277d`): 更新 `vitest.config.ts` 的 include 数组，添加 `'packages/core/plugin-host/__tests__/**/*.test.ts'`

所有 6 个测试通过，完整 vitest 套件中 plugin-host 全部 green。DI 子系统有 5 个预先存在的测试失败（`kernel.serviceRegistry` 为 undefined），与本次任务无关。

**Commits:** `c924810` (test), `d25277d` (config)

## Verification Results

| 检查项 | 状态 |
|--------|------|
| `npx tsc --noEmit` plugin-host 文件 | 通过（0 个 plugin-host 相关错误） |
| ResourceTracker 6 个单元测试 | 6/6 通过 |
| vitest.config.ts 包含 plugin-host | 通过 |
| types.ts 导出 Disposable + PluginState + PluginContext + PluginInfo | 通过 |
| errors.ts 导出 4 个错误类（extends Error + this.name 模式） | 通过 |
| resource-tracker.ts 导出 ResourceTracker（track + disposeAll） | 通过 |

## Deviations from Plan

无 — 计划完全按照预期执行。

## Known Stubs

无 — 所有文件都是完整实现，没有占位符或未连接的数据源。

## Threat Flags

无 — 所有文件在 `<threat_model>` 中已有覆盖，所有威胁为 accept 或 mitigate（resource-tracker.ts 的 DoS 风险已通过 try/catch per-dispose 缓解）。

## Self-Check

### 文件存在性
- [x] `packages/core/plugin-host/types.ts`
- [x] `packages/core/plugin-host/errors.ts`
- [x] `packages/core/plugin-host/resource-tracker.ts`
- [x] `packages/core/plugin-host/__tests__/resource-tracker.test.ts`
- [x] `vitest.config.ts`（已更新）

### 提交存在性
- [x] `0f7286e` — feat(04-pluginhost): 创建基础类型层
- [x] `c924810` — test(04-pluginhost): 添加 ResourceTracker 单元测试（RED）
- [x] `d25277d` — feat(04-pluginhost): 更新 vitest.config.ts include 模式（GREEN）

## Self-Check: PASSED
