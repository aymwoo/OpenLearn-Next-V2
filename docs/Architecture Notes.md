# OpenLearn Architecture Notes - Service Registry (架构备忘录)

## 1. Executive Summary (概述)

本架构备忘录记录了 PI-001 至 PI-007 Platform Kernel Service Registry 的演化历史。

---

## 2. Platform Progression (平台演进历史)

- **PI-001 至 PI-006 Baseline**: 完成 Context, Pipeline, Builder, Adapter, Composition Root。
- **PI-007 Platform Service Registry**: 实现 `PlatformServiceRegistry`, `ServiceDescriptor`, `ServiceCollection`, `ServiceResolver`, `ServiceScope`, `ServiceLifetime` (`Singleton` | `Scoped` | `Transient`)，支持 `register()`, `unregister()`, `replace()`, `resolve()`, `tryResolve()`, `resolveAll()`, `exists()`, `list()`, `clear()`，具备结构化断言校验与 `[PlatformServiceRegistry]` 运行期调试日志，未引入 DI 容器构造与自动装配逻辑。
