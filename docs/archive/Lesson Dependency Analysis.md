# OpenLearn Lesson Dependency Analysis (课程引擎依赖分析报告)

## 1. Executive Summary (概述)

本报告审查 Lesson Engine 的依赖拓扑方向，以及与 AI Runtime、Whiteboard、Plugin Host、数据库的耦合关系。

---

## 2. Dependency Matrix (依赖拓扑与耦合分析)

```
====================================================================
 Component                   | Dependencies                | Coupling
====================================================================
 LessonSessionManager        | LessonSession, Types        | Loose (Pure Core)
 LessonSession               | Subsystem Context Interfaces| Loose (Interface-based)
 Classroom Controller        | CommandBus, EventBus        | Kernel Core
 Quiz Injector               | Plugin SDK                  | Loose
 SQLite Storage              | `educational_os.db`         | Standard DB
====================================================================
```

---

## 3. Coupling & Circular Dependency Inspection (耦合与循环引用检查)

- **Incoming Dependencies (入向依赖)**: REST API Endpoint 与 Socket.IO 协同监听回调。
- **Outgoing Dependencies (出向依赖)**: 依赖 `PlatformServiceRegistry` 中挂载的子系统。
- **Circular Dependencies (循环依赖)**: **0 Detected**（采用只读 Context 引用防循环）。
- **Hidden Coupling (隐式耦合项)**: 课堂状态流转目前在 `server.ts` 包含少许 WebSocket 广播逻辑，后续在演进中收拢入事件总线监听器。
