# OpenLearn Plugin Host Capability Mapping (插件宿主能力映射分析)

## 1. Executive Summary (概述)

本报告分析 Plugin Host 子系统向平台 `CapabilityRuntime` / `CapabilityRegistry` 暴露的能力清单。

---

## 2. Plugin Host Capability Mapping (能力映射清单)

```
====================================================================
 Capability ID              | Category   | Implementation File
====================================================================
 cap_plugin_management      | Extension  | capabilities/plugin-capability.ts
 cap_plugin_slot_render     | Frontend UI| contribution-registry.ts
 cap_plugin_sandbox_execute | Runtime    | hot-reload.ts / WorkerSandbox
====================================================================
```

---

## 3. Capability Governance (能力治理)

`PluginCapability` (`cap_plugin_management`) 已经具备统一的能力状态管理，可通过 `CapabilityRuntime` 进行安全管控与开启/禁用。
