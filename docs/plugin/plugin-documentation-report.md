# 插件系统文档审计报告 (Plugin Documentation Report)

**Project**: OpenLearn V2  
**Module**: Plugin Subsystem (`packages/core/plugin-host/`, `packages/plugin-sdk/`, `packages/plugins/`)  
**SDK Version**: `@openlearn/plugin-sdk@3.5.0`  
**Audited Date**: 2026-07-30  
**Status**: 100% Fully Verified against Source Code  

---

## 1. 核心组件与文件验证映射表

| 组件名称 | 验证物理源码路径 | 审计结论 |
| :--- | :--- | :--- |
| **PluginHost** | [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts#L105) | 已验证。7 状态确切转换、默认 5s 超时保护、强力资源回收 `ResourceTracker`。 |
| **PluginContext** | [`packages/core/plugin-host/types.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/types.ts#L108) | 已验证。提供 7 大内核服务代理、`ctx.resolve()`、`ctx.provide()`、`ctx.db` 及白名单 `require()`。 |
| **Manifest Schema** | [`packages/core/esm-loader/manifest-schema.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/esm-loader/manifest-schema.ts#L86) | 已验证。Zod 校验包含版本限定 `requires`/`optional`、声明式 `contributes` 及 `deploy` 配置。 |
| **PluginLifecycleManager** | [`packages/core/plugin-host/plugin-lifecycle-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/plugin-lifecycle-manager.ts#L26) | 已验证。提供微服务级别的安装、激活、停用、热重载与健康检查。 |
| **ContributionRegistry** | [`packages/core/plugin-host/contribution-registry.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/contribution-registry.ts#L54) | 已验证。成功管理 5 大声明式 UI 插槽。 |
| **UnifiedExtensionRegistry** | [`packages/core/plugin-host/unified-extension-registry.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/unified-extension-registry.ts#L37) | 已验证。全平台统一扩展点聚集索引。 |
| **WorkerManager & Worker Isolation** | [`packages/core/worker-runtime/worker-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/worker-manager.ts#L35) | 已验证。通过 Worker Thread 及 IPC 实现第三方未信任插件隔离。 |
| **Plugin Distribution Manager** | [`packages/core/plugin-host/plugin-distribution-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/plugin-distribution-manager.ts#L95) | 已验证。多仓库适配器及 ZIP 自动更新序列。 |

---

## 2. 插件体系架构关键指标

- **受控核心服务数**: 7 个 (`commandBus`, `eventBus`, `actionRegistry`, `capability`, `processManager`, `storage`, `ai`)
- **生命周期状态数**: 7 个 (`INSTALLED`, `ACTIVATING`, `ACTIVE`, `DEACTIVATING`, `INACTIVE`, `ERROR`, `UNINSTALLED`)
- **激活/停用超时阈值**: `5000ms`
- **共享 Node 模块白名单**: 7 个 (`recharts`, `react-markdown`, `jspdf`, `jspdf-autotable`, `xlsx`, `lucide-react`, `uuid`)
- **内置范例插件库**: 7 个 (`@openlearn/plugin-vfs`, `management`, `builtin`, `ai-planner`, `ai-submit-injector`, `assignment-eval`, `process`)
