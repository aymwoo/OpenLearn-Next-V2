---
phase: 04-pluginhost
plan: 03
subsystem: plugin-host
tags: [esm-loader, plugin-lifecycle, state-machine, resource-tracker, di, sqlite, vitest, tdd]

# Dependency graph
requires:
  - phase: 04-pluginhost
    plan: 02
    provides: PluginHost 骨架（构造函数、状态机、内省方法）
  - phase: 03-esm
    plan: 04
    provides: EsmLoader, manifest-schema, install-utils（validateAndBundleZip）
provides:
  - PluginHost 完整生命周期方法（install/activate/deactivate/uninstall/installFromZip/restore）
  - Promise.race 超时保护的激活/停用流程
  - 失败回滚（ResourceTracker.disposeAll + capabilityService.revokeAll）
  - 15 个集成测试覆盖完整生命周期
affects: [04-pluginhost-04, 05-proxy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DISPOSEALL_FAIL_CLOSED: deactivate finally 块强制清理，保证安全"
    - "PROMISE_RACE_TIMEOUT: 5s 超时防止插件挂起阻塞主机"
    - "STATE_AUDIT_TRAIL: validateTransition 查找表验证所有状态转换"

key-files:
  created:
    - packages/core/plugin-host/__tests__/plugin-host.test.ts
  modified:
    - packages/core/plugin-host/index.ts

key-decisions:
  - "installPlugin 不自动激活：安装与激活为独立步骤，调用方需显式 activatePlugin()"
  - "deactivatePlugin 对非 ACTIVE 状态静默返回：避免对未激活插件抛异常增加调用方负担"
  - "uninstallPlugin 从 INSTALLED 状态也可直接卸载：无需先激活再停用再卸载"
  - "能力授予与撤销通过 ICapabilityServiceToken 的 async resolve 获取：保持 DI 架构一致性"

patterns-established:
  - "PluginHost 使用 Sqlite 参数化查询（db.prepare）防止注入"
  - "最后清理模式：finally 块确保 deactivate 后资源始终释放"
  - "错误隔离：单个插件激活失败不影响其他插件（restoreActivePlugins 循环中 catch）"

requirements-completed: [PLUG-05]

# Metrics
duration: 6min
completed: 2026-06-18
---

# Phase 04 Plan 03: PluginHost 完整生命周期方法

**PluginHost 6 个生命周期方法 + 15 个集成测试，Promise.race 超时保护 + ResourceTracker 回滚，全部 green**

## Performance

- **Duration:** 6min
- **Started:** 2026-06-18T12:29:14Z
- **Completed:** 2026-06-18T12:34:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 实现 6 个生命周期方法：installPlugin、activatePlugin、deactivatePlugin、uninstallPlugin、installPluginFromZip、restoreActivePlugins
- Promise.race 5s 超时机制应用于 activate 和 deactivate 路径
- activate 失败回滚：状态 → ERROR + ResourceTracker.disposeAll + capabilityService.revokeAll
- deactivate 强制清理：finally 块执行 disposeAll + revokeAll，deactivate 错误不重新抛出
- 15 个集成测试全部 green，覆盖完整生命周期、错误隔离、超时处理

## Task Commits

Each task was committed atomically:

1. **Task 1: 实现 PluginHost 生命周期方法** - `17888f2` (feat)
2. **Task 2: 编写 plugin-host.test.ts** - `8c3b4fe` (test, RED) + `f9b09be` (feat, GREEN)

**Plan metadata:** (will be committed after summary)

## Files Created/Modified
- `packages/core/plugin-host/index.ts` - PluginHost 类扩展至 642 行，6 个公共生命周期方法 + 2 个私有辅助方法
- `packages/core/plugin-host/__tests__/plugin-host.test.ts` - 15 个集成测试，使用内存 SQLite + mock EsmLoader

## Decisions Made
- installPlugin 不自动激活，安装与激活为独立步骤 — 调用方需显式调用 activatePlugin()
- deactivatePlugin 对非 ACTIVE 状态静默返回 — 避免对未激活插件抛异常增加调用方负担
- uninstallPlugin 从 INSTALLED 状态也可直接卸载 — 无需先激活再停用再卸载
- 能力授予与撤销通过 ICapabilityServiceToken 的 async resolve 获取 — 保持 DI 架构一致性

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 状态机缺少 INSTALLED → UNINSTALLED 转换**
- **Found during:** Task 2 (uninstallPlugin 在已安装但未激活的插件上)
- **Issue:** VALID_TRANSITIONS 表仅允许 INACTIVE/ERROR → UNINSTALLED，INSTALLED 插件无法直接卸载
- **Fix:** 在 VALID_TRANSITIONS.INSTALLED 数组中增加 UNINSTALLED 目标
- **Files modified:** packages/core/plugin-host/index.ts
- **Verification:** Test 9 通过
- **Committed in:** f9b09be

**2. [Rule 1 - Bug] deactivatePlugin 对 INSTALLED 状态抛出 IllegalStateTransitionError**
- **Found during:** Task 2 (deactivatePlugin 在未激活插件上)
- **Issue:** deactivatePlugin 仅跳过 UNINSTALLED 状态，INSTALLED 插件被验证为非法转换
- **Fix:** deactivatePlugin 增加 `currentState !== PluginState.ACTIVE` 判断，所有非 ACTIVE 状态静默返回
- **Files modified:** packages/core/plugin-host/index.ts
- **Verification:** Test 5 通过
- **Committed in:** f9b09be

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** 两处状态机边界条件遗漏，修复后测试全部通过。无架构影响。

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PluginHost 完整生命周期方法已就绪，可被 Plan 04（PluginRuntime 集成）调用
- 状态机支持完整的 install → activate → deactivate → uninstall 转换图
- 15 个集成测试覆盖 5 个 ROADMAP 成功标准（SC-1 到 SC-5）
- 已知：interfaces.test.ts 5 个测试预存失败（kernelContainer 初始化问题，与本次变更无关）
