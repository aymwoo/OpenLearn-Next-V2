# OpenLearn Plugin Host Dependency Analysis (插件宿主依赖分析报告)

## 1. Executive Summary (概述)

本报告审查 Plugin Host 内部依赖关系以及与 Platform Kernel、数据库、外部 Worker 的依赖方向。

---

## 2. Dependency Matrix (依赖拓扑与耦合分析)

```
====================================================================
 Component                   | Dependencies                | Coupling
====================================================================
 PluginHost                  | CommandBus, EventBus        | Loose (Event & Bus)
 ContextBuilder              | PluginNamespace, VFS Storage| Loose
 DependencyResolver          | Manifest Data Types         | Pure Math / Graph
 WorkerSandbox               | Node `worker_threads`       | OS Native
 ContributionRegistry        | UI Slots Data Structures    | Loose
 ConfigService               | JSON Schema Validator       | Loose
====================================================================
```

---

## 3. Coupling & Circular Dependency Inspection (耦合与循环引用检查)

- **Incoming Dependencies (入向依赖)**: `server.ts` 路由与 `LessonSession` 在插件触发时通过 `PluginHost` 单例交互。
- **Outgoing Dependencies (出向依赖)**: 依赖平台 CommandBus / EventBus 拓扑。
- **Circular Dependencies (循环依赖)**: **0 Detected**（基于 ESM 标准单向依赖）。
- **Hidden Coupling (隐式耦合项)**: 插件清单中的 `permissions` 声明目前独立存储，后续平台接入宜映射至 `PermissionManager`。
