# OpenLearn Architecture Notes - Domain Catalog (架构备忘录)

## 1. Executive Summary (概述)

本架构备忘录记录了 PI-001 至 Sprint A2 平台内核与业务域注册表的演化历史。

---

## 2. Platform Adoption Progression (平台接入演进历史)

- **PI-001 至 PI-006 Platform Kernel Baseline**: 完成 Context, Pipeline, Builder, Server Adapter, Composition Root。
- **PI-007 Platform Integration Layer**: 建立 `PlatformIntegration` 解耦适配层与 5 大业务域接口契约。
- **Sprint A1 Platform Module Registration**: 建立 `PlatformModuleRegistry` 模块级描述与注册机制。
- **Sprint A2 Platform Domain Registry**: 建立 `PlatformDomainRegistry` 限界上下文业务域映射（`Teaching`, `AI`, `Plugin`, `User`, `Course`, `Assessment`, `Analytics`, `Storage`, `Notification`, `Collaboration`, `Search`, `Security`），形成 `Platform` → `Domain Registry` → `Modules` 三级治理拓扑。
