# OpenLearn Composition Root Migration Strategy (组合根平滑迁移策略)

## 1. Executive Summary (概述)

为了确保 100% 向后兼容与零业务中断，Composition Root 采用 **4 阶段渐进迁移策略 (4-Phase Incremental Migration)**。

---

## 2. 4-Phase Migration Roadmap (迁移路线图)

### Phase 1: 保持 `server.ts` 业务逻辑，引入 `PlatformBuilder` 外壳
- **目标**: 新建 Composition Root 核心文件，保持现存 `server.ts` 流程完全不变。
- **动作**: 引入 `PlatformBuilder` API 规范，保持现有的 `new Kernel()` 作为包装层。

### Phase 2: 迁移启动流程至 `BootstrapPipeline`
- **目标**: 将 `server.ts` 中手写的 `kernel.pluginHost.loadPlugins()` 及 REST 路由注册托管至 Pipeline 的 `ActivationStage` 与 `ReadyStage`。

### Phase 3: 统一 Composition Root 依赖注入
- **目标**: 将 `Kernel` 构造函数中的硬编码对象图（Layer 0 -> Layer 3）收拢交由 `PlatformBuilder` 的阶段方法配置。

### Phase 4: 清理旧版本单体启动代码
- **目标**: 彻底弃用手写单体启动模式，实现全平台统一 `PlatformBuilder.create().buildAndStart()` 标准入口。
