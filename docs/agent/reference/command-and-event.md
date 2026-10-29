# 命令总线与事件总线

> 覆盖 `ctx.services.commandBus`、`ctx.services.eventBus`，以及内核侧的鉴权拦截器（default-deny）。
> 这两条总线是插件与平台之间**最主要的写路径**，也是报错最密集的地方。

---

## 1. 契约：`ICommandBusService`

```typescript
export interface ICommandBusService {
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;
  registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;
  unregisterHandler(commandType: string): void | Promise<void>;
  createCommand<T>(
    type: string,
    payload: T,
    actorId: string,
    metadata?: CommandMetadata,
  ): PlatformCommand<T> | Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>; // 插件调用必抛
}

export interface PlatformCommand<T = unknown> {
  readonly id: string;
  readonly type: string; // 命名空间格式，如 "lesson.create"
  readonly actorId: string;
  readonly payload: T;
  readonly timestamp?: number;
  readonly metadata?: CommandMetadata;
}

export interface CommandMetadata {
  readonly correlationId?: string;
  readonly agentDelegated?: boolean;
  readonly undoable?: boolean;
  readonly silent?: boolean;
  readonly [key: string]: unknown;
}

export interface CommandHandler<C extends PlatformCommand = PlatformCommand> {
  execute(command: C): Promise<void | any>;
}
```

设计约定（`packages/core/di/interfaces.ts` 文件头）：

- **所有方法返回 `Promise<T>`**（D-10）：即使当前是同步实现，也包成 async，以便本地 / 远程（Worker Thread）实现共用同一接口（D-17）。
- **接口里没有 dispose/清理生命周期**（D-05）：那是 DI 容器层的事。插件侧的清理由 `ResourceTracker` 自动接管。
- 类型收紧（D-11）：`any` → `unknown` 或具体类型；`getAgentTools(): Promise<unknown[]>`。

---

## 2. `registerHandler` 的实际行为

### 2.1 命名空间前缀（`plugin-namespace.ts`）

历史 bug：三处用了三套不一致的前缀规则 —— worker 的 `registerHandler` 给任何非 `${pluginId}.` 开头的命令加前缀；
前端 `invokeCommand` **只在命令不含 `.` 时**加前缀；host 侧 `service-host` 同第一种。
结果是 worker 插件注册 `courseware.query` 落到主 CommandBus 变成 `@courseware-hub/plugin.courseware.query`，
而前端 `invokeCommand('courseware.query')` 原样发出 ⇒ 主总线抛
`No handler registered for command: courseware.query`。

统一规则（`resolvePluginCommandType(type, pluginId)`，**必须传 `manifest.id`**）：

```
type 已以 `${pluginId}.` 开头      → 原样返回（调用方主动选择了命名空间）
type 匹配 UUID v7 + '.' 前缀      → 原样返回（这是别人的命名空间，见 §2.3）
其余                                → 返回 `${pluginId}.${type}`
```

```typescript
resolvePluginCommandType('courseware.query', '@courseware-hub/plugin');
// → '@courseware-hub/plugin.courseware.query'
resolvePluginCommandType('listUsers', '@my-scope/hello');
// → '@my-scope/hello.listUsers'
```

内核插件（id 以 `@openlearn/` 开头）**保持全局命名空间**，不加前缀（向后兼容）。

### 2.2 ⚠ 同一个 commandType，四种位置三种前缀语义

```{danger} 这是继 default-deny 之后第二高频的 COMMAND_NOT_REGISTERED 来源
写短名还是全限定名，**取决于写在哪里**。写错不会报错，只在运行期 403。
```

| 写在哪里                                                                          | 写什么                                       | 宿主是否加 `manifest.id` 前缀            |
| :-------------------------------------------------------------------------------- | :------------------------------------------- | :--------------------------------------- |
| `commandBus.registerHandler(type, …)`、`actionRegistry.register({ commandType })` | 短名，如 `poll.create`                       | ✅ 自动加                                |
| `manifest.classroomTools[].commandType` / `manifest.contributes.*`                | 短名，如 `poll.create`                       | ✅ 自动加                                |
| 运行期 `ctx.ui.registerExtensionPoint(slot, { slotProps: { commandType } })`      | **必须全限定** `{{manifest.id}}.poll.create` | ❌ 原样透传（`ui.register` 不做前缀化）  |
| `commandBus.execute()`                                                            | 同上一条的对应形态                           | inline 自动加；worker / process 需全限定 |

判断方法：**短名只在交给宿主存储/索引的位置生效**（manifest、`registerHandler`）；
一旦你自己把命令名写进 `slotProps` 或 `execute()`，就没人替你补前缀了。
不确定时**一律写全限定名**：它在四处都能解析。

### 2.3 命名空间守卫

```typescript
const UUID_V7_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\./i;
```

非内核插件注册一个**以别的插件 UUID v7 + `.` 开头**的命令 → 立即抛：

```
[PluginHost] Plugin "..." attempted to register command "..." which belongs to another plugin's UUID namespace.
```

短语义名（`quiz.create`、`vote.create`）**始终允许** —— 它们只是会被自动加上前缀。

### 2.4 重复注册

底层 `CommandBus.registerHandler` 在已存在同名 handler 时**抛错**，不覆盖：

```
Command handler for <type> is already registered.
```

`warnDeprecation('command', commandType)` 同时被调用。

### 2.5 handler 形态

包装层兼容两种写法：

```typescript
// A. 对象形态（类型定义期望的）
await commandBus.registerHandler('poll.create', {
  async execute(cmd) {
    return { ok: true };
  },
});

// B. 裸函数形态（运行时也接受）
await commandBus.registerHandler('poll.create', async (cmd) => ({ ok: true }));
```

两者都不是 → `Invalid command handler for <prefixed>: must be a function or provide execute()`。
handler 抛错会被 `console.error('[Plugin:<pluginId>] Error executing command ...')` 记录后 **rethrow**。

### 2.6 自动清理

`registerHandler` 成功后登记 disposer：`unregisterHandler(prefixed)`。
`unregisterHandler` 同时清 modern 与 legacy 两张表。

---

## 3. `execute` 的实际行为

```typescript
// 包装层伪代码
const rawType = command.type || command.commandType;   // 两种字段名都接受
const prefixedCmd = bindPluginCommand({ ...command, type: resolveType(rawType) }, hostActor);
try { return await commandBus.execute(prefixedCmd); }
catch (e) {
  if (e.message.startsWith('No handler registered for command:')) {
    // 回退到未加前缀的形态 —— 让插件能调内核系统命令（whiteboard.draw / vfs.write_file）
    return await commandBus.execute(bindPluginCommand({ ...command, type: stripPluginCommandPrefix(rawType, ...) }, hostActor));
  }
  throw e;
}
```

```{important} 前缀失败会自动回退裸名
插件调 `commandBus.execute({ type: 'whiteboard.draw', ... })` 时，宿主先尝试
`<manifest.id>.whiteboard.draw`，未命中再回退 `whiteboard.draw`。
所以**调内核命令不需要写裸名特例**。
```

### 3.1 身份不可伪造（`plugin-command.ts`）

```typescript
// 插件发起的命令不能自带身份，也不能自批高危操作。
// 宿主把 actor 改写成插件自己的 actor，并丢掉 metadata.approved。
function bindPluginCommand(command, pluginActorId) {
  ...
  delete metadata.approved;
  return { ...raw, actorId, metadata };
}
```

- `actorId` **一律被覆写**为 `plugin:${manifest.id || pluginId}`。你传什么都会被丢掉。
- `metadata.approved` 被删 —— 插件不能靠自带 `approved: true` 跳过人工审批。
- 空 actor 直接抛：`[Security] Refusing to dispatch a plugin command without a host-assigned actor`。

`createCommand(type, payload, actorId, metadata)` 同样覆写 actor，并清 `metadata.approved`。
底层 `createCommand` 生成 `{ id: uuidv7(), type, actorId, payload, timestamp: Date.now(), metadata: metadata || {} }`。

### 3.2 底层 `execute` 的门禁

1. `actorId` 必须是**非空字符串**（会 `trim()`），否则
   `[Security] Command actorId is required. Empty actors are rejected.`
2. 跑 `interceptor`（见 §4）。
3. 路由：`handlers.get(type) ?? legacyHandlers.get(type)`；都没有 →
   `No handler registered for command: <type>`。
4. 日志：`metadata.silent === true` 或在 `DEFAULT_QUIET_COMMANDS` 里 → 不打 stdout
   （除非 `DEBUG` 含 `commandbus` 或 `DEBUG_COMMAND_BUS=true`）。
   静默名单：`courseware.list` `courseware.get_attempt_raw_data` `whiteboard.query`
   `whiteboard.get_element` `vfs.read_path` `vfs.list_dir`。
5. 按插件维度埋点（Issue #150）：`pluginIdFromActor(actorId) ?? pluginIdFromCommandType(type)`。

---

## 4. 内核拦截器：default-deny（审计 H-1）

`packages/core/kernel/index.ts` 在启动时给 CommandBus 装上鉴权拦截器。
**修复前写成 `if (action) { ... }` 且无 `else` 分支，等价于 default-allow** ——
任何只 `registerHandler()` 而未在 actionRegistry 登记的命令，对任意已登录角色（含 student）**无任何授权检查**。

```{important} action descriptor 是命令的唯一声明式授权点
`capabilityRequired` + `isHighRisk` + `inputSchema` 三者都在其中。
descriptor 缺失 ⇒ 没有任何可执行的授权意图 ⇒ 不能推定为放行。

**不要在拦截器里加豁免名单** —— 豁免只是把缺口从「静默」变成「显式且无人复审」。
修复方式是命令实现方补 `actionRegistry.register()`。
```

拦截器判定顺序：

```
1. getActionByCommandType(command.type)
   ├─ 命中 ────────────────────────────────────────────
   │   2. inputSchema 校验 → [PayloadValidationError] Invalid command payload for <type>: <errors>
   │   3. isAdmin 判定（见下）
   │   4. capabilityRequired && !isAdmin → CapabilityGuard.check
   │        失败 → Error, status=403, code='COMMAND_CAPABILITY_DENIED'
   │   5. isHighRisk && (metadata.approved !== true || actor 以 'plugin:' 开头)
   │        ├─ isAdmin && !pluginSuppliedApproval → 放行并打日志
   │        │   "Command <type> initiated by Administrator (<actor>). Bypassing human approval."
   │        └─ 否则：写入 pending_commands 表 + 发布 approval.requested 事件 + 抛
   │            "[Security] Command <type> requires human approval. It has been queued to pending actions."
   └─ 未命中 ──────────────────────────────────────────
       Error, status=403, code='COMMAND_NOT_REGISTERED'
       "[Security] Command "<type>" has no registered action descriptor and is denied by default.
        Only commands registered via actionRegistry.register() may be dispatched. ..."
```

### 4.1 管理员判定（v0.6.1 审计 C-3 加固）

```typescript
const isAdmin =
  command.actorId === 'role:administrator' ||
  command.actorId === 'admin' ||
  command.actorId === 'usr_admin' ||
  command.actorId === 'admin-demo' ||
  (command.actorId.startsWith('user:') &&
    (command.actorId.endsWith(':administrator') || command.actorId.endsWith(':admin')));
```

**废除裸后缀启发式**：此前 `actorId.endsWith(':admin')` 使 `plugin:@evil:admin`
这类**可自声明的插件 actor** 被判为管理员 —— 跳过能力检查且高危命令免审批。
现要求用户形态 actor（`user:<id>:<role>`，唯一生产者是 `server/middleware/auth.ts` 的 `getActorId`，userId 已消毒）
才允许按角色尾段判定；`plugin:` 及其他前缀一律走能力表。

```{danger} default-deny 与角色无关
管理员也**不能**绕过 descriptor 缺失。`isAdmin` 只影响能力检查与高危审批两处。
```

### 4.2 HTTP 表现

经 `/api/commands` 派发被拒时返回 **HTTP 403**（不是 500）：

```json
{ "success": false, "code": "COMMAND_NOT_REGISTERED", "error": "…" }
```

前端应按 `code` 分支处理，不要把它当作服务端崩溃上报。
早年的 500 会掩盖「插件忘了注册描述符」这一真实的升级兼容问题。

### 4.3 排障工具

```bash
node scripts/plugin-command-audit.mjs    # 列出所有「有 handler 无 action」的命令
```

历史上是 5 个 `classroom.countdown.*`，已在 `server/routes/classroom.ts` 补齐。

---

## 5. 契约：`IEventBusService`

```typescript
export interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
  unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
}

export interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly type: string; // 过去式，如 "lesson.created"
  readonly source: string; // 来源插件/模块
  readonly payload: T;
  readonly timestamp: number;
  readonly correlationId?: string;
}

export type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;
```

### 5.1 `publish` 的 `source` 改写

```typescript
const enrichedEvent = {
  id: event.id || crypto.randomUUID(),
  timestamp: event.timestamp || Date.now(),
  ...event,
  source: event.source ? `plugin:${pluginId}.${event.source}` : `plugin:${pluginId}`,
};
```

```{warning} 注意键序
`source` 在 `...event` **之后**赋值，所以插件传的 `source` 一定会被包装成
`plugin:<pluginId>:<你写的 source>`（注意这里 `pluginId` 是 DB 行 UUID）。
不要依赖自定义 `source` 做路由判定。
```

### 5.2 `subscribe` 的异常吞噬与反查表

包装层把订阅者裹成 `safeSubscriber`，内部 `try/catch` 后 `console.error`：

```
[Plugin:<pluginId>] Error in event subscriber for <eventType>:
```

**异常不会冒泡** —— 事件订阅里抛错不会让插件进入 `ERROR`，只会静默丢日志。
`unsubscribe(eventType, yourFn)` 经 `WeakMap` 反查原始函数 → 包装后的函数，所以**可以直接传你当初的引用**。

### 5.3 通配订阅与去重

```typescript
const subs = subscribers.get(event.type) ?? new Set();
const wildcards = subscribers.get('*') ?? new Set();
const allSubs = [...new Set([...subs, ...wildcards])]; // 同一 handler 两处都注册也只跑一次
```

### 5.4 超时、隔离、递归保护

| 机制                       | 默认值      | 行为                                                                                                                                                                                    |
| :------------------------- | :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handlerTimeoutMs`         | **2000 ms** | 每个订阅者独立的 wall-clock 预算。超时记为 `timedOut` 并**继续派发**，一个慢监听者永远不会卡住整条链                                                                                    |
| 异常隔离                   | —           | 抛错/超时的订阅者被记录并跳过，**不会** reject publish，也不影响其他订阅者                                                                                                              |
| `maxSameTypeDepth`         | **3**       | 同一因果链上同一事件类型最多重入 3 次，超出即丢弃并 `console.warn`：`Dropped re-entrant publish of "<type>" at depth <n>. Check for a subscriber that re-publishes its own event type.` |
| `MAX_SUBSCRIBERS_PER_TYPE` | **50**      | 超出告警 `Possible listener leak — check for re-subscription without unsubscribe.`                                                                                                      |

递归计数用 `AsyncLocalStorage`（而非实例计数器），所以**并发**的同类型 publish
不会被误判为**递归** —— 两个学生同时提交不会触发递归守卫。

### 5.5 启动时机与结果顺序（刻意保留的行为）

```
订阅者仍然被「同步且并发」地启动，只是收敛改为按注册顺序。
```

源码注释解释了原因：如果「await 完一个再启动下一个」，就只有第一个订阅者会在 `publish()` 返回前执行，
会破坏既有语义 —— `worker-runtime` 的多路转发等调用方依赖「同步订阅者在 publish 返回时已全部执行」。
因此保持与旧 `Promise.all` 一致的启动时机，只把**收敛**改成按序：结果顺序确定（便于日志与断言），
慢订阅者之间仍并行、不互相拖累。

```{warning} 超时 ≠ 取消
`NOTE: on timeout the subscriber keeps running in the background; the bus can stop *waiting* for it
but cannot cancel it.`
慢订阅者的作者必须自己防重入（overlapping executions）。
```

`publishDetailed(event): Promise<DispatchResult>` 额外可用（内核 `EventBus` 类上有，`IEventBusService` 端口未声明）：

```typescript
interface DispatchResult {
  eventId: string;
  eventType: string;
  subscriberCount: number;
  outcomes: SubscriberOutcome[]; // { ok, timedOut, durationMs, error? }
  skipped?: 'recursion-limit';
}
```

### 5.6 `EventBusPort` 与 `subscribe` 的返回值

`packages/core/event-bus/index.ts` 的 `EventBusPort` 结构端口（核心 `EventBus` 与前端 `FrontendEventBus` 都满足）：

```typescript
subscribe(eventType: string, handler: EventSubscriber): () => void;   // Phase B4：返回取消订阅函数
```

内核 `EventBus.subscribe` 返回 `() => this.unsubscribe(eventType, subscriber)`。
`unsubscribe` **刻意返回 `void` 而非 boolean** —— `IEventBusService` 声明了该签名，且多条服务端路由
直接把内核 `EventBus` 当这个端口用。要断言删除结果请用 `EventBus.subscriberCount(eventType)`。

`ctx.services.eventBus.subscribe` 的包装层返回 `Promise<void>`（登记 tracker），**拿不到 unsubscribe 函数** ——
靠 `ResourceTracker` 在停用时清理。

---

## 6. 高危命令与人工审批

`ActionDescriptor.isHighRisk === true` 时，非管理员 actor 的命令会被：

1. 写入 `pending_commands(id, command_type, payload, actor_id, created_at)`
2. 发布事件 `{ type: 'approval.requested', source: 'kernel.security', payload: { commandId, commandType }, correlationId: command.id }`
3. 抛错终止本次派发

审批入口是 `/api/approvals`（管理端）。宿主审批路由与 AI 管理员路径使用 `user:` / `agent-system-0` 等**非 `plugin:` actor**。

```{note} 插件 actor 永远不能自批
`pluginSuppliedApproval = actorId.startsWith('plugin:')`；
只要 actor 是插件形态，`metadata.approved` 一律视为无效（且已被 `bindPluginCommand` 删掉）。
```

---

## 7. 能力检查（`ctx.services.capability`）

```typescript
export interface ICapabilityService {
  grant(actorId: string, cap: string): void | Promise<void>; // 插件调用必抛
  revokeAll(actorId: string): void | Promise<void>; // 插件调用必抛
  check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
}
```

匹配语义（`packages/core/capability/guard/capability-guard.ts`）：

```typescript
const [reqRes, reqAct] = requiredCap.split(':');
caps.some((c) => {
  const [res, act] = c.split(':');
  return (res === reqRes || res === '*') && (act === reqAct || act === '*');
});
```

即 **两段 `资源:动作` 通配**：`lesson:*` 匹配 `lesson:write`；`*:*:*` 或 `*` 为超级管理员旁路。

角色回退表（仅当 actor 以 `user:` 开头且尾段是白名单角色时生效）：

| 角色                      | 回退能力                                                                                                                                                                       |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `administrator` / `admin` | 直接 `return true`                                                                                                                                                             |
| `teacher`                 | `lesson:*` `whiteboard:*` `management:*` `quiz:*` `vfs:*` `process:*` `plugin:*` `student:write` `assignment:read` `assignment:submit` `assignment:review` `assignment:manage` |
| `student`                 | `student:write` `lesson:read` `whiteboard:read` `assignment:read` `assignment:submit` `assignment:review`                                                                      |

```{note} 学生为什么不含 lesson:write
`assignment:submit` / `assignment:review` 是学生唯一能发起作业写入的入口，
因此**不含** `lesson:write`（避免学生改课时内容）；命令处理器内部再按 `actorId`
与 `payload.studentId` 校验所属权，防止代交/代评。

```

内置默认授予（构造期）：`user-demo` → `['*:*:*']`；`user-frontend` → 7 个 `*` 通配；
`anonymous` → `[]`；`teacher-demo` / `student-demo` 各一组；`agent-system-0` → 11 项显式能力。

能力清单见 {doc}`capabilities`。

---

## 8. 注册顺序与告警

```{important} 先 actionRegistry.register()，再 commandBus.registerHandler()
顺序反了**不会报错**，但插件加载时会打印：

```

[PluginHost] Plugin "<id>" registered command "<prefixed>" without a matching ActionDescriptor
(commandType: "<raw>"). The kernel default-deny policy will reject this command.
Register one via ctx.services.actionRegistry.register({ commandType: "<raw>", capabilityRequired, inputSchema })
before registering the handler.

```

`warnOnMissingActionDescriptor` 是**尽力而为**：任何异常都不影响 handler 注册结果，
且它会同时检查 `prefixed` / `raw` / `stripped` 三种形态以避免误报。
**它只告警，不改变默认拒绝策略本身。**
```

AI 工具（ActionDescriptor）细节见 {doc}`ai-actions`。

---

## 9. 完整最小示例

```typescript
import type { Manifest } from '@openlearn/plugin-sdk';

export const manifest: Manifest = {
  id: '@myteam/poll',
  version: '1.0.0',
  capabilitiesProposed: ['lesson:write'],
};

export async function activate(ctx) {
  const { commandBus, actionRegistry, eventBus } = ctx.services;
  if (!commandBus || !actionRegistry || !eventBus) return;

  // 1. 描述符先行
  await actionRegistry.register({
    id: 'createPoll',
    commandType: 'poll.create', // 短名 —— 宿主自动加前缀
    description: '在当前课堂创建一个单选题投票',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        question: { type: 'STRING', description: '题干' },
        options: { type: 'ARRAY', description: '选项字符串数组' },
      },
      required: ['question', 'options'],
    },
  });

  // 2. handler
  await commandBus.registerHandler('poll.create', {
    async execute(cmd) {
      const { question, options } = cmd.payload as any;
      // cmd.actorId 已是 'plugin:@myteam/poll'，不可伪造
      await eventBus.publish({
        id: '',
        type: 'poll.created',
        source: 'poll',
        timestamp: 0,
        payload: { question, options },
      });
      return { ok: true };
    },
  });

  // 3. 调内核系统命令（裸名即可，前缀失败会自动回退）
  await commandBus.execute(commandBus.createCommand('whiteboard.draw', {/* ... */}, 'ignored'));
}
```

---

## 取证

| 论断                                                                                                                                           | 来源                                                          |
| :--------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `ICommandBusService` / `IEventBusService` / `ICapabilityService` / `IProcessService` 等契约与 D-05/D-10/D-11/D-13                              | `packages/core/di/interfaces.ts`                              |
| `PlatformCommand` / `CommandMetadata` / `CommandHandler` / `DEFAULT_QUIET_COMMANDS` / `hasHandler`（审计 R-3）/ `registerHandler` 重复即抛     | `packages/core/command-bus/index.ts`                          |
| `bindPluginCommand` 覆写 actor 并删 `metadata.approved`；`pluginActorIdFor`                                                                    | `packages/core/command-bus/plugin-command.ts`                 |
| `resolvePluginCommandType` / `stripPluginCommandPrefix` 及三处规则漂移的历史                                                                   | `packages/core/plugin-host/plugin-namespace.ts`               |
| `wrapCommandBus`：`resolveType`、UUID 命名空间守卫、`execute` 裸名回退、`setInterceptor` 抛错、`createCommand` 清 approved                     | `packages/core/plugin-host/context-builder.ts`                |
| `wrapEventBus`：source 改写、异常吞噬、WeakMap 反查                                                                                            | 同上                                                          |
| default-deny 拦截器、403 + `COMMAND_NOT_REGISTERED` / `COMMAND_CAPABILITY_DENIED`、高危审批与 `pending_commands`、管理员判定（审计 C-3 / H-1） | `packages/core/kernel/index.ts`（`setInterceptor` 段）        |
| `CapabilityGuard.check` 通配匹配、角色回退表、默认授予                                                                                         | `packages/core/capability/guard/capability-guard.ts`          |
| 超时 2000ms / 深度 3 / 通配去重 / 同步启动按序收敛 / 50 订阅者告警 / `EventBusPort.subscribe` 返回取消函数                                     | `packages/core/event-bus/index.ts`                            |
| `warnOnMissingActionDescriptor`（Issue #71）                                                                                                   | `packages/core/plugin-host/context-builder.ts`                |
| 前缀四种位置语义表、`plugin-command-audit.mjs`、§3.3.4                                                                                         | `docs/tutorials/plugin-development-tutorial.md` §3.3.4–§3.3.5 |
