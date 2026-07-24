# CommandBus & EventBus 事件指令总线

OpenLearn V2 采用 CQRS（Command Query Responsibility Segregation）与 EDA（Event-Driven Architecture）模式。对应的核心实现在 `packages/core/command-bus/` 与 `packages/core/event-bus/`。

---

## 1. CommandBus (指令总线)

CommandBus 用于处理有且仅有一个处理者（Handler）的同步/异步操作逻辑。

### 命名规范
指令采用点号分隔命名法：`domain.action`（例如 `lesson.create`, `whiteboard.draw`, `vfs.write_file`）。

### 指令定义与分发

```typescript
import type { PlatformCommand } from '@openlearn/plugin-sdk';

const createLessonCmd: PlatformCommand = {
  id: 'cmd-12345',
  type: 'lesson.create',
  payload: { title: '高等数学第一讲', teacherId: 't-001' },
  timestamp: Date.now(),
};

// 注册处理程序
kernel.commandBus.register('lesson.create', async (cmd) => {
  return await kernel.lessonRuntime.createLesson(cmd.payload);
});

// 分发指令
const result = await kernel.commandBus.dispatch(createLessonCmd);
```

---

## 2. EventBus (事件总线)

EventBus 用于广播状态变更通知。一个事件可被零个或多个订阅者（Subscribers）监听。

### 命名规范
事件采用过去时命名法：`domain.verb_past`（例如 `lesson.created`, `assignment.graded`, `user.joined`）。

### 事件发布与订阅

```typescript
import type { PlatformEvent } from '@openlearn/plugin-sdk';

// 订阅事件
const unsubscribe = kernel.eventBus.subscribe('lesson.created', (event: PlatformEvent) => {
  console.log(`新课程已创建: ${event.payload.title}`);
});

// 发布事件
kernel.eventBus.publish({
  id: 'evt-67890',
  type: 'lesson.created',
  payload: { lessonId: 'les-101', title: '高等数学第一讲' },
  timestamp: Date.now(),
});
```

---

## 架构对比总结

| 特性 | CommandBus | EventBus |
|---|---|---|
| **模式** | 1-to-1 (Command -> Handler) | 1-to-N (Pub / Sub) |
| **命名契约** | 祈使句 (`lesson.create`) | 过去时 (`lesson.created`) |
| **返回值** | 返回执行结果 Promise | 无返回值（广播通知） |
| **失败处理** | 报错直接抛给调用方 | 单个订阅者异常不影响其他订阅者 |
