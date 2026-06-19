---
phase: 07-hotreload-middleware
created: 2026-06-19
status: planning
depends_on: Phase 6 (complete)
requirements: PLUG-08, PLUG-10
---

# Phase 7: 热重载 + 中间件管道 — Context

## Goal

实现开发模式下插件源码变更后的自动热重载（dispose + re-activate），以及生命周期中间件管道（在 activate/deactivate 等关键节点插入拦截逻辑）。

## Current State

### What exists (inherited from Phases 1-6)

- **PluginHost** (`packages/core/plugin-host/index.ts`): 完整的生命周期管理
  - `installPlugin()` / `activatePlugin()` / `deactivatePlugin()` / `uninstallPlugin()`
  - 状态机: INSTALLED → ACTIVATING → ACTIVE → DEACTIVATING → INACTIVE → UNINSTALLED
  - 支持 inline + worker 双模式 (Phase 5)
  - SemVer 兼容检查 (Phase 6)
  - `pluginStates` Map + `pluginInstances` Map

- **ResourceTracker** (`packages/core/plugin-host/resource-tracker.ts`):
  - `track(pluginId, disposable)` — 按插件追踪资源
  - `disposeAll(pluginId)` — 按插入顺序清理，单个失败不阻塞其余
  - 已被 ContextBuilder 用于追踪命令处理器、事件订阅等

- **CommandBus interceptor** (`packages/core/command-bus/index.ts`):
  - 单拦截器模式: `setInterceptor(fn)` → `execute()` 中调用
  - Kernel 层用于 CapabilityGuard + 高危审批

- **PluginContext** (`packages/core/plugin-host/types.ts`):
  - 7 个 IService + pluginId + manifest

- **Kernel** (`packages/core/kernel/index.ts`):
  - 全局单例，组装所有子系统
  - 7 个 IService 已注册到 ServiceRegistry

### What's missing for Phase 7

1. **File watching**: 无 chokidar 或任何文件监听依赖
2. **Hot reload**: 无 reload 方法，PluginHost 只有一次性的 install→activate→deactivate 流程
3. **Middleware pipeline**: 无中间件抽象，CommandBus 只有一个 interceptor slot
4. **Dev mode flag**: 无 `NODE_ENV=development` 或类似的环境检测

### Plugin source storage

插件源码存储在 SQLite `plugins` 表的 `source_code` 列（TEXT）。热重载需要：
- 监听磁盘上的插件源文件目录（`plugins/` 目录）
- 或通过 API 触发 reload（`plugin.reload` 命令）

参考设计：开发模式下，`plugins/` 目录中的 `.ts/.js` 文件被监听。文件变更 → 读取新源码 → 调用 `PluginHost.reloadPlugin(pluginId, newSourceCode)`。

## Requirements Breakdown

### PLUG-08: 热重载

| # | Criterion |
|---|-----------|
| 1 | 开发模式下，修改 `plugins/` 目录中插件的源码文件后，插件自动 deactivate 旧版本并 activate 新版本 |
| 2 | 原子策略：新版本 activate 成功后才停用旧版本；失败则保留旧版本运行并报告 |
| 3 | 热重载时旧插件副作用被 `dispose` 钩子上报的副作用追踪器自动清理 |
| 4 | 连续热重载 10 次无内存/CPU 增长 |

### PLUG-10: 中间件管道

| # | Criterion |
|---|-----------|
| 1 | 中间件可在插件生命周期关键节点注册拦截函数（激活前/后、停用前/后、命令执行前/后） |
| 2 | 洋葱模型：多个中间件按注册顺序依次执行，每个中间件可决定是否调用下一个 |

## Target Architecture

### Hot Reload Flow

```
文件变更 (chokidar)
  → debounce (300ms)
  → HotReloadController.detect(pluginId, filePath)
  → PluginHost.reloadPlugin(pluginId, newSourceCode)
    → extractManifest(newSourceCode)
    → activateNewVersion(pluginId, newSourceCode)
      → ESM load → activate(ctx) → 成功？
    → [成功] deactivateOldVersion(pluginId) → ResourceTracker.disposeAll(pluginId)
    → [失败] 保留旧版本, 报告错误, 不做任何清理
```

### Middleware Pipeline (Onion Model)

```
beforeActivate → activate() → afterActivate
beforeDeactivate → deactivate() → afterDeactivate
beforeCommand → command.execute() → afterCommand

每个 hook point 有中间件链:
  middleware1(ctx, next) → middleware2(ctx, next) → actual work
    ← middleware1 ← middleware2 ← result
```

## File Plan

### New files
- `packages/core/plugin-host/hot-reload.ts` — HotReloadController + FileWatcher
- `packages/core/plugin-host/middleware.ts` — Middleware 类型 + compose 函数
- `packages/core/plugin-host/__tests__/hot-reload.test.ts`
- `packages/core/plugin-host/__tests__/middleware.test.ts`

### Modified files
- `packages/core/plugin-host/index.ts` — 添加 reloadPlugin() + middleware 注册
- `packages/core/plugin-host/types.ts` — 添加 Middleware, MiddlewareContext, LifecyclePhase, HotReloadEvent 类型
- `packages/core/plugin-host/errors.ts` — 添加 HotReloadError, HotReloadActivationError, MiddlewareError
- `packages/core/plugin-host/resource-tracker.ts` — 添加 snapshot(pluginId) + reap(pluginId, disposables) 方法
- `packages/core/command-bus/index.ts` — 添加 setCommandMiddleware() + execute() 中集成 beforeCommand/afterCommand
- `packages/core/kernel/index.ts` — 集成 HotReloadController (dev 模式) + command middleware wiring
- `package.json` — 添加 chokidar 依赖

## Dependencies to Add

- `chokidar` — 跨平台文件监听（Node.js 端）
- 可选: `chokidar` 已在 devDependencies 中？需检查

## Edge Cases & Risks

1. **并发 reload**: 同一插件短时间内多次文件变更 → debounce 合并
2. **Worker 模式 reload**: Worker terminate + recreate，确保 RPC 重连
3. **中间件异常隔离**: 中间件抛异常不应阻止生命周期继续，但应记录
4. **中间件注册时机**: 必须在插件 activate 之前注册，否则对已激活插件不生效
5. **生产模式**: 热重载仅在 dev 模式启用，生产模式完全禁用
6. **插件未在磁盘**: 直接通过 API 安装的插件（无磁盘文件）不支持热重载

## Test Strategy

- 单元测试: FileWatcher mock, Middleware compose 函数, reloadPlugin 状态转换
- 集成测试: 完整 reload 循环（install → edit → reload），中间件洋葱执行顺序
- 压力测试: 10 次连续 reload 验证无泄漏
- 故障测试: 新版本 activate 失败 → 旧版本保留 + 错误报告
