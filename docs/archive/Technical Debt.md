# OpenLearn Technical Debt Log (确认的技术债务日志)

## 1. Executive Summary (概述)

本报告记录 Platform Kernel v1.0 评审中确认为真实的次要技术债务项目。所有项目均包含清晰的影响分析、优先级与建议消除 Sprint。

---

## 2. Technical Debt Items (技术债务清单)

### TD-001: BuilderValidationEngine 暴露粒度需收紧
- **描述**: `packages/core/bootstrap/builder/builder-validation-engine.ts` 目前暴露在导出路径中。
- **影响**: 外部开发者可能误直接调用校验引擎而非使用 `PlatformBuilder.buildResult()`。
- **优先级**: Medium
- **建议 Sprint**: Sprint A3 (SDK Refinement)

### TD-002: Worker RPC 测试中的并行 Worker Spawn 竞争
- **描述**: `packages/core/__tests__/worker-rpc.test.ts` 在 31 个文件大规模并发测试下存在 Worker 子进程端口/资源竞争。
- **影响**: 多线程并发运行完整 Vitest 时偶发 flaky，单测运行时可 100% 通过。
- **优先级**: Low
- **建议 Sprint**: Sprint A3 (Test Suite Hardening)

### TD-003: JSDoc API 标注修饰
- **描述**: 部分底层内部 helper 缺少 JSDoc `@internal` 显式标注。
- **影响**: IDE 自动补全时可能会提示内部 helper 函数。
- **优先级**: Low
- **建议 Sprint**: Sprint A3 (Documentation Polish)
