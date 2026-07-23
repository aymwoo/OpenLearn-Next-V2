# OpenLearn Execution Unit Specifications (执行单元说明书)

## 1. Executive Summary (概述)

为了确保零风险推进，实现任务被严格解耦为 5 个独立的 Execution Unit (EU)。每一个 EU 均支持独立开发、测试、提交与回滚。

---

## 2. Execution Units Details (执行单元明细)

### EU-01: Bootstrap Types & Constants
- **目标**: 新建 `packages/core/bootstrap/types/index.ts`。
- **输入**: 接口契约定义。
- **输出**: `BootstrapContext`, `BootstrapConfig`, `StartupStage` 强类型。
- **独立测试**: TypeScript 类型检查 (`pnpm lint`)。

### EU-02: Immutable BootstrapContext
- **目标**: 新建 `packages/core/bootstrap/context/bootstrap-context.ts`。
- **输入**: `BootstrapConfig` 配置项。
- **输出**: 只读环境变量、阶段状态跟踪与 Debug 日志包装。
- **独立测试**: 实例化与配置读取断言。

### EU-03: 6-Stage BootstrapPipeline
- **目标**: 新建 `packages/core/bootstrap/pipeline/bootstrap-pipeline.ts`。
- **输入**: `BootstrapContext` 与预定义 Stages。
- **输出**: 顺序管道执行器，包含阶段异常捕获与 Resource Clean 清理钩子。
- **独立测试**: 阶段按序调用模拟测试。

### EU-04: PlatformBuilder & Unit Test Suite
- **目标**: 新建 `platform-builder.ts` 及 `packages/core/__tests__/bootstrap.test.ts`。
- **输入**: Fluent 链式配置。
- **输出**: `PlatformKernel` 实例与 100% 覆盖率单元测试。
- **独立测试**: `pnpm vitest run packages/core/__tests__/bootstrap.test.ts`。

### EU-05: Server Wiring & Startup Adapter
- **目标**: 重构 `server.ts` 接入 `PlatformBuilder.create().buildAndStart()`。
- **输入**: Express 及 Socket.IO 实例。
- **输出**: 运行期全平台统一启动入口。
- **独立测试**: 全量 11 大核心引擎集成测试。
