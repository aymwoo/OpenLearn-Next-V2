# 平台服务速查（`ctx.services` 与 `ctx.resolve`）

> **权威源码**：`packages/core/di/interfaces.ts`（Token 与接口）、`packages/core/plugin-host/types.ts`（`PluginContext`）、
> `packages/core/plugin-host/context-builder.ts`（包装层）、`packages/core/worker-runtime/service-host.ts`（Worker RPC 守卫）

---

## 0. 两个入口，两种权限

| 入口                 | 拿得到什么                                    | 是否需要声明                                                                  | 是否被安全包装                                                  |
| -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ctx.services.<key>` | **9 个**内核服务的 **per-plugin 包装代理**    | 否（已注入）                                                                  | ✅ `createSafeFunction` + `ResourceTracker` + 命名空间/归属校验 |
| `ctx.resolve(token)` | DI 容器里的**原始实例**（或 Worker RPC stub） | Token 对象不受限；**字符串名**必须在 `PLUGIN_RESOLVABLE_TOKEN_NAMES`（31 个） | ⚠ 多数**不经过**插件包装层                                      |

```{danger}
**优先用 `ctx.services.*`。** `ctx.resolve` 拿到的是未经插件包装的裸实例，
意味着你会失去：

- `wrapCommandBus`：命令名前缀化 + `actorId` 覆写为 `plugin:<id>` + `metadata.approved` 剥离；
- `wrapEventBus`：`source` 覆写 + 订阅自动回收；
- `wrapProcessManager`：`taskType` 命名空间前缀 + `kill` 归属校验；
- `wrapAI`：调用方标识注入 + provider 生命周期跟踪；
- `ResourceTracker` 的 `deactivate()` 自动清理。

同一个能力从两个入口走，**行为不一样**。这不是理论差异，是权限差异。
```

````{important}
### 方法签名普遍是 `T | Promise<T>` —— **一律 `await`**

内核接口为了跨 runtime（inline 同步 / worker RPC 异步）统一写成联合返回类型，
例如 `IEventBusService.subscribe(...)` 返回 `EventSubscriber | void | Promise<void>`。

- inline 模式：多为**同步**返回值；
- worker / process 模式：多为 **Promise**。

`await` 一个非 Promise 值在 JS 里合法，所以正确写法是无条件 `await`：

```typescript
await ctx.services.eventBus.subscribe('assignment.submitted', handler);   // ✅
ctx.services.eventBus.subscribe('x', handler);                            // ⚠ inline 能跑，worker 下变成悬空 Promise
```

漏 `await` 在本地（inline）**测试全绿**，装到客户环境（第三方被强制 `process`）后
变成**未处理的 Promise rejection**，且订阅可能已经生效但你拿不到句柄去取消。
````

---

## 1. `ctx.services` 的 9 个成员

```typescript
services: {
  commandBus: ICommandBusService | null;
  eventBus: IEventBusService | null;
  actionRegistry: IActionRegistryService | null;
  capability: ICapabilityService | null;
  processManager: IProcessService | null;
  storage: IStorageService | null;
  ai: IAIService | null;
  pointsDimension: IPointsDimensionRegistry | null;
  pointsLedger: IPointsLedgerService | null;
}
```

````{warning}
### SDK 的 `.d.ts` 与内核类型**不一致**

上表是 `packages/core/plugin-host/types.ts`（内核权威）。
`packages/plugin-sdk/openlearn.d.ts` 里同一个 `PluginContext` 写的是：

```typescript
// openlearn.d.ts（发布给插件作者的类型）
commandBus: ICommandBusService;        // ← 没有 | null
processManager: IProcessService;       // ← 没有 | null
pointsDimension: IPointsDimensionRegistry | null;   // ← 只有这两个有 null
pointsLedger: IPointsLedgerService | null;
```

即 **审计 E-4 的 `T | null` 修复没有同步到 SDK 声明文件**。
后果：`ctx.services.commandBus.xxx()` 在插件里**不会**报「可能为 null」，
但运行时**确实可能是 null**（D-12 降级：`manifest.optional` 里的 Token 版本不兼容时置 null）。

**不要依赖类型检查来找判空点** —— 9 个全部判空。
另注意 SDK 声明里 `pointsDimension` / `pointsLedger` 的注释写了另一半真相：
「Worker 模式插件恒为 null」。
````

---

## 2. 九个服务逐个详解

### 2.1 `ctx.services.commandBus` —— `ICommandBusService`

Token：`@openlearn/core:ICommandBusService`（常量 `ICommandBusServiceToken`）

完整签名见 [命令总线与事件总线](command-and-event.md)。要点回顾：

```typescript
registerHandler<TPayload = any, TResult = any>(
  type: string,
  handler: CommandHandler<TPayload, TResult> | PluginCommandHandlerFn,
): () => void;                                    // 返回反注册函数
execute<TResult = any>(command: PlatformCommand | string, payload?: unknown): Promise<TResult>;
getRegisteredHandlers(): string[];
setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>;
```

- 插件注册 handler 时 `type` 写**短名**，包装层自动加 `<manifest.id>.` 前缀；
  `execute()` 时**必须写全限定名**（详见 command-and-event §2.2 的「四处三前缀」表）。
- `setInterceptor` 是**全局**的：插件装进去的拦截器会影响**所有**命令派发。
  内核自身也用它做 default-deny。非必要不要动它；若动了，务必在 `deactivate()` 里恢复。

### 2.2 `ctx.services.eventBus` —— `IEventBusService`

Token：`@openlearn/core:IEventBusService`

```typescript
publish(event: PlatformEvent): Promise<void>;
subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
```

关键约束（详见 [命令总线与事件总线](command-and-event.md) §5）：

| 约束                       | 值 / 行为                                                |
| -------------------------- | -------------------------------------------------------- |
| `publish` 的 `source`      | 被包装层覆写为 `plugin:<pluginId>.<你写的 source>`       |
| 订阅者抛错                 | **被吞掉**（用 WeakMap 反查记日志），不会中断发布方      |
| `'*'` 通配订阅             | 去重，同类型只回调一次                                   |
| `handlerTimeoutMs`         | **2000ms** —— 超时后**订阅者仍在继续跑**，只是总线不再等 |
| `maxSameTypeDepth`         | **3** —— 同类型事件递归链超过 3 层被截断                 |
| `MAX_SUBSCRIBERS_PER_TYPE` | **50** —— 超出后新增订阅会被拒                           |

```{warning}
没有 `once()` / 没有返回取消函数。取消必须 `unsubscribe(type, 同一个 subscriber 引用)`，
所以**不要把匿名函数直接传进去后再也留不住引用**。
包装层会把订阅登记进 `ResourceTracker`，`deactivate()` 时自动清理 —— 但运行期想临时退订就得自己存引用。
```

### 2.3 `ctx.services.actionRegistry` —— `IActionRegistryService`

Token：`@openlearn/core:IActionRegistryService`

```typescript
register(descriptor: ActionDescriptor): void | Promise<void>;
unregister(id: string): void | Promise<void>;
getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;
getAgentTools(): unknown[] | Promise<unknown[]>;                    // @google/genai functionDeclarations 形态
getActionByToolName(toolName: string): ActionDescriptor | undefined | Promise<...>;
getActionByCommandType(commandType: string): ActionDescriptor | undefined | Promise<...>;
```

详见 [AI Agent 动作声明](ai-actions.md)。三条与本页相关的提醒：

- **`getAgentTools()` 历史上进不过 Agent**：真正生效的清单是 `buildOpenAITools()`；
  只调 `getAgentTools()` 不足以让工具被看见（ai-actions §5）。
- `register()` 的 tool 名会被 `replace(/[^a-zA-Z0-9_\-]/g, '_')` 消毒；
  按名反查要用**消毒后**的名字，`getActionByToolName('my.tool')` 查不到（`.` 已变 `_`）。
- 包装层给描述符加了 `<manifest.id>.` 前缀并额外登记 `__raw_alias`（`exposeToAgent:false`）。

### 2.4 `ctx.services.capability` —— `ICapabilityService`

Token：`@openlearn/core:ICapabilityService`

```typescript
grant(actorId: string, cap: string): void | Promise<void>;
revokeAll(actorId: string): void | Promise<void>;
check(actorId: string, requiredCap: string): boolean | Promise<boolean>;   // 支持通配匹配
```

```{danger}
**`grant` / `revokeAll` 不是「给自己的申请」，是直接改运行时授权表。**
`wrapCapability` 的包装很薄（只做参数安全化），它**没有**拦住插件给
`actorId='user:...'` 提权。所以：

- 正常插件**不需要**碰 `capability`，能力应在 `manifest.capabilities` 里**声明**，
  由宿主在安装/激活时授予（见 [能力清单](capabilities.md)）；
- `revokeAll(actorId)` 会清掉该主体**全部**能力，误传平台 actor 就是事故；
- 想**读**当前上下文是否有权，用 `check(ctx.actorId, cap)` 而不是自己 grant。
```

### 2.5 `ctx.services.processManager` —— `IProcessService`

完整语义（命名空间前缀 `${pluginDbUuid}::${taskType}`、归属校验 B-5、
`restore()` 副作用、interval 不跨重启）见
[配置服务与后台任务](background-and-config.md) §3。此处只留签名：

```typescript
spawn(name: string, taskType: string, payload: unknown, ownerHint?: string): string | Promise<string>;
kill(processId: string): void | Promise<void>;
registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
unregisterHandler(taskType: string): void | Promise<void>;
registerInterval(name: string, intervalMs: number, tickFn: (log: (m: string) => void) => void, ownerHint?: string): string | Promise<string>;
restore(): void | Promise<void>;
getProcessOwner?(processId: string): string | undefined;   // 可选
setPluginOwner?(pluginId: string): void;                   // 可选 —— **包装层不暴露，插件调不到**
```

`ProcessHandler` 五参：`(processId, payload, state, log, updateState) => Promise<void>`。

### 2.6 `ctx.services.storage` —— `IStorageService`

```typescript
get(key: string): Promise<unknown>;      // 不存在返回 null
set(key: string, value: unknown): Promise<void>;
delete(key: string): Promise<void>;      // 不存在时 no-op
```

```{important}
这是**按 `manifest.id` 隔离的 JSON 键值存储**（落 `plugin_storage` 表），不是内核级缓存：

- 没有 `list()` / `keys()` / `exists()` / TTL / 命名空间；想枚举只能自己维护索引键。
- `value` 会被 `JSON.stringify` ⇒ **`Date` 变字符串、`Map`/`Set` 变 `{}`、函数丢失**。
- 键前缀 `config:` **被配置服务的旧库回退占用**（Issue #151 之前配置值就存这儿）。
  别用 `config:` 开头自定义键，可能与 `ConfigService` 的回退读取互相踩到。
- 卸载时数据按 `manifest.id` 清理（对照私有表由 `db.dropAllTables()` 处理）。
```

`ctx.resolve(IStorageServiceToken)` 拿到的是**未包装**的实例 —— 会**丢掉按插件隔离**的语义。
永远用 `ctx.services.storage`。

### 2.7 `ctx.services.ai` —— `IAIService`

```typescript
generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;

// 以下全部是「可选方法」，mock 或未启用 AI 的部署可能缺省 —— 调用前必须 `if (fn)`
registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
unregisterAIContextProvider?(id: string): void;
registerAIPersona?(persona: AIPersonaDefinition): void;
listAIPersonas?(): AIPersonaDefinition[];
unregisterAIPersona?(id: string): void;
```

````{danger}
### `registerAIContextProvider` **只对 inline 插件有效**

接口注释原文：「fn 为服务端闭包（Inline 插件直接传函数），Agent 对话时按 lessonId 调用。
**仅 Inline 插件可用**（Worker 序列化边界无法传递函数）」。

而第三方插件默认被强制降级到 `process` ⇒ **你能 `typeof fn === 'function'`，调用却不生效**。
想让上下文切片生效，只有两条路：① 插件进 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 白名单（
需要管理员同意，并会在启动日志留告警）；② 改用 `ai.skill.provider` 贡献点（可序列化描述符）。

相反，`registerAIPersona` 的参数 `AIPersonaDefinition` **是可序列化静态模板**，
注释明确「Inline / Worker 插件均可注册」，且**同名可覆盖宿主内置角色**。

```typescript
interface AIPersonaDefinition {
  id: string; nameZh: string; nameEn: string;
  instructionZh: string; instructionEn: string; icon?: string;
}
```

`unregisterAIPersona(id)`：内置角色不可注销；**仅注册者可注销自身模板**。
````

`generateText` 委托给数据库里配置的**第三方 OpenAI 兼容 provider**。
插件里**没有** API Key 概念 —— 也没有 `ai:chat` / `ai:completion` 这类能力名（见能力清单）。

### 2.8 `ctx.services.pointsDimension` —— `IPointsDimensionRegistry`

```typescript
registerDimension(spec: PointsDimensionSpec): void;
unregisterDimension(id: string): boolean;     // 审计 D-1 新增；内置维度受保护，插件不可注销
getDimension(id: string): PointsDimensionSpec | undefined;
listDimensions(): PointsDimensionSpec[];
```

```{important}
`unregisterDimension` 是**后补的**。在它之前注册表只有增/查，插件停用后其维度永久留存 ——
`server/routes/grading.ts` 的 `listDimensions()` 会把已停用插件的维度一并计入学生档案雷达。
所以**你的 `deactivate()` 里必须注销自己注册的维度**，别指望 `ResourceTracker` 兜住
（`wrapPointsDimensionRegistry` 的跟踪只对**新增的包装层调用**有效）。
```

`PointsDimensionSpec`：`{ id, name, category: 'builtin'|'plugin', defaultWeight, maxScore?, description?, pluginId? }`。

### 2.9 `ctx.services.pointsLedger` —— `IPointsLedgerService`

```typescript
addPoints(studentId, classId, dimensionId, deltaPoints, reason, pluginId?): Promise<PointLogItem>;
getLogs(studentId: string, classId?: string): Promise<PointLogItem[]>;
getStudentTotalByDimension(studentId, classId, dimensionId): Promise<number>;
getStudentDimensionSummary(studentId, classId): Promise<Record<string, number>>;
```

```{warning}
`addPoints` 的第 6 参 `pluginId` **由包装层填入**（`wrapPointsLedgerService(pointsLedgerService, pluginId, manifest.capabilitiesProposed)`）。
不要自己传 —— 传了会覆盖归属，审计流水里就查不到真实来源插件。
`PointLogItem` = `{ id, studentId, classId, dimensionId, pluginId|null, deltaPoints, reason, createdAt }`。
```

---

## 3. `ctx.resolve` 可解析的其余 Token

完整 31 个白名单（含 `requires` 语法与报错形态）见
[Token / 常量总表](token-reference.md)。按用途分组说明：

### 3.1 与 `ctx.services` 重叠的 7 个

`ICommandBusService`、`IEventBusService`、`IActionRegistryService`、`ICapabilityService`、
`IProcessService`、`IStorageService`、`IAIService` —— **不要 resolve 它们**，理由见 §0。

### 3.2 积分/成绩领域服务（需显式声明才授予 worker 插件）

| Token                                       | 关键方法                                         |
| ------------------------------------------- | ------------------------------------------------ |
| `@openlearn/core:IPointsDimensionRegistry`  | §2.8                                             |
| `@openlearn/core:IPointsLedgerService`      | §2.9                                             |
| `@openlearn/core:ISemesterGradeService`     | `saveSemesterGrade(...)`，写选项见下             |
| `@openlearn/frontend:ISemesterGradeService` | 前端侧同名领域服务（Worker 白名单敏感项，见 §5） |

```typescript
interface SemesterGradeWriteOptions {
  actorId?: string | null; // 'user:<id>:<role>' 或 system，写入成绩历史
  actorRole?: string | null;
  source?: 'manual' | 'plugin' | 'ai' | 'system'; // 默认 'plugin'
  /** 是否允许覆盖教师手动分/缺考标记。默认 false */
  overrideProtected?: boolean;
}
```

```{danger}
`overrideProtected` **默认 false** 是有原因的：插件同步不得静默冲掉教师在学期成绩页的改判。
把它设 `true` 是一个需要产品决策与用户告知的行为变更，不是「让同步更可靠」的技术开关。
```

这三个 Token 在 Worker 模式下**不是默认可用**：`computeAllowedWorkerTokens()` 只在
manifest 的 `requires` / `optional` 精确声明了该 Token，**或** `capabilitiesProposed` 里
声明了 `grades` / `grades:*` / `*`（后端积分对等 `points` 判定同构）时才授予。

### 3.3 引擎门面（返回 `unknown`，别当契约用）

| Token                                             | 唯一方法                                       |
| ------------------------------------------------- | ---------------------------------------------- |
| `@openlearn/core:ILessonEngineService`            | `getRuntime(): Promise<unknown>`               |
| `@openlearn/core:IClassroomRuntimeService`        | `getRuntimeKernel(): Promise<unknown>`         |
| `@openlearn/core:IPresenceEngineService`          | `getPresenceEngine(): Promise<unknown>`        |
| `@openlearn/core:ITeachingCollaborationService`   | `getCollaborationEngine(): Promise<unknown>`   |
| `@openlearn/core:ILearningAnalyticsService`       | `getAnalyticsEngine(): Promise<unknown>`       |
| `@openlearn/core:IAICapabilityService`            | `getCapabilityKernel(): Promise<unknown>`      |
| `@openlearn/core:ICapabilityRuntimeService`       | `getRuntimeKernel(): Promise<unknown>`         |
| `@openlearn/core:IPlatformServiceRegistryService` | `getServiceRegistryKernel(): Promise<unknown>` |

```{warning}
这 8 个门面的源码注释统一写着「**Interface for X service (for tests only)**」，
返回类型全部是 `Promise<unknown>`。它们存在的目的是让宿主/测试拿到内核对象，
**不是给插件的稳定 API**。

对插件作者的正确结论：这些 Token 在白名单里 ≠ 你可以依赖它们的行为。
任何 `as SomeInternalType` 强转出来的调用都在内核重构时静默失效。
优先用下面的具名服务与 `contributes` 贡献点。
```

### 3.4 真正给插件用的具名服务

#### `@openlearn/core:IClassroomCountdownService`

```typescript
getCountdown(lessonId): Promise<ClassroomCountdownDescriptor>;
start(lessonId, duration, label?): Promise<ClassroomCountdownDescriptor>;
pause(lessonId) / resume(lessonId) / reset(lessonId): Promise<ClassroomCountdownDescriptor>;
addTime(lessonId, seconds): Promise<ClassroomCountdownDescriptor>;
```

对应 UI 扩展槽位 `classroom.countdown.widget` / `classroom.countdown.action` /
`student.classroom.countdown`；后者的 `slotProps` 正是 `{ onStart, onPause, onReset, onAddTime }`
（见 [UI 扩展槽位](contributes-slots.md)）。

#### `@openlearn/core:IClassroomLifecycleService`

```typescript
getStage(lessonId): Promise<ClassroomLifecycleStage>;
transitionStage(...): Promise<...>;                 // 见 interfaces.ts
registerStageGuard(owner: string, guard: ClassroomStageGuard): void;
unregisterStageGuard(owner: string): void;
```

```{important}
**Issue #327**：`IClassroomLifecycleService` 与 `IInteractionRuntimeService` 在 Worker 模式下
由宿主提供 **RPC 代理**，因为这两个服务此前在 worker 白名单之外，导致插件调用无响应。
即便如此，它们也**不在** `BASE_WORKER_SERVICE_TOKENS`（9 个）里 ——
需要 manifest 显式声明 `requires`。
```

#### `@openlearn/core:IInteractionRuntimeService`

```typescript
registerActivityProvider(owner: string, descriptor: QuickActivityDescriptor): void;
unregisterActivityProvider(owner: string, id: string): void;
listActivityProviders(): QuickActivityDescriptor[];
```

桥接 `classroom.quick_activity` 槽位。

#### `@openlearn/core:IStageGuardService`

```typescript
registerGuard(guard: StageGuard, owner?: string): () => void;   // 返回注销函数
unregisterGuard(guardId: string, owner?: string): void;
listGuards(): StageGuard[];
checkAccess(ctx: StageGuardContext): Promise<StageGuardResult>;
// StageGuard.canEnterStage(ctx) => Promise<StageGuardResult>
```

#### `@openlearn/core:IAssessmentGraderRegistry`

```typescript
registerQuestionType(...): ...;
unregisterQuestionType(type: string, pluginId?: string): boolean;
clearOwnedQuestionTypes(pluginId: string): number;              // 停用时的批量清理
getQuestionType(type: string): QuestionTypeDefinition<any, any> | undefined;
listQuestionTypes(): IAssessmentQuestionTypeSummary[];
gradeItem(item: AssessmentItemRecord, answer: unknown,
          ctx: Omit<GradeContext, 'maxScore'>): ItemGradeResult;  // 宿主内部使用
```

```{note}
`gradeItem` 注释标明「**宿主内部使用**；题型未注册时返回 `score: null` 进人工队列」。
插件应通过 `registerQuestionType` 参与测评（Issue #183 的三个槽位
`assessment.list.card` / `assessment.attempt.toolbar` / `assessment.stats.card`），
而不是自己调 `gradeItem`。
```

#### `@openlearn/core:ICoursewareRuntimeScriptRegistry`

```typescript
register(owner: string, script: CoursewareRuntimeScript): void;
unregister(owner: string, id: string): void;
clear(owner?: string): void;
list(courseware?: { id?: string; uuid?: string }): IRegisteredCoursewareRuntimeScript[];
listOwners(): string[];
```

课件播放器扩展（槽位 `courseware.viewer.toolbar` / `courseware.viewer.overlay`）。

#### `@openlearn/activity-ecosystem:IActivityRegistry`

`ActivityRegistry`：`register` / `unregister` / `get` / `list` / `listByCategory` /
`listByStage` / `listByDomain` / `listByTag` / `count`。

```{warning}
这是唯一一个**不在 `PLUGIN_RESOLVABLE_TOKENS` 常量数组里**、只以**字符串名**收录的白名单项
（注释原因：定义在 `activity-ecosystem/interfaces.ts`，`import` 它会形成反向依赖）。
⇒ `ctx.resolve<string>('@openlearn/activity-ecosystem:IActivityRegistry')` 可以；
但**没有 SDK 导出的 Token 常量**可 import。名字必须逐字符写对。
```

#### `@openlearn/core:IAuthSessionBridgeService`

```typescript
createSession(user: AuthBridgeUser): Promise<{ token: string; maxAge: number }>;
```

Token 的第三个构造参数是版本 `'1.0.0'`（`new Token<T>(name, '1.0.0')`）。

```{danger}
### 这是本清单里最危险的一个

它**直接签发平台会话 Token**。安全审计报告（PL-? / inline 信任边界条目）明确记录：

> `AuthSessionBridgeService.createSession` 不核对调用方，传入 `role: 'administrator'`
> 就会签发 `token_` 会话。Token 对象路径在 `context-builder.ts` 不做白名单，
> 注释写「必须 import SDK 常量所以天然安全」，而 SDK **导出了这些特权 Token**。

⇒ **只有同时满足两个条件时才该碰它**：
① manifest `requires` 精确声明 `@openlearn/core:IAuthSessionBridgeService`；
② 你的插件跑在**受信任 inline** 白名单内并由管理员知情批准。

HTTP 侧的配套约束（网关会校验①）：`PluginApiResponse.sessionToken` 只有在
`requires` 去掉版本后缀后与会话桥 Token 名**全等**时才会被写成 Cookie，
否则打印 `[PluginApiGateway:SECURITY] ... Cookie rejected.`
（见 [HTTP API 参考](http-api.md) §12）。
```

#### `@openlearn/core:IPluginHost` / `IPluginLifecycleManager` / `IPluginDistributionManager`

`PluginHost` 暴露 `installPlugin` / `installPluginFromZip` / `activatePlugin` / `uninstallPlugin`。

```{danger}
这三个是「**插件管理插件**」的特权面。它们**在字符串白名单里**（`ctx.resolve` 能拿到），
但 `IPluginHost` **已被移出 Worker 基础白名单**（2026-10-04），原因（安全文档 §2.5 原文）：

> 沙箱化插件本不该能安装并激活**其他**插件（等于给自己留一个能在自身被卸载后继续存活的后门）。
> 内置插件确实需要它，但内置默认 inline 模式，不经过 worker 白名单，因此移除无功能影响。

⇒ 只有在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 名单里的插件才有实际用途。
普通 ZIP 插件解析它会失败或拿到受限 stub。**不要在通用插件里依赖它。**
```

#### `@openlearn/core:IDatabase`

见 §4（单独一节，因为它有 inline / worker 两套完全不同的边界）。

### 3.5 白名单**之外**的内部 Token（resolve 会被拒）

```text
@openlearn/core:ICapabilityGovernanceService
@openlearn/core:INetworkProxyService
@openlearn/core:IPluginCapabilityGateway
@openlearn/core:IPluginRuntimeComposition
@openlearn/core:IUnifiedExtensionRegistry
```

```{note}
`INetworkProxyService` 有点绕，值得单独说：

- 它**不在** `PLUGIN_RESOLVABLE_TOKEN_NAMES`（字符串 resolve 被拒）；
- 但它**在** `BASE_WORKER_SERVICE_TOKENS`（Worker 基础白名单第 9 项）。

原因是它的真实消费方是**宿主自己的 RPC 转发层**：`ServiceHost.handleInvoke` 里有一段
`if (msg.token === '@openlearn/core:INetworkProxyService')` 的特判分支，
把 worker 插件的出站 `fetch` 转交给宿主代理。

⇒ **出站网络不是靠 resolve 一个服务拿到的**，而是靠 `manifest.network.outbound` 域名允许名单
+ 运行时 `fetch`（`process` 模式由 `plugin-net-preload.cjs` 拦截原始 socket/UDP/DNS，
`fetch`/`http.request` 仅放行 `plugin_network_grants` 中已批准的域名）。
```

---

## 4. `IDatabase`：同一个 Token，两种世界

```typescript
// 插件侧统一写法
const db = await ctx.resolve<IDatabase>(IDatabaseToken); // SDK 类型 SqliteDatabase
```

SDK 声明的 `SqliteDatabase` 是一个**自包含的窄接口**（刻意不引 `better-sqlite3` 类型）：

```typescript
interface SqliteStatement {
  run;
  get;
  all;
  iterate;
} // 参数/返回全为 unknown
interface SqliteDatabase {
  prepare(sql): SqliteStatement;
  transaction<T>(fn: T): any;
  exec(sql): unknown;
  pragma(source, options?): unknown;
  close(): void;
}
```

| 模式                 | 拿到的是什么                                                 | 守卫                                                             | 可用方法                                                                             |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `inline`             | `kernelContainer.db` —— **平台主库的 better-sqlite3 原句柄** | ⚠ 语句级守卫在 `ServiceHost` 里，**inline 路径不经过它**         | `prepare` / `transaction` / `exec` / `pragma` / `close` 全都在                       |
| `worker` / `process` | RPC stub                                                     | `ServiceHost.assertDatabaseAccessAllowed(sql)` **逐条 SQL 拦截** | **只有 4 个** RPC 方法：`exec` / `prepareAndRun` / `prepareAndGet` / `prepareAndAll` |

```{danger}
### 两条各自会咬人的结论

1. **worker 侧没有 `transaction` / `pragma` / `iterate` / `close`。**
   `ctx.resolve<IDatabaseToken>` 后写 `db.transaction(fn)()` ⇒ Worker stub 上不存在该 RPC
   （历史缺陷：早先连 `exec` 都没转发，worker 插件调 `exec` 报
   `rawDb.exec is not a function`，后补齐）。
   需要事务就退回 `ctx.db`（只有 inline 有事务，见 [数据库与迁移](database.md) §6）。

2. **inline 侧拿的是主库原句柄，`ctx.db` 那套 `assertPluginSqlAllowed` 前缀守卫管不到它。**
   安全审计在 inline 信任边界条目里正是把这一点作为风险记录的（同一条目还记录了
   `createSession` 不核对调用方）。
   ⇒ 「我在 `ctx.db.prepare()` 里不能碰 `users` 表」**不等于**
   「`resolve(IDatabaseToken)` 后也不能碰」。区别只在**隔离模式**。
   这不是给你留的旁门：inline 只对受信任插件开放，用这个口子等于替管理员签豁免。
```

平台文档对「插件能否访问核心表」曾长期自相矛盾（RBAC 表把 Plugin 的 SQLite 访问标 ❌），
2026-10-26 已复核统一为：**能拿句柄，边界在语句级守卫**（worker 路径）。
核心表 82 张的清单与「40 张硬禁」的对照，见仓库
`docs/reference/platform-data-tables.md`。

---

## 5. 前端 Worker 插件的 Token 白名单（与后端**不同的一套**）

`src/plugin-host/allowed-tokens.ts` 是后端 `worker-manager.ts` 的**前端重新实现**
（后端依赖 `node:worker_threads` / `fs` / `path` / `better-sqlite3`，浏览器打包会直接失败，
故保持**同名常量、同名函数、相同判定规则**；**规则变更时必须两端同步修改**）。

| 语义       | 后端（权威）                                                   | 前端                                              |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------- |
| 基础白名单 | `BASE_WORKER_SERVICE_TOKENS`（9 个）                           | `BASE_FRONTEND_WORKER_SERVICE_TOKENS`（**4 个**） |
| 动态计算   | `computeAllowedWorkerTokens()`                                 | 同名函数                                          |
| 门禁校验   | `service-host.ts` `handleInvoke` Barrier 1                     | 同                                                |
| 注入点     | `worker-manager.ts` 传给 `new ServiceHost(..., allowedTokens)` | `browser-worker-manager.ts`                       |

```typescript
// 前端基础白名单（所有 Worker 插件默认可用，均为 UI/事件/本地存储类基础设施，不含业务写操作）
BASE_FRONTEND_WORKER_SERVICE_TOKENS = [
  '@openlearn/frontend:IFrontendAPI',
  '@openlearn/frontend:ISocketService',
  '@openlearn/frontend:IUIService',
  '@openlearn/frontend:IStorageService',
];
// 敏感领域服务：必须显式声明
SENSITIVE_FRONTEND_SERVICE_TOKENS = ['@openlearn/frontend:ISemesterGradeService'];
SENSITIVE_CAPABILITY_NAMES = ['grades']; // 授予 'grades' / 'grades:*' / '*'
```

`computeAllowedWorkerTokens(manifest, requestedTokens?)` 三条规则：

1. 起点是基础白名单；
2. 敏感领域服务仅当 `requires` / `optional` **精确声明**了该 Token，
   **或** `capabilitiesProposed` 声明了对应 capability 时才加入；
3. 传了 `requestedTokens` 时**取交集** —— 调用方能请求的永远只是授权集的子集。

```{warning}
判定用 `normalizeDepEntry()` 剥掉版本范围后做**全等比较**（B-2 修复）。
修复前用 `dep.includes(tokenName)` 子串匹配，manifest 写
`requires: ['@evil/x:MyISemesterGradeServiceThing']` 就能命中 `ISemesterGradeService`
拿到写学期成绩的权限。

⇒ 你的 `requires` 条目必须逐字符正确；拼错不会更宽，只会**拿不到**。
```

**威胁模型 T-FE-01**（该文件原文）：浏览器端插件只要在 manifest 声明任意一条 capability，
就能 `ctx.resolve()` 到容器内任意服务并调用其任意方法（包括写成绩等敏感领域服务）——
所以拦截点放在 **RPC 入口最前面**，未命中即拒绝。

前端 Worker 可用的 4 个 Token 对应能力，与 ZIP 插件 iframe 沙箱的 10 个桥接操作
是**两套不同的东西**（后者见 [前端沙箱](frontend-sandbox.md)）。

---

## 6. 选型建议（决策表）

| 你想做的事                  | 用什么                                                             | 不要用                                                   |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 读写插件私有表              | `ctx.db.ensureTable` / `ctx.db.table`                              | `resolve(IDatabaseToken)`                                |
| 简单 KV（配置外的运行数据） | `ctx.services.storage`                                             | 自建表                                                   |
| 精细跨表联查 / 读写平台表   | `resolve(IDatabaseToken)`（**先确认隔离模式与守卫差异**）          | 假设和 `ctx.db` 一样受限                                 |
| 声明式默认设置页            | `manifest.configuration.properties` + `ctx.config`                 | `plugin_storage` 的 `config:` 前缀                       |
| 触发一次业务动作            | `ctx.services.commandBus.execute('<manifest.id>.<短名>', payload)` | 裸 `fetch('/api/...')`                                   |
| 被 AI Agent 调用            | `ctx.services.actionRegistry.register(...)`                        | 只在前端注册按钮                                         |
| 长任务                      | `ctx.services.processManager.spawn` + `registerHandler`            | `http` handler 里等                                      |
| 周期任务                    | `processManager.registerInterval`                                  | 裸 `setInterval`                                         |
| 自定义评分维度              | `pointsDimension.registerDimension`（+ `deactivate` 注销）         | 改平台内置维度                                           |
| 出站 HTTP                   | `manifest.network.outbound` + 运行时 `fetch`                       | `resolve(INetworkProxyServiceToken)`（不在字符串白名单） |
| 签发会话 Cookie             | `PluginApiResponse.sessionToken` + `requires` 声明会话桥           | 自己 `createSession()`（除非确有必要且受信任）           |
| 通知其他插件                | `eventBus.publish({ type, source, payload })`                      | 直接调对方服务实例                                       |

---

## 7. 交付自检清单

- [ ] 9 个 `ctx.services.*` 全部判空后再用
- [ ] 所有 `void | Promise<void>` 形态的调用都 `await`
- [ ] 只用 `ctx.services.*`，没有 `resolve` 这 7 个重叠 Token
- [ ] 没有 `resolve(IPluginHostToken)` / `IPluginLifecycleManager` / `IPluginDistributionManager`
- [ ] 没有尝试 `resolve('@openlearn/core:INetworkProxyService')` 等 5 个白名单外 Token
- [ ] 没有把 8 个「引擎门面」的 `Promise<unknown>` 强转成内部类型来调方法
- [ ] Worker 插件若需要 `ISemesterGradeService` / 积分两服务，`requires` 或 `capabilitiesProposed` 已精确声明
- [ ] 用 `IDatabase` 前确认了自己的隔离模式（§4 的两种世界）
- [ ] 前端 Worker 插件只用了 4 个基础 Token（+ 声明后才有的敏感 Token）
- [ ] `eventBus.subscribe` 保存了 subscriber 引用，以便运行期 `unsubscribe`
- [ ] `pointsDimension.registerDimension` 在 `deactivate()` 里对应 `unregisterDimension`
- [ ] `capability.grant` / `revokeAll` 没有出现在插件代码里
- [ ] 需要 AI 上下文切片时确认了插件是受信任 inline，否则改用 `ai.skill.provider`
- [ ] 会话桥使用符合 §3.4 的两条件；否则不返回 `sessionToken`

---

## 8. 取证

| 论断                                                                                                             | 来源                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PluginContext` 的 `services` 9 键 + 全为 `T \| null`（审计 E-4 / D-12）                                         | `packages/core/plugin-host/types.ts` + 其 E-4 注释                                                                                                                                                                                                         |
| SDK 声明只给 `pointsDimension`/`pointsLedger` 标了 `null`                                                        | `packages/plugin-sdk/openlearn.d.ts` 的 `interface PluginContext`                                                                                                                                                                                          |
| 「Worker 模式插件恒为 null」注释                                                                                 | 同上两条成员注释                                                                                                                                                                                                                                           |
| `IEventBusService` 三方法签名                                                                                    | `packages/core/di/interfaces.ts` §2                                                                                                                                                                                                                        |
| `IActionRegistryService` 六方法（含 `getAgentTools` 的 genai 形态说明、D-11 收紧）                               | 同上 §3                                                                                                                                                                                                                                                    |
| `ICapabilityService` 三方法                                                                                      | 同上 §4                                                                                                                                                                                                                                                    |
| `IProcessService` 全签名（含两个可选方法与 `ownerHint`）                                                         | 同上 §5                                                                                                                                                                                                                                                    |
| `IStorageService` get/set/delete 与 null/no-op 语义                                                              | 同上 §6                                                                                                                                                                                                                                                    |
| `IAIService`：`generateText` + 5 个可选方法；`registerAIContextProvider` 仅 Inline；`registerAIPersona` 可序列化 | 同上 §7 + `AIPersonaDefinition`                                                                                                                                                                                                                            |
| `IPointsDimensionRegistry.unregisterDimension` 与 D-1 注释                                                       | `packages/core/di/interfaces.ts`                                                                                                                                                                                                                           |
| `PointsDimensionSpec` / `PointLogItem` 字段                                                                      | 同上                                                                                                                                                                                                                                                       |
| `IPointsLedgerService` 四方法                                                                                    | 同上                                                                                                                                                                                                                                                       |
| `ISemesterGradeService.saveSemesterGrade` + `SemesterGradeWriteOptions.overrideProtected` 默认 false             | 同上                                                                                                                                                                                                                                                       |
| 8 个「引擎门面」均为 `getRuntime()/getRuntimeKernel()/...: Promise<unknown>` 且注释 "(for tests only)"           | `packages/core/di/interfaces.ts` ILessonEngineService / IClassroomRuntimeService / IPresenceEngineService / ITeachingCollaborationService / ILearningAnalyticsService / IAICapabilityService / ICapabilityRuntimeService / IPlatformServiceRegistryService |
| `IClassroomCountdownService` 6 方法                                                                              | 同上                                                                                                                                                                                                                                                       |
| `IClassroomLifecycleService` 4 方法                                                                              | 同上                                                                                                                                                                                                                                                       |
| `IInteractionRuntimeService` 3 方法                                                                              | 同上                                                                                                                                                                                                                                                       |
| `IStageGuardService` 4 方法 + `StageGuard.canEnterStage`                                                         | 同上                                                                                                                                                                                                                                                       |
| `IAssessmentGraderRegistry` 5+1 方法（`gradeItem` 宿主内部使用）                                                 | 同上                                                                                                                                                                                                                                                       |
| `ICoursewareRuntimeScriptRegistry` 5 方法                                                                        | 同上                                                                                                                                                                                                                                                       |
| `ActivityRegistry` 9 方法                                                                                        | `packages/core/lesson-engine/activity-registry.ts`                                                                                                                                                                                                    |
| `IAuthSessionBridgeService.createSession` 与 Token 版本 `'1.0.0'`                                                | `packages/core/di/interfaces.ts`                                                                                                                                                                                                                           |
| `createSession` 不核对调用方 / Token 对象路径不做白名单                                                          | 安全审计 inline 条目（repomix L14900）                                                                                                                                                                                                                     |
| `IPluginHost` 移出 Worker 白名单（2026-10-04）与「后门」理由                                                     | `docs/architecture/security-permissions.md` §2.5                                                                                                                                                                                                           |
| `BASE_WORKER_SERVICE_TOKENS` 9 个成员（含 `INetworkProxyService`）                                               | `packages/core/worker-runtime/worker-manager.ts`                                                                                                                                                                                                           |
| `PLUGIN_RESOLVABLE_TOKENS` 30 项 + `PLUGIN_RESOLVABLE_TOKEN_NAMES` 追加 activity 名字（审计 E-2）                | `packages/core/di/interfaces.ts` 白名单段及其注释                                                                                                                                                                                                          |
| `INetworkProxyService` 不在字符串白名单但在 Worker 基础白名单                                                    | 上述两处常量 + `service-host.ts` 的 `msg.token === '@openlearn/core:INetworkProxyService'` 分支                                                                                                                                                            |
| `assertDatabaseAccessAllowed` 属 `ServiceHost`（worker RPC 侧）                                                  | ``packages/core/worker-runtime/service-host.ts`→`db`（L871） / L129903                                                                                                                                                                                     |
| Worker IDatabase RPC 仅 `exec`/`prepareAndRun`/`prepareAndGet`/`prepareAndAll`                                   | `service-host.ts` IDatabase 分支的 `msg.method` 判定                                                                                                                                                                                                       |
| 历史缺陷：worker stub 缺 `exec` 转发（`rawDb.exec is not a function`）                                           | 变更日志条目（repomix L414757）                                                                                                                                                                                                                            |
| inline `IDatabase` 为原句柄、不经 worker 守卫                                                                    | `docs/reference/platform-data-tables.md` 引言 + 安全审计 inline 条目                                                                                                                                                                                       |
| 「能拿句柄，边界在语句级守卫」统一结论（2026-10-26 复核）                                                        | `docs/reference/platform-data-tables.md` ✅ 段落                                                                                                                                                                                                           |
| 核心表 82 张 / 40 张硬禁                                                                                         | `docs/reference/platform-data-tables.md`、`plugin-trust-boundary.md` §2.3                                                                                                                                                                                  |
| `SqliteDatabase` 自包含窄接口（避免暴露 better-sqlite3 类型）                                                    | `packages/core/di/interfaces.ts` 注释                                                                                                                                                                                                                      |
| 前端白名单是后端的前端重实现及其四条对应关系表                                                                   | `src/plugin-host/allowed-tokens.ts` 文件头                                                                                                                                                                                                                 |
| `BASE_FRONTEND_WORKER_SERVICE_TOKENS` 4 项 / `SENSITIVE_*`                                                       | 同上                                                                                                                                                                                                                                                       |
| `computeAllowedWorkerTokens` 三规则 + 取交集                                                                     | 同上                                                                                                                                                                                                                                                       |
| B-2 子串匹配可被 `MyISemesterGradeServiceThing` 绕过                                                             | 同上 `normalizeDepEntry` 注释                                                                                                                                                                                                                              |
| 威胁模型 T-FE-01                                                                                                 | 同上文件头                                                                                                                                                                                                                                                 |
| 前端 Token 字符串值                                                                                              | `src/plugin-host/types.ts` 的 5 个 `*_TOKEN` 常量                                                                                                                                                                                                          |
| Issue #327 两个课堂服务的 Worker RPC 代理                                                                        | `docs/` Issue #327 条目 + `plugin-context` §4                                                                                                                                                                                                              |
| 事件总线常量 2000 / 3 / 50 与「超时后订阅者继续跑」                                                              | `packages/core/plugin-host`（见 [命令总线与事件总线](command-and-event.md) §5）                                                                                                                                                                            |
