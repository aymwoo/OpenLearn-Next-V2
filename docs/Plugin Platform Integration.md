# OpenLearn Plugin Platform Integration Specification (插件平台集成规范)

## 1. Executive Summary (概述)

在 Platform Adoption Sprint A2 Step 2 中，成功实现了 **Plugin Host Integration**。本步骤通过引入 `PluginCompositionModule` (`packages/core/bootstrap/composition/plugin-composition-module.ts`)，成功将现有的 Plugin Host、Worker 隔离沙箱、UI 贡献注册表及插件生命周期事件挂载至 Platform Kernel 的生命周期，**在 100% 保留插件 Runtime、RPC 通信与 Manifest 格式前提下，完成了平台托管**。

---

## 2. Integration Architecture & Topology (Mermaid 平台集成架构图)

```mermaid
graph TD
    PlatformBuilder["PlatformBuilder (PI-004)"]
    CompositionRoot["PlatformCompositionRoot (PI-006)"]
    PluginCompositionModule["PluginCompositionModule (A2 Step 2)"]

    ServiceRegistry["PlatformServiceRegistry (PI-007)"]
    CapabilityRegistry["CapabilityRegistry (PI-009)"]
    PermissionManager["PermissionManager (PI-012)"]
    EventBus["PlatformEventBus (PI-010)"]

    PluginService["srv_plugin_host & srv_plugin_contribution_registry"]
    PluginCapability["Plugin Capability (capability_plugin)"]
    PluginPermissions["Infrastructure Permissions (perm_plugin_execute)"]
    PluginEvents["Plugin Infrastructure Events (PluginHostInitialized)"]

    PlatformBuilder --> CompositionRoot
    CompositionRoot --> PluginCompositionModule
    PluginCompositionModule -->|Registers Services| ServiceRegistry
    PluginCompositionModule -->|Registers Capabilities| CapabilityRegistry
    PluginCompositionModule -->|Registers Permissions| PermissionManager
    PluginCompositionModule -->|Publishes Events| EventBus

    ServiceRegistry --> PluginService
    CapabilityRegistry --> PluginCapability
    PermissionManager --> PluginPermissions
    EventBus --> PluginEvents
```

---

## 3. Registered Plugin Infrastructure Services & Capabilities (托管服务与能力清单)

- **Platform Services**: `srv_plugin_host`, `srv_plugin_contribution_registry`
- **Capability Registry**: `capability_plugin`
- **Infrastructure Permissions**: `perm_plugin_execute`, `perm_plugin_install`
- **Infrastructure Events**: `PluginHostInitialized`, `PluginLoaded`, `PluginActivated`
