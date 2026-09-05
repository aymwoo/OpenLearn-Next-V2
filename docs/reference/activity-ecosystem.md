# 活动生态（Activity Ecosystem）开发指南

> **适用范围**：`@openlearn/plugin-sdk@3.5.1`
> 活动生态是开放课堂活动的统一扩展机制：官方活动与第三方插件活动使用**完全相同**的描述符 + 生命周期契约，通过同一套 API 注册与发现。本页说明插件如何自定义课堂活动。

---

## 1. 核心概念

每个课堂活动（Quiz、投票、讨论、分组、签到……）都被建模为一个 **Activity Provider**。宿主与插件都通过 `ctx.resolve(IActivityRegistryToken)` 拿到单例 `ActivityRegistry`，再调用 `registerProvider(...)` 注册。

> **复用原则（务必遵守）**：
> - 活动**不**自建上下文。它通过 `ActivityContext` 复用插件已经拿到的服务（`commandBus` / `eventBus` / `actionRegistry` / `capability` / `ai`）与课堂元数据。
> - 活动**不**直接调用业务模块。它复用已有的课堂 Action（即 Command Bus 上的 `commandType`）与 Event Bus，**不新建**任何派发或事件系统。

---

## 2. 快速开始：注册一个活动

```typescript
import {
  IActivityRegistryToken,
  defineActivityProvider,
  type PluginContext,
} from '@openlearn/plugin-sdk';

export async function activate(ctx: PluginContext) {
  const registry = await ctx.resolve(IActivityRegistryToken);

  const myPoll = defineActivityProvider({
    id: 'ext-poll:quick_poll',
    name: '快速投票',
    description: '课堂实时投票，即时展示结果',
    icon: 'BarChart3',
    category: 'engagement',
    permissions: ['lesson:control'],
    supportedRoles: ['teacher', 'student', 'all'],
    supportedDevices: ['desktop', 'tablet', 'mobile', 'all'],
    tags: ['engagement', 'poll'],
    version: '1.0.0',
    provider: 'ext-poll',
    commandType: 'poll.create', // 复用已有课堂命令；缺失时优雅降级
  });

  registry.registerProvider(myPoll);
}
```

---

## 3. `ActivityProviderDescriptor` 字段全解

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | ✅ | 全局唯一 ID，如 `official_quiz` 或 `ext-foo:poll` |
| `name` | `string` | ✅ | 展示名称 |
| `description` | `string` | | 简介 |
| `icon` | `string` | | 图标提示（lucide 名或 emoji） |
| `category` | `ActivityCategory` | ✅ | `assessment` / `engagement` / `collaboration` / `management` / `ai` / `media` / `custom` |
| `permissions` | `string[]` | | 启动活动所需权限（`resource:action` 字符串，见[能力权限矩阵](plugin-capability-matrix)） |
| `supportedRoles` | `ActivityRole[]` | ✅ | 可见/参与角色；`all` = 全员 |
| `supportedDevices` | `ActivityDevice[]` | | `desktop` / `tablet` / `mobile` / `all` |
| `tags` | `string[]` | | 检索标签 |
| `version` | `string` | ✅ | Provider 语义版本 |
| `provider` | `string` | ✅ | 内置活动填 `official`，插件填自身插件 ID |
| `commandType` | `string` | | 复用已有课堂命令（`start` 时执行） |
| `aiAction` | `ActionDescriptor` | | 可选 AI Action 贡献（注册进 ActionRegistry） |
| `aiContext` | `Record<string, unknown>` | | 可选 AI 上下文贡献 |

---

## 4. `ActivityProvider` 生命周期

```typescript
interface ActivityProvider {
  readonly descriptor: ActivityProviderDescriptor;
  readonly state: ActivityLifecycleState;   // registered/initialized/running/paused/finished/disposed
  readonly startedAt?: number;
  initialize(context: ActivityContext): Promise<void> | void;
  start(context: ActivityContext, payload?: Record<string, unknown>): Promise<unknown>;
  pause(context: ActivityContext): Promise<void> | void;
  resume(context: ActivityContext): Promise<void> | void;
  finish(context: ActivityContext): Promise<void> | void;
  dispose(context: ActivityContext): Promise<void> | void;
}
```

状态机：`registered → initialized → running ⇄ paused → finished → disposed`。

每个生命周期阶段都会通过复用的事件总线发布对应事件（见 §6），并在事件发布后调用对应的自定义 hook。

---

## 5. 自定义生命周期行为（`defineActivityProvider`）

`defineActivityProvider(input, hooks?)` 接受**描述符**或完整 options，返回 `BaseActivityProvider` 实例：

```typescript
const provider = defineActivityProvider(
  { id: 'ext-quiz:pop_quiz', name: '突击测验', category: 'assessment',
    supportedRoles: ['teacher', 'student', 'all'], version: '1.0.0', provider: 'ext-quiz' },
  {
    // onStart 完全接管启动行为；不提供时回退到 dispatch commandType
    onStart: async (context, payload) => {
      const cmd = await context.commandBus.createCommand('quiz.create', payload ?? {}, 'ext-quiz', {});
      return context.commandBus.execute(cmd);
    },
    onFinish: (context) => {
      console.log('活动结束');
    },
  },
);
```

`BaseActivityProviderOptions` 支持的可选 hooks：

| Hook | 签名 | 说明 |
|---|---|---|
| `onInitialize` | `(ctx) => void \| Promise<void>` | 自定义初始化 |
| `onStart` | `(ctx, payload?) => unknown \| Promise<unknown>` | 自定义启动；缺省时回退执行 `descriptor.commandType` |
| `onPause` / `onResume` / `onFinish` / `onDispose` | `(ctx) => void \| Promise<void>` | 对应阶段的自定义行为 |

> **优雅降级**：缺省 `start` 会执行 `descriptor.commandType`；若对应命令未安装（可选插件缺失），会捕获 `No handler registered for command` 错误，仅发布 `activity.started` 事件而不抛异常。

---

## 6. 事件名（`ACTIVITY_EVENTS`）

`BaseActivityProvider` 复用的**现有事件总线**上发布的事件（`source` 为 `activity:{id}`）：

| 常量 | 事件类型字符串 |
|---|---|
| `ACTIVITY_EVENTS.REGISTERED` | `activity.registered` |
| `ACTIVITY_EVENTS.INITIALIZED` | `activity.initialized` |
| `ACTIVITY_EVENTS.STARTED` | `activity.started` |
| `ACTIVITY_EVENTS.PAUSED` | `activity.paused` |
| `ACTIVITY_EVENTS.RESUMED` | `activity.resumed` |
| `ACTIVITY_EVENTS.FINISHED` | `activity.finished` |
| `ACTIVITY_EVENTS.DISPOSED` | `activity.disposed` |

---

## 7. `ActivityRegistry` 全方法

通过 `ctx.resolve(IActivityRegistryToken)` 获取：

```typescript
registerProvider(provider: ActivityProvider): void;         // 重复 id 抛异常
unregisterProvider(id: string): boolean;
getProvider(id: string): ActivityProvider | undefined;
listProviders(): ReadonlyArray<ActivityProvider>;
listDescriptors(): ActivityProviderDescriptor[];             // 供工作台目录 / REST
listByRole(role: ActivityRole): ActivityProvider[];           // all 匹配一切
listByCategory(category: ActivityCategory): ActivityProvider[];
startActivity(id, context, payload?, actorId?): Promise<StartActivityResult>;
clear(): void;
```

### `startActivity` 与权限隔离

当 provider 声明了 `permissions`，`startActivity` 会通过复用的 `capability.check(actorId, cap)` 校验——至少命中一个权限才放行，否则抛 `code = 'PERMISSION_DENIED'` 的错误（REST 层对应 403）。

返回值 `StartActivityResult`：`{ provider, dispatched: boolean, result? }`。

---

## 8. 上下文（`ActivityContext` / `ActivityClassroomContext`）

活动接收的 `ActivityContext` 是**只读投影**，与插件 `ctx.services` 结构一致，外加课堂元数据：

```typescript
interface ActivityContext {
  readonly commandBus: ICommandBusService;
  readonly eventBus: IEventBusService;
  readonly actionRegistry: IActionRegistryService;
  readonly capability: ICapabilityService;
  readonly ai: IAIService;
  readonly classroom?: ActivityClassroomContext | null; // { classroomId?, sessionId?, role?, permissions?, lifecycleState?, raw? }
}
```

活动**永远不要自己构造**上下文；宿主与插件都通过 `createActivityContext(opts)` 复用现有服务。

---

## 9. AI 集成（可选）

活动可贡献 AI Action 与 AI Context，全部复用**现有** ActionRegistry / AI 运行时：

- `descriptor.aiAction`：声明后经 `registerActivityAIAction(actionRegistry, descriptor)` 注册为 GenAI 可调用工具。
- `buildActivityAIContext(providers)`：把已注册活动元数据合并进课堂 AI 上下文快照。

---

## 10. 官方活动定义参考

内置官方活动（Quiz、Vote、Poll、Discussion、Grouping、Assignment、Competition、Check-in、Homework）定义于 `packages/activity-ecosystem/default-providers.ts`，是第三方插件的最佳范例——它们与插件走**完全相同的** `BaseActivityProvider` + `registerProvider` 路径。

> 最后更新：2026-08-29
