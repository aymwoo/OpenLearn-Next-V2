# OpenLearn Lesson Integration Plan (课程引擎接入计划与就绪判定)

## 1. Executive Summary (概述)

本计划总结了将现有 Lesson Engine 无缝接入 Platform Kernel 的演化方案、步骤拆解与实现就绪判定。

---

## 2. Platform Adoption Steps (接入步骤)

1. **Step 1 (Adapter Binding)**:
   - 通过 `ILessonEngineAdapter` 契约封装 `LessonSessionManager`，保证现有教学控制回路零修改。
2. **Step 2 (Service & Capability Registration)**:
   - 在 `PlatformCompositionRoot` 中将 `LessonSessionManager` 注册至 `PlatformServiceRegistry`，将 `LessonCapability` 注册至 `CapabilityRegistry`。
3. **Step 3 (Lifecycle Management)**:
   - 由 `PlatformBuilder` 托管课程全域生命周期控制。

---

## 3. Implementation Readiness Decision (实现就绪判定)

根据全维度架构与依赖审计，作出如下就绪判定结论：

# Ready

### Decision Rationale (判定依据):
1. **8 阶段状态机模型完备**: `packages/core/bootstrap/lesson-session/` 已具备高度标准化的 `LessonSessionManager` 与 `LessonSession`。
2. **基座设施就绪**: Platform Kernel v1.0 (PI-001 ~ PI-012) 已冻结且测试全部通过，具备 `ILessonEngineAdapter` 与 `PlatformServiceRegistry` 接入支持。
3. **零破坏性风险**: 接入过程将采用适配器包装模式，绝对不修改现有的教学业务流程、课堂 WebSocket 通信与随堂测验逻辑。
