# OpenLearn Public API Review Report (公共 API 暴露审查报告)

## 1. Executive Summary (概述)

本报告审查 Platform Kernel 从 `packages/core/bootstrap/index.ts` 及子目录导出的每一个公共 API 符号，并将其分类为 **Public SDK**、**Internal Platform**、**Implementation Detail** 或 **Deprecated Candidate**。

---

## 2. API Classification & Stability Analysis (API 分类与稳定性分析)

| API 符号 / Interface | 分类 (Classification) | 暴露原因 (Rationale) | Breaking Risk in v2.0 |
|---|---|---|---|
| `IPlatformContext` | **Public SDK** | 全平台不可变上下文主契约 | Low (向后兼容) |
| `IBootstrapContext` | **Public SDK** | 启动阶段只读上下文契约 | Low |
| `PlatformBuilder` | **Public SDK** | 平台 Kernel 唯一公开链式构建入口 | Low |
| `ServerBootstrapAdapter` | **Internal Platform** | `server.ts` 与 Kernel 启动适配器 | Medium (内部演进) |
| `PlatformCompositionRoot` | **Internal Platform** | 基础设施集中组装入口 | Low |
| `BootstrapPipeline` | **Public SDK** | 启动 5 阶段调度执行门面 | Low |
| `PlatformServiceRegistry` | **Public SDK** | 基础服务注册表门面 | Low |
| `PlatformContainer` | **Public SDK** | 依赖注入容器门面 | Low |
| `CapabilityRuntime` | **Public SDK** | 能力治理与执行运行时 | Low |
| `PlatformEventBus` | **Public SDK** | 平台事件总线 | Low |
| `PlatformConfigurationSystem` | **Public SDK** | 平台配置管理系统 | Low |
| `PermissionManager` | **Public SDK** | 基础设施权限管理门面 | Low |
| `PlatformModuleRegistry` | **Public SDK** | 模块定义与发现注册表 | Low |
| `PlatformDomainRegistry` | **Public SDK** | 业务域定义与归属注册表 | Low |
| `LessonSessionManager` | **Public SDK** | 课堂会话运行时管理器 | Low |
| `BuilderValidationEngine` | **Implementation Detail** | 内部构建校验静态引擎 | High (应隐匿为 Internal) |

---

## 3. Deprecated Candidates (废弃候选符号)

- **无** (平台 Kernel 均为新设计的标准化 API，无过时 API 遗留)。
