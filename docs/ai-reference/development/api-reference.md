# API 参考

**唯一真源**：`packages/plugin-sdk/openlearn.d.ts`（1470 行）+ `src/plugin-host/types.ts`（前端）。
本文按「能直接抄进代码」的粒度转写签名。标注约定：

| 标记           | 含义                                 |
| -------------- | ------------------------------------ |
| `Public`       | 插件可依赖                           |
| `Internal`     | 内部实现，插件不应直接用             |
| `Experimental` | 无向后兼容承诺，升级前先查 CHANGELOG |
| `Deprecated`   | 有替代方案                           |

---

## 1. 导入面

```ts
// 类型（全部可安全 import type）
import type {
  PluginContext,
  Manifest,
  PluginInfo,
  PluginState as PluginStateType,
  PlatformCommand,
  PlatformEvent,
  CommandHandler,
  ActionDescriptor,
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
  PluginDatabaseAPI,
  IPluginLogger,
  IConfigService,
  IPluginHttpRouter,
  PluginApiRequest,
  PluginApiResponse,
  PluginStreamResponse,
  I18n,
  SqliteDatabase,
  SqliteStatement,
  FrontendPluginContext,
  ExtensionPointConfig,
} from '@openlearn/plugin-sdk';

// 值（运行期存在）
import {
  Token,
  PluginState,
  PluginHttpRouter,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
  IPointsLedgerServiceToken,
  IActivityRegistryToken,
  IAuthSessionBridgeToken,
  ACTIVITY_EVENTS,
  BaseActivityProvider,
  defineActivityProvider,
  CapabilityRegistry,
} from '@openlearn/plugin-sdk';
```

### 1.1 只有类型、没有运行期值的 7 个符号（3.7.2 起）

```text
PluginRuntimeComposition   PluginCapabilityGateway   PluginContextAdapter
PluginDistributionManager  PluginLifecycleManager    PluginRuntimeAdapter
UnifiedExtensionRegistry
```

写成值导入会**编译通过、运行期 `undefined`**（比 TS1362 更难查）。
证据：`openlearn.d.ts` L1401-1409 的注释与 `export type` 块。

### 1.2 已弃用（3.8.0 起从导出面移除）

`ICapabilityGovernanceServiceToken`、`IPluginCapabilityGatewayToken`、`IUnifiedExtensionRegistryToken`、
`IPluginRuntimeCompositionToken` —— d.ts 中标注 `@deprecated`（L1144-1170）。内核侧仍可从
`packages/core/di/interfaces.ts` 导入，但**插件不该用**。

---

## 2. `Token` 与 DI

```ts
declare class Token<T> {
  readonly name: string;
  readonly version: string;
  readonly __serviceType?: T; // phantom，仅供类型推导
  constructor(name: string, version?: string);
}
```

```ts
// 解析
const db = await ctx.resolve(IDatabaseToken); // Token 对象，推荐
const db2 = await ctx.resolve<SqliteDatabase>('@openlearn/core:IDatabase' as unknown as Token<SqliteDatabase>); // 按名字：仅 31 条可用

// 提供（需 manifest.provides 声明）
await ctx.provide(IMyServiceToken, impl);
```

`Token.name` 的命名约定：`@<scope>/<domain>:I<Interface>`，例 `@aymwoo/plugin-lab-seat:ILabSeatService`。

---

## 3. `PluginContext`（后端）

```ts
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
  pluginId: string; // DB UUID，不是 manifest.id
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

> 内核类型是 `T | null`（`packages/core/plugin-host/types.ts` L239-249）；SDK d.ts 写的是非空。
> **以 `T | null` 为准**（facts-ledger 裁决 #15）。

---

## 4. 服务接口全签名

### 4.1 `ICommandBusService`

```ts
execute<T extends PlatformCommand>(command: T): Promise<unknown>;
registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;
unregisterHandler(commandType: string): void | Promise<void>;
createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): PlatformCommand<T> | Promise<PlatformCommand<T>>;
setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>;
registerLegacyHandler?(commandType: string, handler: CommandHandler): void | Promise<void>;  // Deprecated
```

```ts
interface CommandHandler {
  execute(command: PlatformCommand): Promise<unknown>;
}

interface PlatformCommand<T = unknown> {
  id: string;
  type: string;
  actorId: string;
  payload: T;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}
```

### 4.2 `IEventBusService`

```ts
publish(event: PlatformEvent): Promise<void>;
subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
```

```ts
type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;

interface PlatformEvent<T = unknown> {
  id: string;
  type: string;
  source: string;
  payload: T;
  timestamp: number;
  correlationId?: string;
}
```

### 4.3 `IActionRegistryService`

```ts
register(descriptor: ActionDescriptor): void | Promise<void>;
unregister(id: string): void | Promise<void>;
getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;
getAgentTools(): unknown[] | Promise<unknown[]>;
getActionByToolName(toolName: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
getActionByCommandType(commandType: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
```

```ts
interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: unknown; // 类型上是 unknown，但内核会按大写类型名校验（见下表）
  readonly capabilityRequired: string; // 必须是 19 条真值之一
  readonly isHighRisk?: boolean; // 需人工审批
  readonly exposeToAgent?: boolean; // 默认 true
}
```

**`inputSchema` 不生效的陷阱（务必读完）**

`inputSchema` 的 TS 类型是 `unknown`（`packages/plugin-sdk/openlearn.d.ts` `interface ActionDescriptor`），
但内核在命令派发前**确实会校验**：`packages/core/kernel/index.ts` L303-314 的 interceptor
调用 `validateJsonSchema(command.payload, action.inputSchema)`，有错即抛
`[PayloadValidationError] Invalid command payload for <type>: …`。

校验器 `validateJsonSchema`（`packages/core/kernel/index.ts` L689-749）是**手写的极简实现**，
只识别**全大写**类型名：

| `schema.type` 写法                                           | 运行期行为                                           |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `'OBJECT'`                                                   | 校验 required + 递归 properties                      |
| `'ARRAY'`                                                    | 校验数组，递归 `items`                               |
| `'STRING'`                                                   | `typeof data === 'string'`                           |
| `'NUMBER'`                                                   | number 且非 NaN                                      |
| `'BOOLEAN'`                                                  | `typeof data === 'boolean'`                          |
| `'object'` / `'array'` / `'string'`（标准 JSON Schema 小写） | **整段跳过，无任何校验**（不报错、不拦截）           |
| `'INTEGER'`                                                  | **无对应分支，同样跳过**（写成 `'NUMBER'` 才会校验） |

结论：写小写 JSON Schema 等于没写 `inputSchema` —— 它不会报错，只是 `required` 全部失效，
handler 必须自己兜底校验。示例插件 `lab-seat` 的 19 条批量描述符用
`inputSchema: { type: 'OBJECT', properties: {} }`（`[P] src/index.ts` L1446）正是「只拿 OBJECT
做对象形状守卫、必填校验交给 handler」的写法。

工具消费侧：`packages/core/registry/index.ts` L54 把 `action.inputSchema` **原样**塞进
`parameters` 发给模型，因此大小写两套写法在 AI 工具定义里**都**会被看到，模型会按小写标准理解，
而内核按大写判定 —— 这是当前实现的双口径现状，不是笔误。

### 4.4 `ICapabilityService`

```ts
grant(actorId: string, cap: string): void | Promise<void>;
revokeAll(actorId: string): void | Promise<void>;
check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
```

### 4.5 `IProcessService`

```ts
spawn(name: string, taskType: string, payload: unknown, ownerHint?: string): string | Promise<string>;
kill(processId: string): void | Promise<void>;
registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
unregisterHandler(taskType: string): void | Promise<void>;
registerInterval(name: string, intervalMs: number,
  tickFn: (log: (msg: string) => void) => void, ownerHint?: string): string | Promise<string>;
restore(): void | Promise<void>;

type ProcessHandler = (processId: string, payload: unknown, state: unknown,
  log: (msg: string) => void, updateState: (newState: unknown) => void) => Promise<void>;
```

`registerHandler` / `registerInterval` / `restore` 需 `task:register` 能力。

### 4.6 `IStorageService`

```ts
get(key: string): Promise<unknown>;
set(key: string, value: unknown): Promise<void>;
delete(key: string): Promise<void>;
```

### 4.7 `IAIService`

```ts
generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
registerAIPersona?(persona: AIPersonaDefinition): void;
listAIPersonas?(): AIPersonaDefinition[];
unregisterAIPersona?(id: string): void;
registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
unregisterAIContextProvider?(id: string): void;
```

### 4.8 `PluginDatabaseAPI`

```ts
ensureTable(tableName: string, schema: string): Promise<void>;
table(tableName: string): string;
dropAllTables(): Promise<void>;
migrate(targetVersion: number, upgradeFn: (db: unknown) => Promise<void> | void): Promise<void>;
```

### 4.9 `IPluginLogger` / `IConfigService` / `PluginI18nAPI`

```ts
debug/info/warn/error(message: string, meta?: Record<string, unknown>): void;

get<T = unknown>(key: string, options?: { classId?: string; schoolId?: string }): T;
getAll(options?: ConfigReadOptions): Record<string, unknown>;
set(key: string, value: unknown, scope?: { scopeType?: 'platform'|'school'|'class'; scopeId?: string }): Promise<void>;
onChange(cb: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;

t(key: string, defaultValueOrParams?: string | Record<string, any>, maybeParams?: Record<string, any>): string;
getLanguage(): string;
```

---

## 5. HTTP 路由与 DTO

```ts
interface IPluginHttpRouter {
  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  post<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  put<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  patch<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  route<TBody = unknown, TRes = unknown>(method: string, path: string, handler: PluginApiHandler<TBody, TRes>): void;
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;
  isStream(method: string, path: string): boolean;
}
```

```ts
interface PluginApiRequest<TBody = unknown, TQuery = Record<string, string | string[]>> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: TQuery;
  readonly headers: Record<string, string>; // 白名单清洗后
  readonly body: TBody;
  readonly ip: string;
  readonly actor: {
    readonly actorId: string;
    readonly userId?: string;
    readonly username?: string;
    readonly role: 'administrator' | 'teacher' | 'student' | 'anonymous' | string;
    readonly permissions?: string[];
  };
}

interface PluginApiResponse<TBody = unknown> {
  status?: number; // 100-599
  headers?: Record<string, string>; // 白名单过滤
  body: TBody;
  sessionToken?: string; // SSO 会话，宿主写入 Cookie
}

type PluginApiHandler<TBody = unknown, TRes = unknown> = (
  req: PluginApiRequest<TBody>,
) => Promise<PluginApiResponse<TRes> | TRes> | PluginApiResponse<TRes> | TRes;
```

SSE：

```ts
interface PluginStreamResponse {
  write(data: string | Record<string, any>, event?: string, id?: string): boolean;
  end(): void;
  error(err: Error | string): void;
  readonly isClosed: boolean;
  onClose(callback: () => void): void;
}
type PluginStreamHandler<TBody = unknown> = (
  req: PluginApiRequest<TBody>,
  stream: PluginStreamResponse,
) => Promise<void> | void;
```

> **`req.actor` 是唯一可信的身份来源**。沙箱里的 `command.invoke` 用的是**插件自己的** actor，
> `command.actorId` 恒为 `plugin:<manifest.id>`，拿不到 `userId`/`role`。要认人必须走 `ctx.http` 或 `frontendApi`。

---

## 6. 前端 `FrontendPluginContext`

```ts
interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;
    socketService: ISocketService;
    uiService: IUIService;
    storageService: IStorageService;
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  dispatcher: IHostActionDispatcher;
  ui: {
    registerExtensionPoint(slot: AnyExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: AnyExtensionSlot, id: string): void;
    registerFullscreenRenderer(type: string, renderer: FullscreenRenderer): void;
    unregisterFullscreenRenderer(type: string): void;
    registerPropertyEditor(type: string, editor: PropertyEditorComponent): void;
    unregisterPropertyEditor(type: string): void;
    registerCoursewareSource(loader: CoursewareSourceLoader): void;
    unregisterCoursewareSource(id: string): void;
    registerPaletteItem(item: PaletteItemConfig): void;
    unregisterPaletteItem(type: string): void;
    registerSegmentType(type: SegmentTypeMeta): void;
    unregisterSegmentType(id: string): void;
    registerAssignmentQuestionRenderer(config: AssignmentQuestionRendererConfig): void;
    unregisterAssignmentQuestionRenderer(quizType: string): void;
    registerAssessmentQuestionType(config: AssessmentQuestionTypeUi): void;
    unregisterAssessmentQuestionType(type: string): void;
  };
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>;
  i18n?: { t(...): string; getLanguage(): string };
  navigation?: {
    getTeacherTab(): string;
    setTeacherTab(tab: string): void;
    setSelectedLesson?(lessonId: string | null): void;
    subscribeTeacherTab(callback: (tab: string) => void): () => void;
  };
  context?: {
    get(): { lessonId: string | null; classId: string | null };
    subscribe(cb: (ctx: { lessonId; classId }) => void): () => void;
  };
  registerPanel?(config: any): void;          // Deprecated shim
  registerMenu?(config: any): void;           // Deprecated shim
  registerToolbarButton?(config: any): void;  // Deprecated shim
}
```

前端服务：

```ts
interface IFrontendAPI {
  get<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T = any>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void; // 被 Barrier 3 禁止调用
}

interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning' | 'error'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
  downloadFile(data: Blob | string, filename: string, mimeType?: string): void;
}

interface IStorageService {
  // 同步 + 仅字符串
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}
```

---

## 7. `ExtensionPointConfig`（前端注册）

```ts
interface ExtensionPointConfig {
  id: string; // 必填，主键之一
  label: string; // 必填
  icon?: string | React.ComponentType<{ size?: number; className?: string }>;
  component: React.ComponentType<any> | (() => Promise<{ default: React.ComponentType<any> }>);
  position?: number;
  pluginId: string; // 宿主会覆盖为真实值
  group?: 'teaching' | 'management' | 'analytics' | 'extension' | string;
  badge?: number | string;
  rolesAllowed?: ('admin' | 'teacher' | 'student')[];
  route?: string;
  targetType?: string; // 如 whiteboard.renderer 的图元类型
  slotProps?: Record<string, any>;
  placement?: 'before' | 'after'; // anchor 槽位专用
  render?: (props?: Record<string, any>) => React.ReactNode;
  view?: string; // 沙箱 HTML 相对路径（如 'storage/x.html'）
  origin?: 'manifest' | 'runtime'; // 缺省 'runtime'
}
```

> lazy 工厂**必须**设置 `__isLazyFactory = true`，否则 React 拿到 Promise 会永久悬挂 Suspense 边界，
> 熔断器与 ErrorBoundary 全部失效（`types.ts` L274-282 注释）。

---

## 8. 槽位 Props 接口一览

前端 `types.ts` 为常用槽位定义了具名 Props 接口（L594-950），可直接 `import type` 使用：

| 接口                                                                                                                                                                                         | 槽位                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `StageDisplayOverlaySlotProps`                                                                                                                                                               | `stage.display.overlay`                |
| `StageDisplayActionSlotProps`                                                                                                                                                                | `stage.display.action`                 |
| `AssignmentSubmissionPreviewSlotProps`                                                                                                                                                       | `assignment.submission.preview`        |
| `AssignmentFilePreviewSlotProps`                                                                                                                                                             | `assignment.file.preview`              |
| `HeaderActionSlotProps` / `HeaderStatusPillSlotProps`                                                                                                                                        | `header.action` / `header.status_pill` |
| `StatusbarItemSlotProps`                                                                                                                                                                     | `statusbar.item`                       |
| `WhiteboardRendererSlotProps`                                                                                                                                                                | `whiteboard.renderer`                  |
| `CourseListToolbarActionSlotProps` / `CourseCardBadgeSlotProps` / `CourseCardActionSlotProps`                                                                                                | 课程域                                 |
| `AssessmentListCardSlotProps` / `AssessmentAttemptToolbarSlotProps` / `AssessmentStatsCardSlotProps`                                                                                         | 测评域                                 |
| `EditorSegmentActionSlotProps`                                                                                                                                                               | `editor.segment.action`                |
| `ClassroomAlertBannerSlotProps` / `ClassroomCockpitDrawerItemSlotProps` / `ClassroomStageDisplayTickerSlotProps` / `ClassroomPostClassExporterSlotProps`                                     | 课堂域                                 |
| `AdminDashboardCardSlotProps` / `AdminUserActionSlotProps`                                                                                                                                   | 管理后台                               |
| `TimetableToolbarActionSlotProps` / `TimetableCardBadgeSlotProps`                                                                                                                            | 课表                                   |
| `ComputerLabToolbarActionSlotProps` / `ComputerLabSeatOverlaySlotProps` / `ComputerLabSeatingToolbarSlotProps` / `ComputerLabUnassignedItemSlotProps` / `ComputerLabSeatingSidebarSlotProps` | 机房                                   |
| `StudentDashboardHeroWidgetSlotProps` / `StudentAssignmentToolbarActionSlotProps` / `StudentLessonNotesAddonSlotProps` / `StudentLessonToolboxSlotProps`                                     | 学生端                                 |
| `AiSidebarTabSlotProps`                                                                                                                                                                      | `ai_sidebar.tab`                       |
| `PeerReviewWorkPreviewSlotProps` / `PeerReviewShowcaseWidgetSlotProps`                                                                                                                       | 互评                                   |

**所有** slot 共有字段：`dispatcher?: IHostActionDispatcher`、`lang?: 'zh' | 'en'`、`route?: string`。

---

## 9. 宿主侧 API（`Internal`，仅供理解行为）

| 符号                         | 位置                                           | 说明                                                                                                      |
| ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PluginHost`                 | `openlearn.d.ts` L749                          | `installPlugin` / `activatePlugin` / `deactivatePlugin` / `togglePlugin` / `exportStudentDataFromPlugins` |
| `IPluginLifecycleManager`    | L849                                           | `getPluginState` / `reloadPlugin` / `health`                                                              |
| `IPluginDistributionManager` | L935                                           | `installFromZip` / `updateFromZip` / `uninstallPlugin`                                                    |
| `IPluginCapabilityGateway`   | L862                                           | `executeCapability`                                                                                       |
| `IUnifiedExtensionRegistry`  | L873                                           | `registerExtension` / `unregisterProvider`                                                                |
| `PluginHttpRouter`           | L428                                           | `match` / `handle` / `handleStream` / `getRegisteredRoutes`                                               |
| `CapabilityRegistry`         | L818                                           | `registerCapability` / `resolveCapability`                                                                |
| `descriptor`/`token` 兼容层  | `packages/core/worker-runtime/service-host.ts` | RPC 服务端                                                                                                |

插件**不要** `new` 这些类的实例，也不要 `ctx.resolve` 它们的 Token（多数不在 31 条白名单内）。

---

## 10. `ActivityProvider`（Experimental）

```ts
declare function defineActivityProvider(
  input: ActivityProviderDescriptor | BaseActivityProviderOptions,
  hooks?: Omit<BaseActivityProviderOptions, 'descriptor'>,
): BaseActivityProvider;

interface ActivityProviderDescriptor {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category: 'assessment' | 'engagement' | 'collaboration' | 'management' | 'ai' | 'media' | 'custom';
  permissions?: string[];
  supportedRoles: ('teacher' | 'student' | 'assistant' | 'observer' | 'all')[];
  supportedDevices?: ('desktop' | 'tablet' | 'mobile' | 'all')[];
  tags?: string[];
  version: string;
  provider: string;
  commandType?: string;
  aiAction?: ActionDescriptor;
  aiContext?: Record<string, unknown>;
}

declare const ACTIVITY_EVENTS: {
  REGISTERED: 'activity.registered';
  INITIALIZED: 'activity.initialized';
  STARTED: 'activity.started';
  PAUSED: 'activity.paused';
  RESUMED: 'activity.resumed';
  FINISHED: 'activity.finished';
  DISPOSED: 'activity.disposed';
};
```

通过 `ctx.resolve(IActivityRegistryToken)` 拿 `ActivityRegistry` 后 `registerProvider()`。
注意该 Token **只能按名字字符串** resolve（见 context-and-services §3）。
