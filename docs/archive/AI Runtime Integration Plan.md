# OpenLearn AI Runtime Integration Plan (AI 运行时平台接入计划与就绪判定)

## 1. Executive Summary (概述)

本计划总结了将现有 AI Runtime 逐步无缝接入 Platform Kernel (PI-001 ~ PI-012) 的具体演化方案与风险规避措施。

---

## 2. Platform Adoption Steps (平台接入实施步骤)

1. **Step 1 (Integration Adapter Binding)**:
   - 通过 `IAIRuntimeAdapter` 接口包装现有的 `AIRuntimeEngine`，切断与外部路由的强耦合。
2. **Step 2 (Service Registration)**:
   - 在 `PlatformCompositionRoot` 中将 `AIRuntimeEngine` 注册至 `PlatformServiceRegistry`。
3. **Step 3 (Capability Registration)**:
   - 将 8 大底层 AI 能力注册至 `CapabilityRuntime`。

---

## 3. Implementation Readiness Decision (实现就绪判定)

根据审计评估，现作出如下就绪判定结论：

# Ready

### Decision Rationale (判定依据):
1. **代码解耦良好**: `packages/core/ai/` 与 `packages/core/ai-capability/` 已经具备高度模块化的目录分层与 TypeScript 接口定义。
2. **内核基座完备**: Platform Kernel v1.0 (PI-001 ~ PI-012) 已冻结且 100% 单元测试通过，具备 `IAIRuntimeAdapter` 与 `PlatformServiceRegistry` 接入设施。
3. **零破坏性风险**: 接入过程将完全基于 Adapter 模式包装，不改动现有的 LLM 通信逻辑与 Tool 调度回路。
