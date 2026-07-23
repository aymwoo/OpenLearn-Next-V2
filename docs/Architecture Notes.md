# OpenLearn Architecture Notes - Integration Layer (架构备忘录)

## 1. Executive Summary (概述)

本架构备忘录记录了 PI-001 至 PI-007 平台内核与集成层的演化历史。

---

## 2. Kernel Increments Progression (内核增量演进历史)

- **PI-001 Platform Contracts**: 建立平台统一基础类型与生命周期枚举。
- **PI-002 Bootstrap Context**: 建立 `IPlatformContext` 与 `IBootstrapContext` 纯接口规范。
- **PI-003 Bootstrap Pipeline**: 建立 5 阶段启动管道、耗时采集与异常自动回滚机制。
- **PI-004 PlatformBuilder**: 建立 Fluent Builder 构建器 API 与状态机。
- **PI-005 Server Bootstrap Adapter**: 通过适配器模式将生产入口 `server.ts` 接入管道。
- **PI-006 Composition Root**: 建立单一基础设施组装入口 `PlatformCompositionRoot`。
- **PI-007 Platform Integration Layer**: 建立 `PlatformIntegration` 解耦适配层与业务域适配器契约。
