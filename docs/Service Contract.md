# OpenLearn Service Contract Specification (服务契约规范)

## 1. Executive Summary (概述)

为了切断 Lesson、Whiteboard、Analytics、Plugin 与 AI 模块之间的类实现硬耦合，平台定义了标准化的解耦 Service Contract。所有模块通过 Service Registry 进行依赖注入与服务解析。

---

## 2. Registry Flow (Mermaid 注册与服务解析流程图)

```mermaid
sequenceDiagram
    autonumber
    actor Module as 业务模块 (Lesson / Plugin / Whiteboard)
    participant RegKernel as ServiceRegistryKernel
    participant RegEngine as PlatformServiceRegistry
    participant Lifecycle as ServiceLifecycleManager
    participant Resolver as DependencyResolver

    Module->>RegKernel: register(descriptor, serviceInstance)
    RegKernel->>Resolver: resolveOrder() 拓扑图校验
    RegKernel->>RegEngine: register() 写入注册表
    RegEngine->>Lifecycle: setLifecycleState('Ready')
    RegEngine-->>Module: 发布 ServiceReady 事件

    actor Consumer as 消费方模块 (Analytics / AI)
    Consumer->>RegEngine: resolve('srv_lesson')
    RegEngine-->>Consumer: 返回符合 ILessonServiceContract 接口的实例
```

---

## 3. Core Standard Contracts (标准服务契约矩阵)

- **`IAIServiceContract`**: `generateText(prompt, options)`
- **`ILessonServiceContract`**: `getLesson(lessonId)`, `createLesson(title, subject)`
- **`IWhiteboardServiceContract`**: `getElements(whiteboardId)`, `createElement(whiteboardId, elementData)`
- **`IAnalyticsServiceContract`**: `getMetrics()`, `publishEvent(eventType, payload)`
- **`IStorageServiceContract`**: `readFile(path)`, `writeFile(path, content)`
- **`IPluginServiceContract`**: `getActivePlugins()`
- **`IRuntimeServiceContract`**: `getSessionState()`
