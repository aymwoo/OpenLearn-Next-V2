# RFC-001: Platform Service Registry (平台服务注册中心规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-001 |
| **Title** | Platform Service Registry (平台服务注册中心规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-001 定义了 OpenLearn 平台服务注册中心（Platform Service Registry）的标准规范，涵盖 Service Contract 定义规则、服务注册协议、依赖注入 (DI) 范式、服务作用域 (Service Scope) 分类及服务生命周期管理。

---

## 2. Motivation & Context (背景与动因)

为了实现解耦与零类硬依赖，平台中所有核心服务（AI、Lesson、Whiteboard、Analytics、Storage、Plugin）均不得直接 `import` 彼此的具体实现类。服务消费方必须通过 Service Registry 请求标准化服务契约（Contract Interface）。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Service Contract (服务契约)
- 所有挂载在平台注册中心的服务必须在 `packages/core/di/interfaces.ts` 或 `service-registry/contracts/` 中声明显式 TypeScript 接口 `I<Name>ServiceContract`。
- 每个契约必须配对全局唯一的 `Token<T>`，命名范式为 `@openlearn/core:I<Name>Service`。

### 3.2 Service Registration (服务注册协议)
- 服务提供者必须提供 `ServiceDescriptor`：
  ```typescript
  export interface ServiceDescriptor<T = unknown> {
    readonly id: string;
    readonly namespace: string;
    readonly serviceType: string;
    readonly version: string;
    readonly implementation: new (...args: any[]) => T;
    readonly scope: ServiceScope;
    readonly singleton: boolean;
    readonly dependencies: ReadonlyArray<string>;
    readonly metadata: Record<string, unknown>;
  }
  ```
- 注册方法统一为 `platformServiceRegistry.register(descriptor, instanceOrFactory)`。

### 3.3 Dependency Injection (依赖注入)
- 平台采用 Token 驱动的控制反转 (IoC) 依赖注入模式。
- 内核服务在 `Kernel` 构造函数中统一推演并注入 `ServiceRegistry`。
- 插件在 `activate(ctx)` 生命周期中通过 `ctx.resolve(IToken)` 或 `ctx.services.<name>` 隐式注入。

### 3.4 Service Scope (服务作用域)
1. **Singleton**: 全局唯一单例，伴随 Kernel 生命周期（例：Database, StorageService, AIProviderGateway）。
2. **Session**: 课堂 Session 级别实例，在 Session 创建时实例化，销毁时自动 Dispose。
3. **Lesson**: 课时级别实例，在 Flow 切换或 Stage 加载时重置。
4. **Plugin**: 插件激活作用域实例，伴随插件 deactivate 销毁。
5. **Transient**: 每次 `resolve()` 重新实例化的短寿命工厂对象。

### 3.5 Lifecycle (生命周期)
服务状态机严格遵循：
`Registered` → `Initialized` → `Started` → `Ready` → `Stopped` → `Disposed`
注册中心会在状态变更时自动向 `ServiceEventBus` 广播 `ServiceRegistered`, `ServiceReady`, `ServiceStopped`, `ServiceDisposed` 事件。

---

## 4. Architecture & Design (架构与设计)

```
[ Service Registry Architecture ]
PlatformServiceRegistry
  ├── ServiceLifecycleManager (State Machine)
  ├── DependencyResolver (DAG Topological Sort & Cycle Detection)
  ├── ServiceInspector (Dev Diagnostics)
  └── ServiceEventBus (Lifecycle Telemetry)
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

兼容层必须保证现有的 `IAIServiceToken`, `IEventBusServiceToken`, `IStorageServiceToken` 依然可在任何插件中直接解析使用。
