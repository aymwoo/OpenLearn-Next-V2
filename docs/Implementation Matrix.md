# OpenLearn Implementation Matrix (代码变动与边界矩阵)

## 1. Executive Summary (概述)

本矩阵归纳了 Composition Root 涉及的所有变动文件与严格禁止修改的边界。

---

## 2. Code Mapping Matrix (代码映射矩阵)

| 文件 (File) | 模块 (Module) | 变更原因 (Reason) | 变更范围 (Change Scope) | 风险 (Risk) | 优先级 (Priority) |
|---|---|---|---|---|---|
| `packages/core/bootstrap/types/index.ts` | Bootstrap | 声明上下文与管道类型 | 新增 (NEW ~60行) | Zero | P0 |
| `packages/core/bootstrap/context/bootstrap-context.ts` | Bootstrap | 实现只读启动上下文 | 新增 (NEW ~70行) | Zero | P0 |
| `packages/core/bootstrap/pipeline/bootstrap-pipeline.ts` | Bootstrap | 实现 6 阶启动管道 | 新增 (NEW ~110行) | Low | P0 |
| `packages/core/bootstrap/builder/platform-builder.ts` | Bootstrap | 实现 Fluent API 构建器 | 新增 (NEW ~90行) | Low | P0 |
| `packages/core/bootstrap/index.ts` | Bootstrap | 子系统 Barrel 导出 | 新增 (NEW ~15行) | Zero | P0 |
| `packages/core/__tests__/bootstrap.test.ts` | Tests | 单元测试套件 | 新增 (NEW ~100行) | Zero | P0 |
| `server.ts` | Server | 接入 PlatformBuilder 入口 | 修改 (MODIFY ~25行) | Low | P1 |

---

## 3. Forbidden Modification Boundaries (严格禁止修改的文件与模块)

以下核心业务引擎与接口文件在 Composition Root 实施期间**严禁修改**：
- `packages/core/lesson-engine/**`
- `packages/core/presence-engine/**`
- `packages/core/collaboration-engine/**`
- `packages/core/analytics-engine/**`
- `packages/core/ai/**` & `packages/core/ai-capability/**`
- `packages/plugin-sdk/**`
- `packages/plugins/**`
