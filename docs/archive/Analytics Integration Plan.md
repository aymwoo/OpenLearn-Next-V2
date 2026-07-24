# OpenLearn Analytics Integration Plan (分析运行时接入计划与就绪判定)

## 1. Executive Summary (概述)

本计划总结了将现有 Analytics Runtime 无缝接入 Platform Kernel 的演化方案、步骤拆解与实现就绪判定。

---

## 2. Platform Adoption Steps (接入步骤)

1. **Step 1 (Adapter Binding)**:
   - 通过 `IAnalyticsAdapter` 契约封装 `AnalyticsEngine` 与 `TelemetryCollector`。
2. **Step 2 (Service & Capability Registration)**:
   - 在 `PlatformCompositionRoot` 中将 `AnalyticsEngine` 注册至 `PlatformServiceRegistry`，将 `AnalyticsCapability` 注册至 `CapabilityRegistry`。
3. **Step 3 (Lifecycle Management)**:
   - 由 `PlatformBuilder` 托管遥测收集与分析的全局生命周期。

---

## 3. Implementation Readiness Decision (实现就绪判定)

根据全维度架构与依赖审计，作出如下就绪判定结论：

# Ready

### Decision Rationale (判定依据):
1. **模块架构解耦清晰**: 分析遥测主要依赖异步事件流订阅，与平台底层 EventBus 天然契合。
2. **基座设施就绪**: Platform Kernel v1.0 (PI-001 ~ PI-012) 已冻结且测试全部通过，具备 `IAnalyticsAdapter` 与 `PlatformServiceRegistry` 接入支持。
3. **零破坏性风险**: 接入过程将采用适配器包装模式，绝对不改动已有的事件收集、指标计算与 AI 学情洞察生成回路。
