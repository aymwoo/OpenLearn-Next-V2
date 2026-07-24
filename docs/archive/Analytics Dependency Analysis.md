# OpenLearn Analytics Dependency Analysis (分析运行时依赖分析报告)

## 1. Executive Summary (概述)

本报告审查 Analytics Runtime 的依赖拓扑方向，以及与平台事件总线 (EventBus)、数据库和 AI Capability 的耦合关系。

---

## 2. Dependency Matrix (依赖拓扑与耦合分析)

```
====================================================================
 Component                   | Dependencies                | Coupling
====================================================================
 AnalyticsEngine             | EventBus, CommandBus        | Loose (Event Subscriber)
 TelemetryCollector          | LessonSession, Whiteboard   | Loose
 AnalyticsCapability         | AIRuntimeKernel             | Core AI
 MetricsAggregator           | SQLite Database             | Pure Math / Persistence
 DashboardReporter           | REST Route Endpoints        | UI Provider
====================================================================
```

---

## 3. Coupling & Circular Dependency Inspection (耦合与循环引用检查)

- **Incoming Dependencies (入向依赖)**: 系统各模块触发 `EventBus.publish()` 时无感广播事件。
- **Outgoing Dependencies (出向依赖)**: 依赖平台 EventBus 与数据库服务。
- **Circular Dependencies (循环依赖)**: **0 Detected**（基于异步事件解耦）。
- **Hidden Coupling (隐式耦合项)**: 遥测事件目前在部分子系统中零散广播，后续接入阶段宜统一收拢至 Platform Event Bus 规范格式。
