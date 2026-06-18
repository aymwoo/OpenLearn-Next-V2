---
phase: 01-token-di
plan: 02
subsystem: DI 容器
tags: [service-registry, dependency-injection, kahn-toposort, unit-tests]
requires:
  - 01-01 (Token, errors, types, vitest infrastructure)
provides:
  - ServiceRegistry 完整生命周期容器
  - register / resolve / unregister / registerOrReplace
  - Kahn 拓扑排序 + 循环依赖检测
  - 内省 API: list / has / dependencies
affects:
  - packages/core/di/service-registry.ts
  - packages/core/di/__tests__/service-registry.test.ts
tech-stack:
  added:
    - vitest 4.1.9 (devDependency, 因 worktree 隔离需重新安装)
  patterns:
    - JupyterLab Token DI 模式 (手写实现，零外部依赖)
    - Kahn BFS 拓扑排序算法 (O(V+E))
    - Set<string> 依赖图存储 (防重复边)
    - named Error 子类层次结构 (fail-fast)
key-files:
  created:
    - packages/core/di/service-registry.ts (294 行)
    - packages/core/di/__tests__/service-registry.test.ts (17 个测试用例)
decisions:
  - Kahn 算法实现拓扑排序和循环检测 (Claude's discretion: 选择 Kahn vs DFS)
  - topologicalOrder 作为验证辅助方法，不在 resolve 时调用 (遵循 D-06 注册时检查)
  - depGraph 使用 Set<string> 存储 requires/dependents (遵循 RESEARCH.md Pitfall 2 防重复边)
metrics:
  duration: ~15min
  completed-date: 2026-06-18
---

# Phase 1 Plan 2: ServiceRegistry 依赖注入容器核心 摘要

**一句话：** 实现基于 Kahn 拓扑排序算法的手写 DI 容器核心——register/resolve/unregister/registerOrReplace 完整生命周期，包含循环依赖检测和内省 API，通过 34 个单元测试验证

## 目标

实现 ServiceRegistry 依赖注入容器核心——包含 register/resolve/unregister/registerOrReplace 完整生命周期、基于 Kahn 算法的拓扑排序依赖解析、循环依赖检测、以及内省 API。

## 完成情况

所有 2 个任务已完成。核心产出：

1. **service-registry.ts** — 294 行 ServiceRegistry 类，包含：
   - `register()`: 注册服务实例，验证重复和缺失依赖
   - `resolve()`: 通过 Token 解析已注册服务
   - `unregister()`: 注销服务（检查依赖方、清理双向边）
   - `registerOrReplace()`: 原子覆盖旧实例
   - `list()` / `has()` / `dependencies()`: 内省 API
   - `topologicalOrder()`: Kahn BFS 拓扑排序（循环检测验证辅助）

2. **service-registry.test.ts** — 17 个测试用例，覆盖：
   - SC-2: 基本 register/resolve
   - SC-3: 链式依赖解析 (A→B→C)
   - SC-4: 循环依赖检测 (直接 A↔B 和间接 A→B→C→A)
   - SC-5: unregister + resolve 抛出 "No provider"
   - D-06: 注册时依赖检查 (MissingDependencyError)
   - D-08: 重复注册 + registerOrReplace
   - D-09: 级联注销阻止 (HasDependentError)
   - D-10: 内省 API (list/has/dependencies)
   - D-14: optional 依赖预留

## Commits

| Hash | Type | Message |
|------|------|---------|
| 33109a8 | test | 添加 ServiceRegistry 失败测试 (RED 阶段) + vitest 4.1.9 安装 |
| ed43ae0 | feat | 实现 ServiceRegistry DI 容器核心 |
| 8cb0849 | test | 增强测试断言，验证错误信息 Token name |

## 验证结果

- `pnpm vitest run packages/core/di/`: PASS (34/34)
- TypeScript 类型检查: DI 文件无错误

## 偏离计划

### Auto-fixed Issues

无 — 计划执行完全按计划进行。

### 依赖安装

- vitest 4.1.9: 因 worktree 隔离，需从官方 npm registry 重新安装（npmmirror 镜像缺少 @vitest/pretty-format@4.1.9）

## Decisions Made

1. **Kahn 算法实现:** 选择 Kahn BFS 算法 (vs DFS) — 更清晰的错误信息，O(V+E) 线性时间
2. **topologicalOrder 定位:** 作为验证辅助方法，不在 resolve 时调用 — 遵循 D-06 注册时检查
3. **依赖图数据结构:** 使用 Set<string> 存储 requires/dependents — 防重复边导致虚假循环检测
4. **registerOrReplace 策略:** 先 removeEdges 清理旧边 → 删除旧条目 → register 新实例

## Known Stubs

无 — ServiceRegistry 是完整实现，无 TODO/FIXME/placeholder

## Self-Check: PASSED

- packages/core/di/service-registry.ts: 已创建，294 行
- packages/core/di/__tests__/service-registry.test.ts: 已创建，17 个测试
- commit 33109a8: RED 阶段测试
- commit ed43ae0: GREEN 阶段实现
- commit 8cb0849: 增强测试断言
- 测试通过: 34/34 (17 token + 17 service-registry)
