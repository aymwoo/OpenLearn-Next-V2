# OpenLearn Plugin Host Integration Plan (插件宿主接入计划与就绪判定)

## 1. Executive Summary (概述)

本计划总结了将现有 Plugin Host 无缝接入 Platform Kernel 的演化方案、步骤拆解与实现就绪判定。

---

## 2. Platform Adoption Steps (接入步骤)

1. **Step 1 (Adapter Binding)**:
   - 通过 `IPluginHostAdapter` 契约封装 `PluginHost`，确保外部 API 无破坏性变动。
2. **Step 2 (Service Registration)**:
   - 在 `PlatformCompositionRoot` 中将 `PluginHost` 与 `ContributionRegistry` 注册至 `PlatformServiceRegistry`。
3. **Step 3 (Lifecycle Management)**:
   - 托管 Plugin Discovery 与 Initial Active 调度至 `PlatformBuilder` 的 Pipeline 阶段。

---

## 3. Implementation Readiness Decision (实现就绪判定)

根据全维度架构与依赖审计，作出如下就绪判定结论：

# Ready

### Decision Rationale (判定依据):
1. **架构高度解耦**: `packages/core/plugin-host/` 具备完善的沙箱隔离、命令中间件与动态加载机制，接口清爽。
2. **基座设施就绪**: Platform Kernel v1.0 (PI-001 ~ PI-012) 已冻结且测试全部通过，具备 `IPluginHostAdapter` 与 `PlatformServiceRegistry` 接入支持。
3. **零破坏性风险**: 接入过程将采用适配器包装，绝不改动 Worker RPC、Manifest Parser 及现存插件代码。
