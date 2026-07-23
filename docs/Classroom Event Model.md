# OpenLearn Classroom Event Model Specification (统一课堂事件模型规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P4-03 中，成功构建了 **Classroom Event Model**（位于 `src/features/classroom-runtime/`）。

事件模型复用底层 `PlatformEventBus` (PI-010)，统一定义了 `classroom.*` 事件命名空间，包含 9 项核心课堂生命周期事件。绝对零业务修改，全量解耦与向后兼容。

---

## 2. Classroom Event Namespace (`classroom.*`)

| 事件名称 | 触发阶段 / 含义 |
|---|---|
| `classroom.created` | 课堂实例创建 |
| `classroom.prepared` | 大纲与白板预装载完成 |
| `classroom.ready` | 师生就绪 |
| `classroom.teaching` | 实时授课中 |
| `classroom.paused` | 课堂已暂停 |
| `classroom.resumed` | 课堂已恢复 |
| `classroom.finished` | 课堂已下课 |
| `classroom.archived` | 学情与笔记归档保存 |
| `classroom.disposed` | 课堂句柄销毁 |

---

## 3. Usage Example (使用范例)

```typescript
import { ClassroomEventBus } from './src/features/classroom-runtime/index.js';

const classroomEventBus = new ClassroomEventBus();

// Subscribe to classroom.teaching event
const unsubscribe = classroomEventBus.subscribe('classroom.teaching', (evt) => {
  console.log('Classroom is teaching:', evt.classroomId, evt.payload);
});

// Publish classroom.teaching event
classroomEventBus.publish('classroom.teaching', 'cls_math_101', {
  teacherId: 'tch_01',
});
```
