# OpenLearn Classroom Context Facade Specification (统一课堂上下文门面规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P4-02 中，成功构建了 **Classroom Context Facade**（位于 `src/features/classroom-runtime/`）。

门面模式通过 `ClassroomContextFacade` 集中聚合底层已有运行时的上下文 (`Lesson`, `Whiteboard`, `AI`, `Plugin`, `Analytics`, `Resource`)，向第三方插件与外部组件暴露唯一访问 API，**绝对零状态重复复制**，所有数据读取动态解算自 `ClassroomSession`。

---

## 2. Aggregated Context Topology (上下文聚合拓扑图)

```
====================================================================
 ClassroomContextFacade (Unified Plugin API Entrypoint)
   ├── classroomId -> ClassroomSession.classroomId
   ├── stage       -> ClassroomSession.stage (Create/Prepare/Teaching/etc.)
   ├── lesson      -> Lesson Runtime Session
   ├── whiteboard  -> Whiteboard Engine & Canvas
   ├── ai          -> AI Runtime Kernel & Agent OS
   ├── plugin      -> Plugin Host Sandbox
   ├── analytics   -> Analytics & Telemetry Engine
   └── resource    -> Resource Runtime Registry
====================================================================
```

---

## 3. Usage Example (使用范例)

```typescript
import {
  ClassroomService,
  ClassroomContextFacade,
} from './src/features/classroom-runtime/index.js';

const service = new ClassroomService();
const session = service.createSession('cls_math_101');

// Create Facade
const classroom = new ClassroomContextFacade(session);

console.log('Classroom ID:', classroom.classroomId);
console.log('Current Stage:', classroom.stage);
```
