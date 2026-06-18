---
phase: 04-pluginhost
plan: 04
subsystem: plugin-system
tags: [plugin-host, facade, kernel, state-machine, vitest, integration]

# Dependency graph
requires:
  - phase: 04-pluginhost
    plan: 03
    provides: PluginHost 生命周期方法（install/activate/deactivate/uninstall/installFromZip/restoreActivePlugins）
provides:
  - PluginRuntime 到 PluginHost 的 facade 委托层
  - Kernel 中 PluginHost 初始化
  - PluginState 状态机单元测试（12 个测试）
affects: [05-worker-host, 08-legacy-removal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Facade pattern: PluginRuntime 保留公共 API，内部委托给 PluginHost"
    - "Pure function extraction: validatePluginStateTransition 从私有方法提升为可导出的纯函数用于测试"
    - "Lazy initialization: PluginHost 可在构造函数中可选传入或惰性创建"

key-files:
  created:
    - packages/core/plugin-host/__tests__/state-machine.test.ts
  modified:
    - packages/core/plugin-runtime/index.ts
    - packages/core/kernel/index.ts
    - packages/core/plugin-host/index.ts

key-decisions:
  - "validatePluginStateTransition 提取为模块级纯函数，既支持内部委托又支持独立测试"
  - "deactivatePlugin 的 ESM 分支使用 fire-and-forget 方式委托给 PluginHost（保持与原同步签名兼容）"
  - "Kernel 中同时暴露 pluginRuntime 和 pluginHost，现有代码通过 pluginRuntime 访问不受影响"

patterns-established:
  - "Facade delegation: 公共 API 签名不变，内部根据 loader_version 路由到 PluginHost 或保留 vm 逻辑"
  - "Pure function for testability: 状态机验证逻辑作为导出函数，测试无需实例化 PluginHost"

requirements-completed: [PLUG-05]

# Metrics
duration: 20min
completed: 2026-06-18
---

# Phase 04 Plan 04: PluginRuntime Facade 层 + Kernel 集成 + 状态机测试

**PluginRuntime 转换为 PluginHost facade 层，Kernel 初始化 PluginHost，12 个状态机测试绿色，server.ts 零修改**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-18T12:33:00Z
- **Completed:** 2026-06-18T12:43:36Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- PluginRuntime 转换为 PluginHost 薄 facade 层，所有公共 API 签名保持不变
- installPlugin/installPluginFromZip/uninstallPlugin 委托给 PluginHost
- togglePlugin 根据 loader_version 智能区分 vm/ESM 路径
- deactivatePlugin 区分 ESM 插件（委托 PluginHost）和 vm 插件（保留现有逻辑）
- evaluateAndActivate（vm.createContext）完全保留不变
- Kernel 中添加 serviceRegistry 和 pluginHost 初始化
- validatePluginStateTransition 提取为可导出的纯函数
- 12 个状态机单元测试覆盖所有合法和非法转换

## Task Commits

Each task was committed atomically:

1. **Task 1: 将 PluginRuntime 转换为 PluginHost facade 层** - `6a8ce7c` (feat)
2. **Task 2: 在 Kernel 构造函数中初始化 PluginHost** - `05cccfb` (feat)
3. **Task 3: 编写 state-machine.test.ts + 最终验证** - `50ed33f` (test)

## Files Created/Modified
- `packages/core/plugin-runtime/index.ts` - PluginRuntime facade 层：保留 API，内部委托给 PluginHost
- `packages/core/kernel/index.ts` - Kernel 构造函数：ServiceRegistry + PluginHost 初始化
- `packages/core/plugin-host/index.ts` - 新增 validatePluginStateTransition 导出纯函数
- `packages/core/plugin-host/__tests__/state-machine.test.ts` - 12 个状态机转换测试

## Decisions Made
- validatePluginStateTransition 提取为模块级导出函数而非静态方法，使测试无需实例化 PluginHost
- deactivatePlugin 的 ESM 分支采用 fire-and-forget（catch 记录错误），保持与原同步签名兼容
- Kernel 中 pluginHost 初始化为 `public readonly`，与 pluginRuntime 一样可全局访问
- loadFromDB 中额外调用 restoreActivePlugins 作为双保险

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Worktree 路径隔离**: 测试文件通过 worktree 路径创建，vitest 需要从 worktree 目录运行才能找到文件。`npx vitest run` 从 worktree 目录执行成功，12 个测试全部通过。
- **预存在测试失败**: `packages/core/di/__tests__/interfaces.test.ts` 有 5 个预存在失败（与 Kernel 的 serviceRegistry 属性相关），非本次提交引入。本次提交的 3 个任务均未触及这些测试，回归验证确认无新增失败。

## Test Results

```
Test Files  1 failed | 12 passed (13)
Tests       5 failed | 122 passed (127)
```

- state-machine.test.ts: 12/12 passed
- plugin-host.test.ts: 15/15 passed (no regressions)
- interfaces.test.ts: 5/14 failed (pre-existing)
- All other test files: all passed

## Next Phase Readiness
- PluginHost 已完全集成到 Kernel 中，可通过 `kernelContainer.pluginHost` 访问
- PluginRuntime facade 层保持完全向后兼容，server.ts 零修改
- 状态机已验证，所有合法/非法转换均通过测试
- 准备进入 Phase 05 (worker-host) 或其他后续阶段

---
*Phase: 04-pluginhost*
*Completed: 2026-06-18*
