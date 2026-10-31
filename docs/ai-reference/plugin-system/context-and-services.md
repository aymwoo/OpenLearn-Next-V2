# 上下文与服务

**结论先行**：`ctx` 有 **16 个字段**（9 服务 + 7 直接能力），9 个服务的类型全部是 `T | null`；
Token 有 **32 个值导出**但**只有 31 个可解析**，且 `IDatabase` 必须用 Token 对象解析（不能按名字）。

---

## 1. `PluginContext` 全字段（后端）

```ts
// packages/core/plugin-host/types.ts → PluginContext（L227）
interface PluginContext {
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
  };
  pluginId: string;               // ⚠ 是 DB 行 UUID，不是 manifest.id
  manifest: Manifest;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  db: PluginDatabaseAPI;
  log: IPluginLogger;
  contributions: ContributionAccessor;
  config: IConfigService;
  http: IPluginHttpRouter;
  i18n: PluginI18nAPI;
  require(moduleName: string): any;
}
```

> ⚠️ **SDK 的 `.d.ts` 与本文件不一致**：`packages/plugin-sdk/openlearn.d.ts` 的 `PluginContext.services`（L455-468）
> 声明为非空。**以内核类型（`T | null`）为准** —— 这是 `docs/agent/facts-ledger.md` 裁决 #15。
> 按非空类型写代码会在 `manifest.optional` 降级时踩空指针。

### 1.1 `pluginId` vs `manifest.id`

| 用途 | 用哪个 | 证据 |
| --- | --- | --- |
| 命令命名空间前缀 | `manifest.id` | `plugin-namespace.ts`（L30-43 注释） |
| `db.table()` 表前缀 | 由宿主计算，**不要自己拼** | `types.ts`（L254-256） |
| 前端 `frontendApi.post('/api/plugins/:id/...')` | DB id（`ctx.pluginId`） | `plugin-host.ts`（L627） |
| 扩展点 `slotProps.commandType` | `manifest.id` 全限定 | 见 [extension-points-and-slots.md](extension-points-and-slots.md) §2.2 |

```ts
// 唯一正确写法
const fullType = `${ctx.manifest.id}.lab_seat.check_in`;
```

---

## 2. 九个服务（逐个签名）

### 2.1 `commandBus` — `ICommandBusService`

```ts
execute<T extends PlatformCommand>(command: T): Promise<unknown>;
registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;
unregisterHandler(commandType: string): void | Promise<void>;
createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata):
  PlatformCommand<T> | Promise<PlatformCommand<T>>;
setInterceptor(interceptor: (c: PlatformCommand) => Promise<void>): void | Promise<void>;
registerLegacyHandler?  // @deprecated
```

`CommandHandler` **必须是对象**：`{ execute(command) { ... } }`。传裸函数在 worker/process/test-kit 下报
`handler.execute is not a function`（inline 兼容裸函数，但不要依赖）。

证据：`openlearn.d.ts → ICommandBusService（L144）`、`CommandHandler（L104）`。

### 2.2 `eventBus` — `IEventBusService`

```ts
publish(event: PlatformEvent): Promise<void>;
subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
```

- **没有 `Disposable` 返回值** —— 必须自己保存 handler 引用才能退订；
- 宿主在停用时自动退订，但**重复激活**会叠加（同一模块级变量被二次赋值），模块级函数需自行幂等；
- `EventSubscriber = (event: PlatformEvent) => void | Promise<void>`。

证据：`openlearn.d.ts`（L161-165）。

### 2.3 `actionRegistry` — `IActionRegistryService`

```ts
register(descriptor: ActionDescriptor): void | Promise<void>;
unregister(id: string): void | Promise<void>;
getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;
getAgentTools(): unknown[] | Promise<unknown[]>;
getActionByToolName(toolName: string): ... ;
getActionByCommandType(commandType: string): ... ;
```

`ActionDescriptor` 五个必填字段：

```ts
{ id, commandType, description, inputSchema, capabilityRequired }
// 可选：isHighRisk?: boolean（人工审批）；exposeToAgent?: boolean（默认 true）
```

`inputSchema` 类型上是 `unknown`，但**会被内核校验**，且只认全大写类型名（`'OBJECT'/'ARRAY'/'STRING'/'NUMBER'/'BOOLEAN'`）；
写成标准 JSON Schema 的小写 `'object'` 会被静默跳过，`required` 完全失效。校验器与调用点见
`packages/core/kernel/index.ts` L689-749 与 L303-314，完整对照表见
[development/api-reference.md §4.3](../development/api-reference.md)。
`exposeToAgent` 与 `isHighRisk` **正交**：前者管「是否进 AI 工具箱」，后者管「是否需人工审批」。

### 2.4 `capability` — `ICapabilityService`

```ts
grant(actorId: string, cap: string): void | Promise<void>;
revokeAll(actorId: string): void | Promise<void>;
check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
```

第三方插件**不应**调用 `grant`（等于自授权）；它存在是给内核与管理员流程用的。

### 2.5 `processManager` — `IProcessService`

```ts
spawn(name, taskType, payload, ownerHint?): string | Promise<string>;
kill(processId: string): void | Promise<void>;
registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
unregisterHandler(taskType: string): void | Promise<void>;
registerInterval(name, intervalMs, tickFn, ownerHint?): string | Promise<string>;
restore(): void | Promise<void>;
```

| 方法 | 门禁 | 说明 |
| --- | --- | --- |
| `registerHandler` / `registerInterval` | 需 `task:register` | 否则 `checkMethodPolicy` 拒绝 |
| `restore()` | 需 `task:register` | 它会重放**所有插件**的 running 进程（无 owner 过滤），故单独设门 |
| `spawn` | 需 `process:write`（命令侧） | `process` 沙箱下子进程被禁 |

证据：`packages/core/plugin-host/method-policy.ts`（L249-263）。

### 2.6 `storage` — `IStorageService`

```ts
get(key: string): Promise<unknown>;
set(key: string, value: unknown): Promise<void>;
delete(key: string): Promise<void>;
```

后端按 `plugin_id` 隔离（`plugin_storage` 表）。前端 `storageService` 是**同步字符串 KV**
（`types.ts` L341-346），两者签名不同，别混用。

### 2.7 `ai` — `IAIService`

```ts
generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
registerAIPersona?(persona): void;
listAIPersonas?(): AIPersonaDefinition[];
unregisterAIPersona?(id): void;
registerAIContextProvider?(id, fn: (lessonId: string | null) => string | null): void;
unregisterAIContextProvider?(id): void;
```

`generateText` 需 `ai:invoke` 能力（`CAP_AI_INVOKE`）。
标注 `?` 的 5 个方法在 `IAIService` 接口上是**可选成员**，老版本宿主不实现它们 ——
调用前用 `typeof ctx.services.ai.registerAIPersona === 'function'` 判定，直接调会 `TypeError`。

### 2.8 `pointsDimension` / `pointsLedger`

```ts
// 维度注册表
registerDimension(spec: PointsDimensionSpec): void;
unregisterDimension(id: string): boolean;   // builtin 受保护
getDimension(id): PointsDimensionSpec | undefined;
listDimensions(): PointsDimensionSpec[];

// 流水
addPoints(studentId, classId, dimensionId, deltaPoints, reason, pluginId?): Promise<PointLogItem>;
getLogs(studentId, classId?): Promise<PointLogItem[]>;
getStudentTotalByDimension(studentId, classId, dimensionId): Promise<number>;
getStudentDimensionSummary(studentId, classId): Promise<Record<string, number>>;
```

这两个在 **worker 模式恒为 `null`**（`openlearn.d.ts` L464-467 注释），`process` 同样需能力授权。

---

## 3. Token：三个数字，别混

| 口径 | 数量 | 来源 |
| --- | --- | --- |
| SDK **值导出**的 Token 对象 | **32** | `packages/plugin-sdk/index.ts` 的 `export { …Token }` |
| 可按 **Token 对象** resolve | **30** | `packages/core/di/interfaces.ts → PLUGIN_RESOLVABLE_TOKENS`（L946） |
| 可按 **名字字符串** resolve | **31** | 同上 `PLUGIN_RESOLVABLE_TOKEN_NAMES`（+`@openlearn/activity-ecosystem:IActivityRegistry`） |

两个陷阱（都有确定解释，不是 bug）：

1. **`IActivityRegistryToken`** —— 有 Token 对象，但白名单里只有**名字字符串**
   （`@openlearn/activity-ecosystem:IActivityRegistry`），拿对象 resolve 会被拒。**按名字 resolve 可行。**
2. **`INetworkProxyServiceToken`** —— 导出但**在主进程完全不可解析**，按名字 resolve 也报错。
   原因：它是 **沙箱专用服务**，注册点在子进程 RPC 拦截器而非主进程 DI 注册表 ——
   `packages/core/worker-runtime/service-host.ts` L769-770 以
   `msg.token === '@openlearn/core:INetworkProxyService'` **按字符串**拦截并转发到宿主代理；
   它同时位列 `packages/core/worker-runtime/worker-manager.ts → BASE_WORKER_SERVICE_TOKENS`（L77-87）。
   所以：**只在 `process` / `worker` 运行时内可用，`inline` 下反而拿不到**。
   这与 `ctx.config` 恰好相反（`ctx.config` 只在 `inline` 有）。

**推论**：`PLUGIN_RESOLVABLE_TOKENS` 描述的是**主进程可解析集**，不是「插件在任意模式下可用的集」。
判断某个 Token 能不能用，必须分模式看：主进程集（30/31）+ 沙箱集（9 个 `BASE_WORKER_SERVICE_TOKENS`）。

### 3.1 常用 Token 的标识符（resolve 失败时对照）

| Token | 标识符 |
| --- | --- |
| `ICommandBusServiceToken` | `@openlearn/core:ICommandBusService` |
| `IEventBusServiceToken` | `@openlearn/core:IEventBusService` |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` |
| `ICapabilityServiceToken` | `@openlearn/core:ICapabilityService` |
| `IProcessServiceToken` | `@openlearn/core:IProcessService` |
| `IStorageServiceToken` | `@openlearn/core:IStorageService` |
| `IAIServiceToken` | `@openlearn/core:IAIService` |
| `IDatabaseToken` | `@openlearn/core:IDatabase` |
| `ISemesterGradeServiceToken` | `@openlearn/core:ISemesterGradeService` |
| `IPointsDimensionRegistryToken` | `@openlearn/core:IPointsDimensionRegistry` |
| `IPointsLedgerServiceToken` | `@openlearn/core:IPointsLedgerService` |
| `IClassroomLifecycleServiceToken` | `@openlearn/core:IClassroomLifecycleService` |
| `IClassroomCountdownServiceToken` | `@openlearn/core:IClassroomCountdownService` |
| `IAssessmentGraderRegistryToken` | `@openlearn/core:IAssessmentGraderRegistry` |
| `IStageGuardServiceToken` | `@openlearn/core:IStageGuardService` |
| `ICoursewareRuntimeScriptRegistryToken` | `@openlearn/core:ICoursewareRuntimeScriptRegistry` |
| `IInteractionRuntimeServiceToken` | `@openlearn/core:IInteractionRuntimeService` |
| `IActivityRegistryToken` | `@openlearn/activity-ecosystem:IActivityRegistry`（只能按名字） |

完整 31 条：`openlearn-next docs/agent/contracts/tokens.json`。

### 3.2 跨插件服务共享（三步，缺一即错）

```ts
// ① 提供方：定义 Token 并导出
export const ILabSeatServiceToken = new Token<ILabSeatService>('@aymwoo/plugin-lab-seat:ILabSeatService');

// ② 提供方 manifest 声明
"provides": ["@aymwoo/plugin-lab-seat:ILabSeatService"]

// ③ 消费方 manifest 声明 + 解析
"requires": ["@aymwoo/plugin-lab-seat:ILabSeatService@^0.6.0"]
const svc = await ctx.resolve(ILabSeatServiceToken);
```

- 缺 `provides` ⇒ `ctx.provide()` 直接抛错；
- 提供方未 `ACTIVE` ⇒ 消费方激活被拒；
- `requires` 版本不匹配 ⇒ `SemverMismatchError`（携带期望/实际版本）。

真实样本：`[P] src/index.ts`（L44-52）与 manifest `provides`（L113-115）。

---

## 4. `db: PluginDatabaseAPI`

```ts
ensureTable(tableName: string, schema: string): Promise<void>;    // 异步，必须 await
table(tableName: string): string;                                // 同步，返回带前缀表名
dropAllTables(): Promise<void>;                                  // 卸载时宿主自动调
migrate(targetVersion: number, upgradeFn: (db) => Promise<void> | void): Promise<void>;
```

| 事实 | 值 |
| --- | --- |
| 表前缀 | `plugin_<DB-UUID>_`（**不是** `manifest.id`） |
| `ctx.db` 有 `prepare()` 吗 | **没有** |
| 要跑裸 SQL 怎么办 | `const raw = await ctx.resolve(IDatabaseToken)`，再 `raw.prepare(sql).run(...)` |
| 迁移版本存哪 | `plugin_migrations` 表（按 plugin_id 一行） |
| 声明式 `migrations/*.sql` | **官方 CLI 不打包该目录**（`cli.mjs` L379-387），ZIP 插件上不会执行 |

**同步/异步差异**：inline 下 `better-sqlite3` 是同步的，`process` 沙箱是 Promise 代理。
**统一写成 `await`** 可同时兼容（`await` 同步值合法）。

---

## 5. `config: IConfigService`

```ts
get<T = unknown>(key: string, options?: { classId?: string; schoolId?: string }): T;
getAll(options?): Record<string, unknown>;
set(key: string, value: unknown, scope?: { scopeType?: 'platform'|'school'|'class'; scopeId?: string }): Promise<void>;
onChange(cb: (key, newValue, oldValue) => void): () => void;
```

覆盖优先级：**班级 > 学校 > 平台 > `manifest.configuration.properties[key].default`**。
`scope` 缺省 `['platform']`（老插件行为不变）。

> ⚠️ **必须用 `ctx.config.get(key)`，不能写 `ctx.config[key]`。**
> `IConfigService` 是**服务对象**，不是键值字典 —— `ConfigService` 没有按 key 生成属性/getter
> （`packages/core/plugin-host/config-service.ts → class ConfigService（L150）`，只有
> `get` / `getAll` / `hasKey` / `getSchema` / `allowedScopes` / `set` / `onChange`）。
> 因此 `ctx.config['points_per_check_in']` 恒为 `undefined`，后续回落链会让**管理员在后台改的配置永远不生效**，
> 且不报错 —— 这是静默失败。
> 反例：`[P] src/index.ts → getConfigValue（L281）` 走的是 `cfg[key]`，
> 所以 `lab-seat` 的 5 个配置项实际始终等于 manifest 默认值。

> ⚠️ `process` / `worker` 模式下 `ctx.config` **完全不存在**（`packages/core/worker-runtime/service-host.ts`
> 全文件无 `config` 字样；context 只在 inline 侧构造，见 `context-builder.ts` L1143 `config: configService`）。
> 替代：`ctx.manifest.configuration.properties[key].default`（只读默认值）。

---

## 6. `http: IPluginHttpRouter`

```ts
get(path, handler) / post(path, handler) / put / patch / delete / route(method, path, handler)
stream(path | method, path, handler)     // SSE
isStream(method, path): boolean
```

请求/响应 DTO 见 [api-reference.md](../development/api-reference.md) §5。三条运行时约束：

| 约束 | 值 | 证据 |
| --- | --- | --- |
| 真实挂载路径 | `/api/plugins/{manifest.id}/*`，`api.baseRoute` **无效** | `manifest-schema.ts`（L747-758 注释） |
| 请求体上限 | **1MB**，超出 413 | `plugin-api-gateway.ts`（L58 / L310） |
| 默认限流 | 每端点 120 次/分钟（键含 `clientIp`） | 同文件（L369-371） |
| SSE 单 IP 并发 | 默认 5，超出 429 | 同文件（L418-421） |
| `auth:false` | 只是**申请**匿名，需管理员批准后才放行 | `openlearn.d.ts`（L77-81） |

---

## 7. `i18n` / `require` / `contributions` / `log`

```ts
i18n.t(key: string, defaultValueOrParams?: string | Record<string, any>, maybeParams?: Record<string, any>): string;
i18n.getLanguage(): string;                 // 默认 'zh'

require(moduleName: string): any;           // 仅白名单模块
contributions.list(): ContributionSummary[]; // [{slot, count, items:[{id,label}]}]
log.debug/info/warn/error(message: string, meta?: Record<string, unknown>): void;
```

`ctx.require` 白名单（`types.ts → PLUGIN_SHARED_MODULES`，L75-83）：

```text
recharts  react-markdown  jspdf  jspdf-autotable  exceljs  lucide-react  uuid
```

不在名单内 → 抛错。注意是 `exceljs` 不是 `xlsx`。

---

## 8. 前端 `FrontendPluginContext`（完全不同的一套）

```ts
// src/plugin-host/types.ts → FrontendPluginContext（L524）
interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;        // get/post/del → {success, result?, error?}
    socketService: ISocketService;    // emit/on/off/disconnect（不是原生 socket.io Socket）
    uiService: IUIService;            // showToast/showModal/closeModal/downloadFile
    storageService: IStorageService;  // 同步字符串 KV
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  dispatcher: IHostActionDispatcher;  // host:refresh / host:modal:open / host:toast / host:navigate
  ui: { registerExtensionPoint, unregisterExtensionPoint,
        registerFullscreenRenderer, registerPropertyEditor, registerCoursewareSource,
        registerPaletteItem, registerSegmentType,
        registerAssignmentQuestionRenderer, registerAssessmentQuestionType, /* + 对应 unregister */ };
  invokeCommand<T>(type: string, payload?: any): Promise<T>;
  i18n?: PluginI18nAPI;
  navigation?: { getTeacherTab, setTeacherTab, setSelectedLesson?, subscribeTeacherTab };
  context?: { get(): { lessonId, classId }, subscribe(cb): () => void };
  registerPanel? / registerMenu? / registerToolbarButton?;   // 兼容 shim
}
```

| 差异点 | 后端 | 前端 |
| --- | --- | --- |
| `storage` | 异步、任意值 | **同步、仅字符串** |
| `socket` | 无 | `ISocketService`（4 个方法） |
| `config` | 有 | **无** |
| `db` | 有 | **无** |
| `dispatcher` | 无 | 有（受控宿主动作） |
| `context` | 通过命令参数 | `ctx.context.get()` |

兼容 shim 的默认槽位：`registerPanel` → `teacher.dashboard.widget`，`registerMenu` → `teacher.panel`，
`registerToolbarButton` → `classroom.tool`（`plugin-host.ts` L700 起）。**新代码不要用**。

---

## 9. `IHostActionDispatcher`（前端身份与刷新的正规通道）

```ts
dispatch<TResult>(action: HostAction, options?: { timeoutMs?: number; sourcePluginId?: string }): Promise<TResult>;
registerHandler(type, handler): Disposable;
subscribe(type | '*', listener): Disposable;
use(middleware): Disposable;
```

内置 `HostAction` 六种：

| type | payload 关键字段 | 返回 |
| --- | --- | --- |
| `host:refresh` | `target: 'timetable'\|'classes'\|'lessons'\|'students'\|'all'` | `{success, refreshed[]}` |
| `host:modal:confirm` | `title`, `message`, `variant?` | `{confirmed}` |
| `host:modal:open` | `title`, `content`, `size?`, `actions?` | `{actionId?, closed}` |
| `host:modal:close` | `id?`, `result?` | — |
| `host:toast` | `title`, `message`, `type?`, `duration?` | `{delivered}` |
| `host:navigate` | `tab`, `subTab?`, `params?` | `{navigated}` |

证据：`types.ts`（L358-520）。渲染器会自动给每个扩展点注入 `dispatcher`（已绑定 `sourcePluginId`）。
