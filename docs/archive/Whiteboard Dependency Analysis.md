# OpenLearn Whiteboard Dependency Analysis (白板依赖分析报告)

## 1. Executive Summary (概述)

本报告审查 Whiteboard Runtime 内部依赖关系以及与 Platform Kernel、React-Konva、Socket.IO 的依赖拓扑。

---

## 2. Dependency Matrix (依赖拓扑与耦合分析)

```
====================================================================
 Component                   | Dependencies                | Coupling
====================================================================
 InteractiveWhiteboard       | react-konva, konva, socket.io| External UI/RTC
 CanvasModel                 | Pure State / Immer          | Low
 InteractionEngine           | Konva Event Emitter         | Low
 RenderingEngine             | React-Konva Canvas Stage    | UI Engine
 StageViewBridge             | Viewport / Camera           | Math Matrix
 WhiteboardCapability        | AIRuntimeKernel             | Core AI
====================================================================
```

---

## 3. Coupling & Circular Dependency Inspection (耦合与循环引用检查)

- **Incoming Dependencies (入向依赖)**: `LessonSession` 在渲染课堂画板时引用 `InteractiveWhiteboard` 组件。
- **Outgoing Dependencies (出向依赖)**: 依赖 `konva`, `react-konva`, `socket.io-client`。
- **Circular Dependencies (循环依赖)**: **0 Detected**（基于 React 单向数据流）。
- **Hidden Coupling (隐式耦合项)**: 协同操作消息目前与特定 Classroom Socket Room 通信绑定，平台接入阶段宜抽象出广播管道适配器。
