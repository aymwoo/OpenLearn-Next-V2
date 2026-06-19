---
phase: 11-loader-bridge
plan: 03
type: summary
status: completed
completed_at: 2026-06-20
wave: 2
---

# Plan 11-03 — 动态加载器与宿主桥接 (完成)

## 执行摘要

实现了 MFE 加载器核心组件体系：UI fallback 组件（loading spinner + error card）、Error Boundary（错误边界）、MfeLoaderCore（容器渲染逻辑）以及 MfeLoader（对外组合组件）。所有 20 个 MFE 测试全部通过。

## 交付物

| 文件 | 任务 | 描述 |
|------|------|------|
| `src/components/MfeLoadingFallback.tsx` | Task 1 | 居中 spinner 加载状态组件，Loader2 animate-spin，role="status"，lang 属性支持 |
| `src/components/MfeErrorFallback.tsx` | Task 1 | 错误 UI 组件，XCircle 图标 + heading（extensionLoadError）+ body + retry/dismiss 按钮，role="alertdialog" |
| `src/mfe/MfeErrorBoundary.tsx` | Task 2 | 类组件错误边界，getDerivedStateFromError + componentDidCatch，handleRetry/handleDismiss 重置错误状态 |
| `src/mfe/MfeLoaderCore.tsx` | Task 3 | 容器渲染核心组件，createRoot + loadRemote + 状态机 + 超时处理 + 样式注入/移除 + leak detector + 向后兼容包装 |
| `src/mfe/MfeLoader.tsx` | Task 3 | 公开组合组件，MfeErrorBoundary 隔离 + MfeConfigProvider 配置 + mfeRef 转发 |
| `src/mfe/index.ts` | Task 3 | 桶导出文件，统一导出所有公共 MFE API |

## 关键设计决策

### D-04: createRoot 容器渲染
MfeLoaderCore 通过 `createRoot` 在独立容器中渲染远程组件，与主 React 树隔离，避免 reconciler 冲突。

### D-12: 向后兼容包装
`wrapReactComponent()` 将默认 React 组件导出自动包装为 `{ mount, unmount, update, styles }` 生命周期接口。

### D-14: 逐实例 ErrorBoundary
每个 MfeLoader 实例都有自己的 MfeErrorBoundary，一个远程组件崩溃不影响其他远程组件或宿主应用。

### D-22: 卸载超时强制销毁
`Promise.race([unmount, 5s timeout])` 确保即使远程 unmount() 挂起，清理逻辑仍会执行。

### D-18: 加载超时
默认 30 秒加载超时，超时后显示带 "(Loading timed out)" / "（加载超时）" 提示的错误 UI。

## 设计模式跟随

- **ErrorBoundary 类组件**: 完全遵循 `src/plugin-host/extension-point-renderer.tsx` 的 ExtensionErrorBoundary 模式
- **Loading spinner**: 基于 ExtensionPointRenderer 的 LoadingSkeleton 模式，使用 Loader2 + animate-spin
- **错误 fallback**: 基于 inline error fallback 模式扩展，增加 retry/dismiss 按钮交互
- **Context Provider**: 遵循 `plugin-host-context.tsx` 的 createContext + useContext + null guard 模式

## 测试结果

- `src/mfe/__tests__/` — 20 passed (4 test files)
  - lifecycle.test.ts: 6 passed (type contract验证)
  - memory.test.ts: 4 passed (内存管理验证)
  - MfeErrorBoundary.test.tsx: 7 passed (错误边界验证)
  - MfeLoader.test.tsx: 3 passed (组合组件验证)
- TypeScript: 无新增类型错误 (仅 pre-existing syntax-error.js fixture 错误)

## 威胁模型覆盖

- T-11-05: 远程模块加载仅限于 SQLite 注册的 name 解析，不接受任意 URL
- T-11-06: 逐实例 ErrorBoundary 隔离渲染崩溃
- T-11-07: 5 秒卸载超时强制清理
- T-11-08: 错误信息仅显示通用消息，不暴露堆栈跟踪
- T-11-09: 样式注入通过注册的远程控制

## 与后续计划的依赖

- **Phase 12**: MfeContext 桥接 — 当前 `createMfeApp({})` 传入空对象，Phase 12 将注入完整的 eventBus/serviceRegistry/store
- **Phase 13**: 将 MfeLoader 集成到 App.tsx 中替换现有视图
