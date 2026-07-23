# OpenLearn Platform Composition Root Testing Strategy (测试策略)

## 1. Executive Summary (概述)

为了验证 Platform Composition Root 的稳定性与兼容性，测试策略覆盖了单元测试、集成测试、启动测试、回归测试、兼容性测试与插件测试 6 大维度。

---

## 2. Test Dimensions & Suites (测试维度与方法)

1. **Unit Test (单元测试)**:
   - 套件: `packages/core/__tests__/bootstrap.test.ts`
   - 目标: 验证 `PlatformBuilder` 流式构建、`BootstrapPipeline` 按序调度与 `BootstrapContext` 强只读保护。
2. **Integration Test (集成测试)**:
   - 目标: 验证 `PlatformKernel` 成功聚合 Layer 0 至 Layer 3 所有子系统。
3. **Startup Test (启动测试)**:
   - 目标: 验证 6 阶启动阶段中任一阶段捕获异常后，系统正确关闭并释放已有资源。
4. **Regression Test (回归测试)**:
   - 运行全量 10 大核心引擎单元测试 (`lesson-engine`, `presence-engine`, `collaboration-engine`, `analytics-engine`, `ai-runtime`, `ai-capability`, `capability-framework`, `capability-governance`, `platform-service-registry`)，确保 78/78 测试全量通过。
5. **Compatibility Test (兼容性测试)**:
   - 验证旧版 REST API 响应格式与 Socket.IO 广播契约 100% 保持一致。
6. **Plugin Test (插件测试)**:
   - 运行 `PluginHost` 加载 built-in 插件（`ai-planner`, `vfs`, `management`），验证插件激活与能力暴露流程顺畅。
