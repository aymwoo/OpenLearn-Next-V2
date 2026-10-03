# CommandBus & EventBus 事件指令总线

> 📌 **本文为唯一真源**：`docs/core/command-event-bus.md` 旧版（2026-07-24）已废弃删除，内容以本文为准。

OpenLearn V2 采用 CQRS（Command Query Responsibility Segregation）与 EDA（Event-Driven Architecture）模式。对应的核心实现在 `packages/core/command-bus/` 与 `packages/core/event-bus/`。

---

## 1. CommandBus (指令总线)

CommandBus 用于处理有且仅有一个处理者（Handler）的同步/异步操作逻辑。公开方法共 6 个：`setInterceptor` / `registerHandler` / `registerLegacyHandler` / `unregisterHandler` / `execute` / `createCommand`（源码见 `packages/core/command-bus/index.ts` 的 `CommandBus` 类）。

### 命名规范

指令采用点号分隔命名法：`domain.action`（例如 `lesson.create`, `whiteboard.draw`, `vfs.write_file`）。

### 指令定义与分发

> ⚠️ 注册方法叫 **`registerHandler`**（不是 `register`），分发入口叫 **`execute`**（不是 `dispatch`），
> handler 必须是实现了 `execute(command)` 的**对象**，不能是裸函数。

```typescript
import type { PlatformCommand, CommandHandler } from '@openlearn/plugin-sdk';

// 注册处理程序：handler 必须是 { execute(command) } 对象
const lessonCreateHandler: CommandHandler = {
  async execute(command) {
    const payload = command.payload as { title: string; content?: string };
    const lessonId = await someService.createLesson(payload.title, payload.content);
    kernelContainer.eventBus.publish({
      id: `evt-${lessonId}`,
      type: 'lesson.created',
      source: 'plugin:ext-demo',
      payload: { lessonId, title: payload.title },
      timestamp: Date.now(),
    });
    return lessonId;
  },
};
kernelContainer.commandBus.registerHandler('lesson.create', lessonCreateHandler);

// 分发指令：用 createCommand 构造，actorId 是必填项
const createLessonCmd: PlatformCommand = kernelContainer.commandBus.createCommand(
  'lesson.create',
  { title: '高等数学第一讲', content: '第一章：极限' },
  'user-demo', // actorId
);

const result = await kernelContainer.commandBus.execute(createLessonCmd);
```

> 真实范例见 `packages/plugins/builtin.ts` 的 LESSON HANDLER 注册：它用 `uuidv7()` 生成 id 后直接 `INSERT INTO lessons (...)`，并以 `command.actorId` 作为 `creatorId` 的回退值（`payload.creatorId` 优先，且会剥去 `user:` 前缀）。
```

`PlatformCommand` 的字段与约束：

```typescript
export interface PlatformCommand<T = unknown> {
  readonly id: string;
  readonly type: string; // Namespace format, e.g., "lesson.create"
  readonly actorId: string; // 必填；为空时 execute() 兜底为 'agent-system-0'
  readonly payload: T;
  readonly timestamp?: number;
  readonly metadata?: CommandMetadata;
}
```

> 手写 `PlatformCommand` 字面量时**必须**带 `actorId`，否则无法通过类型检查。优先用 `createCommand(type, payload, actorId, metadata?)`——它会生成 UUID v7 的 `id`、补 `timestamp`、并把 `metadata` 兜底为 `{}`。

### 现代 / 旧格式 handler 的优先级

`execute()` 的路由顺序是「**现代 handler 优先，旧格式 handler 兜底**」：

- `registerHandler(type, handler)` —— 新格式，存入 `handlers` Map；重复注册同一 `type` 会**抛错**（`Command handler for <type> is already registered.`）。
- `registerLegacyHandler(type, handler)` —— 旧格式，存入 `legacyHandlers` Map；可重复注册，不抛错。仅当该 `type` 没有现代 handler 时才被使用。
- `unregisterHandler(type)` —— 同时从两个 Map 中删除。
- 两者都未命中时 `execute()` 抛 `No handler registered for command: <type>`。

### 拦截器与错误传播

`setInterceptor(fn)` 注册的拦截器在 handler 查找**之前**执行，用于权限校验与高危操作审批。handler 抛出的错误会被 `console.error('[CommandBus] Failed to execute ...')` 记录后**继续向调用方抛出**。

### 指令元数据与高频静默 (Command Metadata & Quiet Filtering)

每个指令均支持挂载可选的 `CommandMetadata`：

```typescript
export interface CommandMetadata {
  readonly correlationId?: string;
  readonly agentDelegated?: boolean;
  readonly undoable?: boolean;
  readonly silent?: boolean; // 声明该指令执行是否在控制台静默
  readonly [key: string]: unknown;
}
```

- **静默机制 (Quiet Commands)**：为防止高频轮询查询污染控制台输出，CommandBus 内置了 `DEFAULT_QUIET_COMMANDS` 名单，**共 6 条**：`courseware.list`、`courseware.get_attempt_raw_data`、`whiteboard.query`、`whiteboard.get_element`、`vfs.read_path`、`vfs.list_dir`。另支持通过 `metadata: { silent: true }` 对任意指令显式静默。
- **调试模式**：当需要排查问题时，可通过环境变量 `DEBUG_COMMAND_BUS=true` 或 `DEBUG` 包含 `commandbus`（`process.env.DEBUG?.includes('commandbus')`）强制打印所有指令的执行日志。错误信息（`console.error`）始终正常记录。

---

## 2. EventBus (事件总线)

EventBus 用于广播状态变更通知。一个事件可被零个或多个订阅者（Subscribers）监听，也支持 `'*'` 通配订阅。

### 命名规范

事件采用过去时命名法：`domain.verb_past`（例如 `lesson.created`, `assignment.graded`, `user.joined`）。

### 事件发布与订阅

```typescript
import type { PlatformEvent } from '@openlearn/plugin-sdk';

// 订阅事件：subscribe 返回取消订阅函数
const unsubscribe = kernelContainer.eventBus.subscribe('lesson.created', (event: PlatformEvent) => {
  console.log(`新课程已创建: ${event.payload.title}`);
});

// 发布事件：publish 是 async，返回 Promise<void>
await kernelContainer.eventBus.publish({
  id: 'evt-67890',
  type: 'lesson.created',
  source: 'plugin:ext-demo', // source 必填：来源插件 / 模块
  payload: { lessonId: 'les-101', title: '高等数学第一讲' },
  timestamp: Date.now(),
});
```

### 分发保证

`publish()` 内部委托 `publishDetailed()`，后者返回 `DispatchResult`（含 `eventId` / `eventType` / `subscriberCount` / `outcomes` / 可选 `skipped`）：

- **有界**：每个订阅者有独立挂钟预算（`EventBusOptions.handlerTimeoutMs`，默认 2000ms），挂起的监听器不会拖垮整条链。超时后订阅者**仍在后台继续运行**——总线只是不再等待，无法取消。
- **隔离**：抛错或超时的订阅者被记入 `outcomes` 并跳过，不会让 `publish` reject，也不影响其余订阅者被收集。
- **不重复分发**：同时注册在具体类型与 `'*'` 上的 handler 只会被调用一次。
- **防循环**：同一条因果链上同一事件类型重入超过 `maxSameTypeDepth`（默认 3）后，嵌套 `publish` 被丢弃并在结果中标记 `skipped: 'recursion-limit'`。深度统计由 `AsyncLocalStorage` 承载，因此**并发**发布同类型事件不会被误判为递归。
- **有序收集**：订阅者仍是**同步启动、并发执行**（保持既有可观测时序），但 `outcomes` 按注册顺序收敛，结果顺序确定。
- **泄漏告警**：同一事件类型订阅数超过 `MAX_SUBSCRIBERS_PER_TYPE`（50）时 `console.warn`。

> `id` 与 `timestamp` 缺省时由 `publishDetailed` 自动补全（`id` 走 `randomEventId()`）。另有 `unsubscribe(eventType, subscriber)` 与 `subscriberCount(eventType)` 供显式管理与断言。

---

## 架构对比总结

| 特性         | CommandBus                              | EventBus                                                        |
| ------------ | ---------------------------------------- | --------------------------------------------------------------- |
| **模式**     | 1-to-1 (Command -> Handler)              | 1-to-N (Pub / Sub)，支持 `'*'` 通配                              |
| **命名契约** | 祈使句 (`lesson.create`)                 | 过去时 (`lesson.created`)                                        |
| **注册方法** | `registerHandler` / `registerLegacyHandler` | `subscribe`（返回取消函数）                                  |
| **分发入口** | `execute(command)`                       | `publish(event)` / `publishDetailed(event)`                      |
| **返回值**   | 返回 handler 的执行结果 Promise          | `publish` 返回 `Promise<void>`；`publishDetailed` 返回 `DispatchResult` |
| **失败处理** | 报错直接抛给调用方                      | 单个订阅者异常/超时不影响其他订阅者                             |

