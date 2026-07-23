# OpenLearn Plugin Host Service Mapping (插件宿主服务映射分析)

## 1. Executive Summary (概述)

本报告评估现存 Plugin Host 子系统在平台接入阶段，哪些组件应注册至 `PlatformServiceRegistry`，哪些保持为宿主内部组件。

---

## 2. Platform Service Mapping Recommendation (服务映射推荐)

```
====================================================================
 Plugin Subsystem Component  | Target Service Category | Lifetime
====================================================================
 PluginHost                  | Platform Service        | Singleton
 ContributionRegistry        | Platform Service        | Singleton
 PluginConfigService         | Platform Service        | Singleton
 DependencyResolver          | Helper Utility          | Transient
 WorkerSandbox               | Internal Runtime        | Transient / Scoped
 PluginNamespace             | Internal Utility        | Transient
====================================================================
```

---

## 3. Recommended PlatformServiceRegistry Descriptors (服务描述符预设计)

```typescript
// Recommendation for future adoption:
registry.register({
  id: 'srv_plugin_host',
  lifetime: 'Singleton',
  description: 'OpenLearn Central Plugin Host Service Engine',
});

registry.register({
  id: 'srv_plugin_contribution_registry',
  lifetime: 'Singleton',
  description: 'Plugin UI & Slot Contribution Registry',
});
```
