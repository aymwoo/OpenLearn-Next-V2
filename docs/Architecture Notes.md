# OpenLearn Architecture Notes - Service Registry (架构备忘录)

## 1. Executive Summary (概述)

本架构备忘录记录了 PI-001 至 PI-007 Platform Kernel Service Registry 的演化历史。

---

## 2. Platform Progression (平台演进历史)

- **PI-001 至 PI-006 Baseline**: 完成 Context, Pipeline, Builder, Adapter, Composition Root。
- **PI-007 Platform Service Registry**: 实现 `PlatformServiceRegistry`, `ServiceDescriptor`, `ServiceCollection`, `ServiceResolver`, `ServiceScope`, `ServiceLifetime` (`Singleton` | `Scoped` | `Transient`)，支持 `register()`, `unregister()`, `replace()`, `resolve()`, `tryResolve()`, `resolveAll()`, `exists()`, `list()`, `clear()`，具备结构化断言校验与 `[PlatformServiceRegistry]` 运行期调试日志，未引入 DI 容器构造与自动装配逻辑。
- **PI-008 Dependency Injection Container**: 在 `PlatformServiceRegistry` 之上构建 `PlatformContainer`，提供构造器/工厂/实例/Lazy/可选/多实现/命名注入与 `Application`/`Request`/`Session`/`Custom` 作用域，复用 `ServiceLifetime` 与 `ServiceScope`，并复用注册表的单例/作用域缓存；所有注册均镜像进注册表，注册表始终为唯一事实来源。
- **PI-009 Capability Runtime**: 新增自包含模块 `packages/core/capability-runtime/`，实现 `CapabilityStatus`（生命周期 FSM）、`CapabilityDescriptor`、`CapabilityProvider`、`CapabilityContext`、`CapabilityResolver`、`CapabilityRegistry`、`PlatformCapability`、`CapabilityRuntime`。支持 `register()`/`unregister()`/`replace()`/`exists()`/`find()`/`list()`/`resolve()`/`resolveAll()`，解析模式 `Single`/`Multiple`/`Priority`/`Default`/`Optional`/`Validation`，并与 `PlatformServiceRegistry`、`PlatformContainer`(PI-008)、`PlatformBuilder` 集成。该模块与既有的 `packages/core/capability/`（调用框架）并存、不重复、不修改业务模块。
- **PI-010 Platform Event Bus**: 新增自包含模块 `packages/core/event-bus-runtime/`，实现 `EventBus`、`EventPublisher`、`EventSubscriber`、`EventDispatcher`、`EventRegistry`、`EventHandler`、`PlatformEventObject`、`EventDescriptor`、`EventContext`、`EventError`、`EventResult`。支持 12 类平台基础设施事件（PlatformStarting/Started/Stopping/Stopped、ServiceRegistered/Removed、CapabilityRegistered/Resolved、BootstrapStageStarted/Completed/Failed、ConfigurationLoaded），提供 `publish()`/`publishAsync()`/`publishSync()` 与 `subscribe()`/`subscribeOnce()`/`unsubscribe()`/`clear()`，支持优先级+有序分发、错误隔离、取消、超时、过滤、同步/异步/多处理器。通过 `bridgeServiceEventBus`/`bridgeBootstrapPipeline`/`bridgeCapabilityRuntime`/`attachBuilder` 与 `ServiceRegistry`、`BootstrapPipeline`、`CapabilityRuntime`、`PlatformBuilder` 集成；复用 `IPlatformLogger` 与既有 `ServiceEventBus`。该模块与既有的 `packages/core/event-bus/`（通用 EventBus）并存、不重复、不修改业务模块。
