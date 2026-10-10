# 完整 DI Token 与 Service API 字典

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`（版本号以 `packages/plugin-sdk/package.json` 为准） / 平台 `v0.3.15+`。
> 本页是插件获取平台内核服务的**唯一权威字典**。所有 Token 定义位于 `packages/core/di/interfaces.ts`，并由 `packages/plugin-sdk/index.ts` 统一导出。
> **重要**：插件 SDK 发布的 `dist/index.d.ts`（由 `openlearn.d.ts` 复制而来）由 `node packages/plugin-sdk/build.mjs` 生成，需在 SDK 源码变更后**重新构建**；若你在 `tsc` 下遇到 `TS2305 "has no exported member"`，即为 SDK 声明文件未同步所致，运行 `node packages/plugin-sdk/build.mjs` 重新生成即可。

---

## 1. 如何获取服务：两条路径

插件在 `activate(ctx)` 中拿到 `PluginContext`（`ctx`）。平台服务通过两种方式获取：

1. **`ctx.resolve(Token)` —— 通用 DI 路径**。除了下方 9 个核心服务代理之外，任何已注册的 Token 都走这条路：

   ```typescript
   import { IPluginLifecycleManagerToken, IDatabaseToken, IAuthSessionBridgeToken } from '@openlearn/plugin-sdk';

   const lifecycle = await ctx.resolve(IPluginLifecycleManagerToken); // 类型: PluginLifecycleManager
   const db = await ctx.resolve(IDatabaseToken); // 类型: SqliteDatabase（SDK 导出的自包含类型，运行时为 better-sqlite3 Database）
   const authBridge = await ctx.resolve(IAuthSessionBridgeToken); // 类型: IAuthSessionBridgeService
   ```

2. **`ctx.services.X` —— 仅 9 个核心服务的便捷代理**（与对应 Token 解析出的实例相同）。

`PluginContext` 完整形态（`packages/core/plugin-host/types.ts`）：

```typescript
interface PluginContext {
  // (a) 预接线的 9 个核心服务代理
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
    pointsDimension: IPointsDimensionRegistry | null;
    pointsLedger: IPointsLedgerService | null;
  };
  pluginId: string;
  manifest: Manifest;
  // (b) 解析任意已注册的 Token
  resolve<T>(token: Token<T>): Promise<T>;
  // (c) 向容器注入插件自有服务
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  // (d) 其它上下文能力（非 Token）
  db: PluginDatabaseAPI; // 插件命名空间隔离表
  log: IPluginLogger; // ctx.log.info(...)
  config: IConfigService;
  contributions: ContributionAccessor;
  http: IPluginHttpRouter; // RESTful & SSE 流式路由
  require(moduleName: string): unknown; // 仅白名单内的共享模块
  // ⚠️ 以下成员不在 `PluginContext` 接口中，仅由 worker 引导脚本运行时注入：
  // reportProgress?(stage?: string, message?: string): void;
  // Inline 模式下为 undefined，按 PluginContext 标注会类型报错。见 docs/plugin/plugin-lifecycle.md。
}
```

---

## 2. 完整 Token 列表（33 个）

`Token<T>` 本身是一个运行时常量（`packages/core/di/token.ts`），其 `name` 形如 `@openlearn/core:ICommandBusService`，`T` 仅用于编译期类型携带。

### A. 核心 9 服务 Token（`packages/core/di/interfaces.ts`）

| 导出 Token                      | 解析类型                   | 标识字符串                                 |
| ------------------------------- | -------------------------- | ------------------------------------------ |
| `ICommandBusServiceToken`       | `ICommandBusService`       | `@openlearn/core:ICommandBusService`       |
| `IEventBusServiceToken`         | `IEventBusService`         | `@openlearn/core:IEventBusService`         |
| `IActionRegistryServiceToken`   | `IActionRegistryService`   | `@openlearn/core:IActionRegistryService`   |
| `ICapabilityServiceToken`       | `ICapabilityService`       | `@openlearn/core:ICapabilityService`       |
| `IProcessServiceToken`          | `IProcessService`          | `@openlearn/core:IProcessService`          |
| `IStorageServiceToken`          | `IStorageService`          | `@openlearn/core:IStorageService`          |
| `IAIServiceToken`               | `IAIService`               | `@openlearn/core:IAIService`               |
| `IPointsDimensionRegistryToken` | `IPointsDimensionRegistry` | `@openlearn/core:IPointsDimensionRegistry` |
| `IPointsLedgerServiceToken`     | `IPointsLedgerService`     | `@openlearn/core:IPointsLedgerService`     |

> `pointsDimension` 和 `pointsLedger` 通过 `tryResolve` 获取，未注册时值为 `null`（插件可检查 `=== null` 降级）。

### B. 内核 / 基础设施 Token

| 导出 Token         | 解析类型                                                                                                              | 标识字符串                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `IDatabaseToken`   | `SqliteDatabase`（better-sqlite3 兼容的原始句柄，无包装；SDK 导出自包含类型，避免消费方依赖 better-sqlite3 类型解析） | `@openlearn/core:IDatabase`   |
| `IPluginHostToken` | `PluginHost`（**类，非纯接口**）                                                                                      | `@openlearn/core:IPluginHost` |

### C. P7-A2 统一插件平台 Token（`packages/core/di/interfaces.ts`）

| 导出 Token                        | 解析类型                    | 标识字符串                                   |
| --------------------------------- | --------------------------- | -------------------------------------------- |
| `IPluginLifecycleManagerToken`    | `PluginLifecycleManager`    | `@openlearn/core:IPluginLifecycleManager`    |
| `IPluginDistributionManagerToken` | `PluginDistributionManager` | `@openlearn/core:IPluginDistributionManager` |
| `ICapabilityRegistryToken`        | `CapabilityRegistry`        | `@openlearn/core:ICapabilityRegistry`        |

> **⚠️ 已收回对外承诺的 Token（SDK 3.8.0 起不再从 `@openlearn/plugin-sdk` 导出）**
>
> 审计项 M-10 / F-3：`kernel/index.ts` 把它们注册进 `ServiceRegistry`，但**零生产
> resolve** —— 全仓唯一提及是一段注释示例，`v2_plugins/` 与 `assets/` 均无引用。
> 对外承诺一个零消费者的 API 比不承诺更糟，故收回导出。
>
> | Token                               | 解析类型                       | 标识字符串                                     | 内核现状                    |
> | ----------------------------------- | ------------------------------ | ---------------------------------------------- | --------------------------- |
> | `IPluginRuntimeCompositionToken`    | `PluginRuntimeComposition`     | `@openlearn/core:IPluginRuntimeComposition`    | 已注册，零 resolve          |
> | `IUnifiedExtensionRegistryToken`    | `UnifiedExtensionRegistry`     | `@openlearn/core:IUnifiedExtensionRegistry`    | 已注册，零 resolve          |
> | `ICapabilityGovernanceServiceToken` | `ICapabilityGovernanceService` | `@openlearn/core:ICapabilityGovernanceService` | 子系统 529 行整体零 resolve |
>
> 内核侧引用不受影响（走 `packages/core` 相对路径）。若将来接入真实消费者，把它们
> 加回 `packages/plugin-sdk/index.ts` 的 value 导出块即可。

### D. 积分 / 学期 Token

| 导出 Token                   | 解析类型                | 标识字符串                              |
| ---------------------------- | ----------------------- | --------------------------------------- |
| `ISemesterGradeServiceToken` | `ISemesterGradeService` | `@openlearn/core:ISemesterGradeService` |

> `IPointsDimensionRegistryToken` 和 `IPointsLedgerServiceToken` 已归入 §A 核心 9 服务。

### E. 引擎访问 Token（薄封装 `getX(): Promise<unknown>` 门面）

| 导出 Token                           | 解析类型                          | 标识字符串                                        |
| ------------------------------------ | --------------------------------- | ------------------------------------------------- |
| `ILessonEngineServiceToken`          | `ILessonEngineService`            | `@openlearn/core:ILessonEngineService`            |
| `IClassroomRuntimeServiceToken`      | `IClassroomRuntimeService`        | `@openlearn/core:IClassroomRuntimeService`        |
| `IPresenceEngineServiceToken`        | `IPresenceEngineService`          | `@openlearn/core:IPresenceEngineService`          |
| `ITeachingCollaborationServiceToken` | `ITeachingCollaborationService`   | `@openlearn/core:ITeachingCollaborationService`   |
| `ILearningAnalyticsServiceToken`     | `ILearningAnalyticsService`       | `@openlearn/core:ILearningAnalyticsService`       |
| `IAICapabilityServiceToken`          | `IAICapabilityService`            | `@openlearn/core:IAICapabilityService`            |
| `ICapabilityRuntimeServiceToken`     | `ICapabilityRuntimeService`       | `@openlearn/core:ICapabilityRuntimeService`       |
| `IPlatformServiceRegistryToken`      | `IPlatformServiceRegistryService` | `@openlearn/core:IPlatformServiceRegistryService` |

### F. 活动生态 Token

| 导出 Token               | 解析类型           | 标识字符串                                        |
| ------------------------ | ------------------ | ------------------------------------------------- |
| `IActivityRegistryToken` | `ActivityRegistry` | （定义于 `packages/activity-ecosystem/index.ts`） |

### G. 认证与会话桥接 Token (v0.3.15+)

| 导出 Token                | 解析类型                    | 标识字符串                                  |
| ------------------------- | --------------------------- | ------------------------------------------- |
| `IAuthSessionBridgeToken` | `IAuthSessionBridgeService` | `@openlearn/core:IAuthSessionBridgeService` |

### H. 课件运行时 / 课堂扩展 Token

| 导出 Token                              | 解析类型                           | 标识字符串                                         |
| --------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `ICoursewareRuntimeScriptRegistryToken` | `ICoursewareRuntimeScriptRegistry` | `@openlearn/core:ICoursewareRuntimeScriptRegistry` |
| `IClassroomLifecycleServiceToken`       | `IClassroomLifecycleService`       | `@openlearn/core:IClassroomLifecycleService`       |
| `IInteractionRuntimeServiceToken`       | `IInteractionRuntimeService`       | `@openlearn/core:IInteractionRuntimeService`       |
| `IClassroomCountdownServiceToken`       | `IClassroomCountdownService`       | `@openlearn/core:IClassroomCountdownService`       |
| `IStageGuardServiceToken`               | `IStageGuardService`               | `@openlearn/core:IStageGuardService`               |

---

## 3. 各 Service 接口全量方法签名

> 定义文件统一为 `packages/core/di/interfaces.ts`（下文各小节另有标注的实现文件除外）。

> ⚠️ **关于返回类型 `T | Promise<T>`**：接口层为跨运行时兼容（inline 同步实现 / worker RPC 异步代理）把大多数方法声明为**联合返回类型** `T | Promise<T>`，而非统一的 `Promise<T>`。这意味着：
>
> - **不能**对返回值直接写 `.then()` / `await … .catch()`，那在同步实现上会在类型与运行期双重失败；
> - 正确写法是 `await`（`await` 对同步值与 Promise 都成立），或 `Promise.resolve(x).then(...)`；
> - 只有明确标注 `Promise<…>` 的方法（如 `IStorageService` 全套、`IAIService.generateText`、`IPointsLedgerService` 全套）才是纯 Promise。

### `ICommandBusService`（`packages/core/di/interfaces.ts`）

```typescript
execute<T extends PlatformCommand>(command: T): Promise<unknown>;
registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;
unregisterHandler(commandType: string): void | Promise<void>;
createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): PlatformCommand<T> | Promise<PlatformCommand<T>>;
setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>;
```

### `IEventBusService`（`packages/core/di/interfaces.ts`）

```typescript
publish(event: PlatformEvent): Promise<void>;
// subscribe 返回取消订阅句柄（EventSubscriber）；同步实现下也可能返回 void
subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
```

> `subscribe` 的返回值**不是** `Promise<void>`。需要取消订阅时应 `const h = await services.eventBus.subscribe(...)` 后调 `h()`；若 `await` 后得到 `undefined`（同步实现的 `void` 路径），说明应改用 `unsubscribe(eventType, subscriber)` 显式解绑。

### `IActionRegistryService`（`packages/core/di/interfaces.ts`）

```typescript
register(descriptor: ActionDescriptor): void | Promise<void>;
unregister(id: string): void | Promise<void>;
getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;
getAgentTools(): unknown[] | Promise<unknown[]>;
getActionByToolName(toolName: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
getActionByCommandType(commandType: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
```

### `ICapabilityService`（`packages/core/di/interfaces.ts`）

```typescript
grant(actorId: string, cap: string): void | Promise<void>;
revokeAll(actorId: string): void | Promise<void>;
check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
```

### `IProcessService`（`packages/core/di/interfaces.ts`）

```typescript
spawn(name: string, taskType: string, payload: unknown): string | Promise<string>;
kill(processId: string): void | Promise<void>;
registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
unregisterHandler(taskType: string): void | Promise<void>;
registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): string | Promise<string>;
restore(): void | Promise<void>;
// ProcessHandler = (processId, payload, state, log, updateState) => Promise<void>
```

### `IStorageService`（`packages/core/di/interfaces.ts`，实现 `packages/core/di/storage-service.ts`）

```typescript
get(key: string): Promise<unknown>;
set(key: string, value: unknown): Promise<void>;
delete(key: string): Promise<void>;
```

> 本接口是纯 `Promise`（无联合返回），可直接 `.then()` / `await`。后端为 SQLite `plugin_storage` 表，按 `plugin_id` 自动命名空间隔离。

### `IAIService`（`packages/core/di/interfaces.ts`，实现 `packages/core/di/ai-service.ts`）

```typescript
generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;

// 5 个可选成员（非 `?` 之外的实现方需自行判空；未实现时为 undefined）
registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
unregisterAIContextProvider?(id: string): void;
registerAIPersona?(persona: AIPersonaDefinition): void;
listAIPersonas?(): AIPersonaDefinition[];
unregisterAIPersona?(id: string): void;
```

> 统一由数据库 `ai_providers` 中配置的 OpenAI 兼容 Provider 提供。若未配置任何有效提供商，抛出友好错误提示。

### `IDatabaseToken` → 原生 SQLite 句柄（`SqliteDatabase`）

无接口包装，插件直接拿到原始 `Database` 对象（SDK 以自包含的 `SqliteDatabase` 类型描述其表面，运行时即 better-sqlite3 `Database`）。查询/插入/更新/删除/事务请使用 better-sqlite3 原生 API（详见 [插件数据库 API 与 Migration 规范](../reference/plugin-database-api)）。

### `IPluginHostToken` → `PluginHost` 类（`packages/core/plugin-host/index.ts`）

```typescript
setExpressApp(app: any): void;
setSocketIO(io: any): void;
listPlugins(): PluginInfo[];
getPluginState(pluginId: string): PluginState | undefined;
installPlugin(sourceCode: string): Promise<Manifest>;
activatePlugin(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void>;
deactivatePlugin(pluginId: string): Promise<void>;
uninstallPlugin(pluginId: string): Promise<void>;
reloadPlugin(pluginId: string, newSourceCode: string): Promise<void>;
```

### `IPluginLifecycleManagerToken` → `PluginLifecycleManager`（`packages/core/plugin-host/plugin-lifecycle-manager.ts`）

```typescript
readonly pluginHost: PluginHost;
getPluginState(pluginId: string): PluginState | undefined;
listPlugins(): ReadonlyArray<PluginInfo>;
activatePlugin(pluginId: string): Promise<void>;
deactivatePlugin(pluginId: string): Promise<void>;
reloadPlugin(pluginId: string, newCode?: string): Promise<void>;
uninstallPlugin(pluginId: string): Promise<void>;
health(): IntegrationHealthStatus;
metadata(): IntegrationDescriptor;
```

### `IPluginDistributionManagerToken` → `PluginDistributionManager`（`packages/core/plugin-host/plugin-distribution-manager.ts`）

```typescript
readonly pluginHost: PluginHost;
registerRepository(repo: IPluginRepositoryAdapter): void;
listRepositories(): ReadonlyArray<IPluginRepositoryAdapter>;
listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
installFromZip(zipPath: string): Promise<{ pluginId: string; manifest: Manifest }>;
installFromRepository(repoId: string, pluginId: string): Promise<{ pluginId: string; manifest: Manifest }>;
updatePlugin(pluginId: string, zipPath?: string): Promise<void>;
uninstallPlugin(pluginId: string): Promise<void>;
health(): IntegrationHealthStatus;
metadata(): IntegrationDescriptor;
```

> **⚠️ 非插件 API（D-3/F-3 审计结论）**：以下三个 Token 与 `ICapabilityGovernanceServiceToken`
> 自 SDK 3.8.0 起**不再从 `@openlearn/plugin-sdk` 导出** —— 它们在内核里已注册，
> 但**零生产 resolve**。此处保留签名说明仅供内核内部阅读，**插件不要 import 它们**。
> 详见本文 C 区表格下方的撤回说明。

### `IPluginRuntimeCompositionToken` → `PluginRuntimeComposition`（`packages/core/plugin-host/plugin-runtime-composition.ts`）

```typescript
readonly id: string;
readonly name: string;
readonly version: string;
readonly pluginHost: PluginHost;
readonly workerManager?: WorkerManager;
readonly isStarted: boolean;
start(context?: IntegrationContext): Promise<void>;
stop(): Promise<void>;
health(): IntegrationHealthStatus;
metadata(): IntegrationDescriptor;
```

> **⚠️ 非插件 API（D-3/F-3 审计结论）**：以下三个 Token 与 `ICapabilityGovernanceServiceToken`
> 自 SDK 3.8.0 起**不再从 `@openlearn/plugin-sdk` 导出** —— 它们在内核里已注册，
> 但**零生产 resolve**。此处保留签名说明仅供内核内部阅读，**插件不要 import 它们**。
> 详见本文 C 区表格下方的撤回说明。

### `IUnifiedExtensionRegistryToken` → `UnifiedExtensionRegistry`（`packages/core/plugin-host/unified-extension-registry.ts`）

```typescript
registerExtension(category: string, id: string, impl: unknown, meta?: Partial<ExtensionItemMetadata>): void;
hasExtension(category: string, id: string): boolean;
getExtension<T = unknown>(category: string, id: string): T | undefined;
listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
listCategories(): ReadonlyArray<string>;
health(): IntegrationHealthStatus;
metadata(): IntegrationDescriptor;
```

> **⚠️ 非插件 API（D-3/F-3 审计结论）**：以下三个 Token 与 `ICapabilityGovernanceServiceToken`
> 自 SDK 3.8.0 起**不再从 `@openlearn/plugin-sdk` 导出** —— 它们在内核里已注册，
> 但**零生产 resolve**。此处保留签名说明仅供内核内部阅读，**插件不要 import 它们**。
> 详见本文 C 区表格下方的撤回说明。

### `IPluginCapabilityGatewayToken` → `PluginCapabilityGateway`（`packages/core/plugin-host/plugin-capability-gateway.ts`）

```typescript
readonly capabilityRegistry: CapabilityRegistry;
listCapabilities(): ReadonlyArray<CapabilityMetadata>;
hasCapability(capabilityId: string): boolean;
resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T;
executeCapability<T = unknown>(capabilityId: string, methodName: string, ...args: unknown[]): Promise<T>;
health(): IntegrationHealthStatus;
metadata(): IntegrationDescriptor;
```

### `ICapabilityRegistryToken` → `CapabilityRegistry`

AI 能力注册表（与 `resource:action` 权限字符串无关，见 [能力权限矩阵](../reference/plugin-capability-matrix)）。

### `ISemesterGradeServiceToken` → `ISemesterGradeService`（`packages/core/di/interfaces.ts`）

```typescript
saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
```

### `IPointsDimensionRegistryToken` → `IPointsDimensionRegistry`（`packages/core/di/interfaces.ts`）

```typescript
registerDimension(spec: PointsDimensionSpec): void;
getDimension(id: string): PointsDimensionSpec | undefined;
listDimensions(): PointsDimensionSpec[];
```

**`PointsDimensionSpec` 字段**（`packages/core/di/interfaces.ts`）：

```typescript
interface PointsDimensionSpec {
  id: string; // e.g. 'attendance', 'assignment', 'interactive_quiz', 'ai_practice'
  name: string; // e.g. '课堂互动打卡', 'AI练习积分'
  category: 'builtin' | 'plugin';
  defaultWeight: number; // e.g. 0.15 (15%)
  maxScore?: number; // e.g. 100
  description?: string;
  pluginId?: string;
}
```

### `IPointsLedgerServiceToken` → `IPointsLedgerService`（`packages/core/di/interfaces.ts`，实现 `packages/core/di/points-ledger-service.ts`）

```typescript
addPoints(studentId: string, classId: string, dimensionId: string, deltaPoints: number, reason: string, pluginId?: string): Promise<PointLogItem>;
getLogs(studentId: string, classId?: string): Promise<PointLogItem[]>;
getStudentTotalByDimension(studentId: string, classId: string, dimensionId: string): Promise<number>;
getStudentDimensionSummary(studentId: string, classId: string): Promise<Record<string, number>>;
```

**`PointLogItem` 字段**（`packages/core/di/interfaces.ts`）：

```typescript
interface PointLogItem {
  id: string;
  studentId: string;
  classId: string;
  dimensionId: string;
  pluginId?: string | null;
  deltaPoints: number;
  reason: string;
  createdAt: number;
}
```

> 后端表为 `student_point_logs`，列对应关系见[平台数据表参考](../reference/platform-data-tables)。

### 引擎门面接口（均为单方法，`interfaces.ts`）

```typescript
ILessonEngineService          { getRuntime(): Promise<unknown>; }
IClassroomRuntimeService      { getRuntimeKernel(): Promise<unknown>; }
IPresenceEngineService        { getPresenceEngine(): Promise<unknown>; }
ITeachingCollaborationService { getCollaborationEngine(): Promise<unknown>; }
ILearningAnalyticsService     { getAnalyticsEngine(): Promise<unknown>; }
IAICapabilityService          { getCapabilityKernel(): Promise<unknown>; }
ICapabilityRuntimeService     { getRuntimeKernel(): Promise<unknown>; }
ICapabilityGovernanceService  { getGovernanceKernel(): Promise<unknown>; }
IPlatformServiceRegistryService { getServiceRegistryKernel(): Promise<unknown>; }
```

### `IActivityRegistryToken` → `ActivityRegistry`（Token 与实现见 `packages/activity-ecosystem/index.ts` 的 `IActivityRegistryToken` 与 `packages/activity-ecosystem/registry.ts` 的 `ActivityRegistry`；Token 标识串为 `@openlearn/activity-ecosystem:IActivityRegistry`，**不在 `packages/core/di/interfaces.ts`**）

> ⚠️ **同名不同类**：`packages/core/lesson-engine/activity-registry.ts` 也有一个名为 `ActivityRegistry` 的类，但它基于 `ActivityDefinition` / `registerActivity`，方法集完全不同，且**全仓无任何导入者**。本节列出的方法属于 `packages/activity-ecosystem` 那一份（`server.ts` 在 `startServer()` 中实例化并注册的就是它）。

```typescript
registerProvider(provider: ActivityProvider): void;
unregisterProvider(id: string): boolean;
getProvider(id: string): ActivityProvider | undefined;
listProviders(): ReadonlyArray<ActivityProvider>;
listDescriptors(): ActivityProviderDescriptor[];
listByRole(role: ActivityRole): ActivityProvider[];
listByCategory(category: ActivityCategory): ActivityProvider[];
startActivity(id: string, context: ActivityContext, payload?: Record<string, unknown>, actorId?: string): Promise<StartActivityResult>;
clear(): void;
```

### `IAuthSessionBridgeToken` → `IAuthSessionBridgeService`（`packages/core/di/interfaces.ts`，v0.3.15+）

```typescript
createSession(user: AuthBridgeUser): Promise<{ token: string; maxAge: number }>;
```

**`AuthBridgeUser` 字段**（`packages/core/di/interfaces.ts`）：

```typescript
interface AuthBridgeUser {
  userId: string;
  username: string;
  role: 'administrator' | 'teacher' | 'student';
  name?: string;
  email?: string;
  avatar?: string | null;
  classId?: string;
}
```

> 特权认证服务，用于 LTI 1.3、SAML 等第三方 SSO 认证插件即时建档、生成会话并由安全网关自动写入跨域安全 Cookie。

### `IStageGuardService`（`packages/core/di/interfaces.ts`）

```typescript
registerGuard(guard: StageGuard): () => void;
unregisterGuard(guardId: string): void;
listGuards(): StageGuard[];
checkAccess(ctx: StageGuardContext): Promise<StageGuardResult>;
```

> 教学环节流转门禁服务。支持第三方插件注册环节准入守卫（例如随堂测验达标、前置实验文件已提交等）。
> 内核内置 **1500ms 超时**与 **多插件全部满足 (AND 组合判定)** 机制。
> 守卫**超时或抛异常时拒绝进入**（Fail-Close，D-3 决策）；需恢复早期 Fail-Open 行为可传 `{ onGuardFailure: 'fail-open' }`。详见 [docs/lesson/lesson-runtime.md](../lesson/lesson-runtime.md)。

### 日志（`ctx.log`，无 Token）

```typescript
interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

---

## 4. ⚠️ 不存在的 Token（切勿捏造）

经全仓检索（`packages/`），以下常被误以为存在的 Token **并不存在**，若 `ctx.resolve` 会失败或类型缺失：

- **`IWhiteboardToken`** —— 不存在。白板能力经由 `ICommandBusService` / `IEventBusService`（事件如 `whiteboard.element_drawn`）或类型辅助 `IWhiteboardServiceContract`（仅类型、`plugin-sdk/index.ts`，非 Token）间接获取。
- **`IAuthToken` / `IUserToken` / `IAuthServiceToken` / `IUserContextToken`** —— 不存在。普通鉴权由服务端中间件自动接管。需要为外部身份签发会话的特权插件请且仅使用官方的 `IAuthSessionBridgeToken`。
- **`ILoggerToken`** —— 不存在。日志经 `ctx.log: IPluginLogger` 提供，不可 `resolve`。
- **`IPluginRuntimeToken` / `IUnifiedPluginContextToken`** —— 不存在。`IPluginRuntime` / `IUnifiedPluginContext` 是导出**类型**（适配器），但未定义对应 `Token<T>`，无法传给 `ctx.resolve`。

---

## 5. 组合根（Composition Root）

所有 Token 在 `packages/core/kernel/index.ts` 绑定到具体实例（`kernelContainer.serviceRegistry.register(...)`），包含 `IAuthSessionBridgeToken` 等平台级核心单例。`server.ts` 另外补充绑定 `IActivityRegistryToken`、`IClassroomLifecycleServiceToken` 与 `IInteractionRuntimeServiceToken`。插件无需关心绑定细节，直接 `ctx.resolve(Token)` 即可。

> ⚠️ **已知缺口**：`IClassroomCountdownServiceToken` 目前**只有 Token 与接口定义，尚无内核实现与注册**（课堂倒计时实际由 `server/routes/classroom.ts` 的 HTTP/Socket 路由实现）。在服务端补齐注册前，`ctx.resolve(IClassroomCountdownServiceToken)` 会失败——请勿在插件中使用该 Token，倒计时请消费 `classroom:countdown_updated` Socket 事件。

> 最后更新：2026-10-03
