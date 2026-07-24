# OpenLearn Git Commit Plan (Git 提交原子化计划)

## 1. Executive Summary (概述)

为了保证代码提交的清晰度与可追溯性，Composition Root 实施拆分为 **4 个原子化 Git Commit**。每个 Commit 均必须保证独立的逻辑完整性与 100% 测试通过。

---

## 2. Atomic Commit Plan (提交步骤)

### Commit 1: `feat(bootstrap): add Composition Root types and BootstrapContext`
- **内容**: 创建 `packages/core/bootstrap/types/index.ts` 及 `bootstrap-context.ts`。
- **验证**: `pnpm lint` 校验无误。

### Commit 2: `feat(bootstrap): implement BootstrapPipeline and 6-stage lifecycle executor`
- **内容**: 创建 `packages/core/bootstrap/pipeline/bootstrap-pipeline.ts`，涵盖 `StartupStage` 至 `ShutdownStage`。
- **验证**: `pnpm lint` 校验无误。

### Commit 3: `feat(bootstrap): implement PlatformBuilder fluent API and unit tests`
- **内容**: 创建 `platform-builder.ts` 及 `packages/core/__tests__/bootstrap.test.ts`。
- **验证**: 运行 `pnpm vitest run packages/core/__tests__/bootstrap.test.ts` 100% 通过。

### Commit 4: `refactor(server): wire server.ts to PlatformBuilder composition root`
- **内容**: 修改 `server.ts` 切换至 `PlatformBuilder.create().buildAndStart()`。
- **验证**: 运行全量 11 大核心引擎测试套件，确认 100% 通过。
