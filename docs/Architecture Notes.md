# OpenLearn Architecture Notes - Permission Framework (架构备忘录)

## 1. Executive Summary (概述)

本架构备忘录记录了 PI-001 至 PI-012 平台内核权限框架的演化历史。

---

## 2. Platform Progression (平台演进历史)

- **PI-001 至 PI-011 Baseline**: 完成 Context, Pipeline, Builder, Adapter, Composition Root, Service Registry, DI Container, Capability Runtime, Event Bus, Configuration System。
- **PI-012 Platform Permission Framework**: 实现 `PermissionManager`, `PermissionRegistry`, `PermissionEvaluator`, `PermissionDescriptor`, `PermissionContext`, `PermissionResult` 与 `IPermissionProvider`。支持 6 大基础设施权限类别（`Platform`, `Infrastructure`, `Capability`, `Configuration`, `Lifecycle`, `Reserved`）与 5 种策略类型（`Allow`, `Deny`, `Default`, `Inherited`, `Reserved`）。严格隔离于业务 RBAC 与用户权限。
