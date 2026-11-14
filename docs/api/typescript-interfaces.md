# TypeScript Interfaces 规范

<!-- doc-version: sdk=3.8.0 -->

汇总 `@openlearn/plugin-sdk@3.8.0` 与 `packages/core/` 定义的核心 TS 接口。SDK 以导出**类型 + DI Token 值**为主，另含少量运行时值（`PluginState` 枚举、`CapabilityRegistry` / `ServiceScope`、活动生态的 `BaseActivityProvider` / `defineActivityProvider` 等）。

---

## 1. 插件上下文

### `PluginContext`（后端）

插件 `activate(ctx)` 收到的上下文，完整定义见 [DI Token 字典](di-tokens.md) 第 1 节。核心成员：

```typescript
interface PluginContext {
  services: {
    commandBus: ICommandBusService | null;
    eventBus: IEventBusService | null;
    actionRegistry: IActionRegistryService | null;
    capability: ICapabilityService | null;
    processManager: IProcessService | null;
    storage: IStorageService | null;
    ai: IAIService | null; // Provider 未配置时为 null
    pointsDimension: IPointsDimensionRegistry | null;
    pointsLedger: IPointsLedgerService | null;
  };
  pluginId: string; // plugins 表的行 UUID，**不是** manifest.id
  manifest: Manifest;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>; // 仅 inline
  db: PluginDatabaseAPI;
  log: IPluginLogger;
  config: IConfigService; // 仅 inline
  contributions: ContributionAccessor; // 仅 inline
  http: IPluginHttpRouter;
  i18n: PluginI18nAPI; // 仅 inline
  require(moduleName: string): any;
}
```

> ⚠️ **没有 `reportProgress`**：`reportProgress?(stage?, message?)` **不在** `PluginContext` 的任何类型定义中，仅由 `worker_threads` / `process` 引导脚本在构建上下文时运行时注入（内部向父进程发 `activate-progress` 消息）。因此在 `activate(ctx: PluginContext)` 中直接写 `ctx.reportProgress(...)` **会类型报错**；需要时应先做类型断言并判空（inline 模式下该字段为 `undefined`）。

> `services` 下的 **9 个** key 运行时都可能是 `| null`（D-12 降级），调用前需统一判空。

### `FrontendPluginContext`（前端）

前端插件 `activate(ctx)` 收到的上下文，见 [UI 扩展槽位](../reference/plugin-ui-extension-slots.md) 第 3 节：

```typescript
interface FrontendPluginContext {
  services: { frontendApi: IFrontendAPI; socketService: ISocketService; uiService: IUIService; storageService: IStorageService };
  pluginId: string;
  manifest: FrontendPluginManifest;
  dispatcher: IHostActionDispatcher; // v5.3：受控宿主动作（刷新 / 弹窗 / Toast）
  ui: {
    registerExtensionPoint(slot, config): void;
    unregisterExtensionPoint(slot, id): void; // 仅允许注销本插件的扩展点
    registerFullscreenRenderer(type, renderer): void; unregisterFullscreenRenderer(type): void;
    registerPropertyEditor(type, editor): void; unregisterPropertyEditor(type): void;
    registerCoursewareSource(loader): void; unregisterCoursewareSource(id): void;
    registerPaletteItem(item): void; unregisterPaletteItem(type): void;
    registerSegmentType(type): void; unregisterSegmentType(id): void;
    registerAssignmentQuestionRenderer(config): void; unregisterAssignmentQuestionRenderer(quizType): void;
    registerAssessmentQuestionType(config): void; unregisterAssessmentQuestionType(type): void;
  };
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>; // 自动加插件命名空间前缀
  i18n?: { t(key, defaultValueOrParams?, maybeParams?): string; getLanguage(): string };
  navigation?: { getTeacherTab(): string; setTeacherTab(tab: string): void; setSelectedLesson?(lessonId: string | null): void; subscribeTeacherTab(cb: (tab: string) => void): () => void };
  context?: { get(): { lessonId: string | null; classId: string | null }; subscribe(cb: (ctx: FrontendPluginContextSnapshot) => void): () => void }; // v0.2.8+
  registerPanel? / registerMenu? / registerToolbarButton?;   // 兼容 shim
}
```

---

## 2. 服务接口（`packages/core/di/interfaces.ts`）

完整方法签名见 [DI Token 字典](di-tokens.md) 第 3 节：

| 接口                        | 用途                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ICommandBusService`        | 命令总线（execute / registerHandler / createCommand / setInterceptor）                                                                                                                                                                                                                                                            |
| `IEventBusService`          | 事件总线（publish / subscribe / unsubscribe）                                                                                                                                                                                                                                                                                     |
| `IActionRegistryService`    | AI Action 注册表                                                                                                                                                                                                                                                                                                                  |
| `ICapabilityService`        | 权限校验（grant / revokeAll / check）                                                                                                                                                                                                                                                                                             |
| `IProcessService`           | 受控后台进程（spawn / kill / registerHandler / registerInterval）                                                                                                                                                                                                                                                                 |
| `IStorageService`           | 键值存储（get / set / delete）                                                                                                                                                                                                                                                                                                    |
| `IAIService`                | AI 文本生成：`generateText`（必选）+ 5 个可选成员——`registerAIContextProvider?` / `unregisterAIContextProvider?`（AI 上下文切片提供者，**仅 inline 可用**，回调函数无法跨 Worker 序列化边界）；`registerAIPersona?` / `listAIPersonas?` / `unregisterAIPersona?`（AI Agent 角色模板，Inline / Worker 均可，builtin 角色不可注销） |
| `ISemesterGradeService`     | 学期成绩（saveSemesterGrade）                                                                                                                                                                                                                                                                                                     |
| `IAuthSessionBridgeService` | 统一安全会话桥接（createSession，用于 LTI 1.3 / SSO）                                                                                                                                                                                                                                                                             |
| `IPointsDimensionRegistry`  | 积分维度（registerDimension / getDimension / listDimensions）                                                                                                                                                                                                                                                                     |
| `IPointsLedgerService`      | 积分流水（addPoints / getLogs / …）                                                                                                                                                                                                                                                                                               |
| 引擎门面                    | `ILessonEngineService` / `IClassroomRuntimeService` / `IPresenceEngineService` / `ITeachingCollaborationService` / `ILearningAnalyticsService` / `IAICapabilityService` / `ICapabilityRuntimeService` / `ICapabilityGovernanceService` / `IPlatformServiceRegistryService`（均为 `getX(): Promise<unknown>` 薄门面）              |

---

## 3. 数据库接口

### `PluginDatabaseAPI`（`ctx.db`）

见 [插件数据库 API](../reference/plugin-database-api.md)。

### `SqliteDatabase` / `SqliteStatement`（`IDatabaseToken` 解析类型）

`better-sqlite3.Database` 的 SDK 内联声明：`prepare()` / `transaction()` / `exec()` / `pragma()` / `close()`。

---

## 4. 插件平台接口（P7-A2）

`IPluginLifecycleManager` / `IPluginDistributionManager` / `ICapabilityRegistry` 及其类实现，完整方法签名见 [DI Token 字典](di-tokens.md) 第 3 节。

> `PluginRuntimeComposition` / `UnifiedExtensionRegistry` / `PluginRuntimeAdapter` / `PluginContextAdapter` 等门面类型已在 SDK 3.9.0 标记弃用（`@deprecated`，计划于 4.0.0 移除，Refs #398），对应 Token 已收回且**零生产消费**，插件无法且不应 `ctx.resolve` 它们。扩展注册请使用 `ContributionRegistry`（`IContributionRegistryToken`），生命周期使用 `PluginLifecycleManager`，需要 AI 能力请用 `ctx.services.ai`（见 [能力提供方框架](../reference/capability-provider-framework.md)）。

---

## 5. Manifest / 贡献点

- `Manifest` / `ManifestV3` —— 见 [插件 Manifest 规范](../plugin/plugin-manifest-spec.md)。
- `ContributionConfig` 联合类型（共 109 个成员；常见如 `ClassroomToolConfig` / `TeacherTabConfig` / `DashboardWidgetConfig` / `StudentViewConfig` / `StudentLessonToolConfig` / `HelpDocConfig`）—— 完整清单见 [UI 扩展槽位](../reference/plugin-ui-extension-slots.md)。
- `ExtensionSlot` / `ExtensionPointConfig` —— 见 [UI 扩展槽位](../reference/plugin-ui-extension-slots.md)。

---

## 6. 活动生态 / 能力框架

- 活动生态：`ActivityProvider` / `ActivityProviderDescriptor` / `ActivityContext` / `ActivityRegistry` / `BaseActivityProvider` / `defineActivityProvider` —— 见 [活动生态开发指南](../reference/activity-ecosystem.md)。
- 能力框架：`CapabilityDescriptor` / `ICapabilityProviderHandler` / `CapabilityContext` / `InvocationRequest` / `CapabilityResult` —— 见 [能力 Provider 框架](../reference/capability-provider-framework.md)。

---

## 7. 引擎 / 领域类型（仅类型，无 Token）

SDK 额外导出了各引擎的**纯类型**（仅供类型断言，无对应 `Token<T>`，无法 `ctx.resolve`）：

- **课堂运行时**：`RuntimeLifecycleState` / `RuntimeRole` / `RuntimePermission` / `RuntimeStateTree` / `IRuntimeService` / `IRuntimeModule` / `RuntimeSnapshot` 等。
- **课程引擎**：`Lesson` / `Flow` / `Stage` / `Activity` / `ActivityDefinition` / `ActivityConfig` / `StageAnalytics` / `LessonSnapshot` 等。
- **分析引擎**：`NormalizedAnalyticsEvent` / `HighLevelIndicators` / `StudentAnalyticsModel` / `GroupAnalyticsModel` / `AnalyticsInsight` / `PredictionResult` 等。
- **协同引擎**：`Participant` / `CollaborationPermission` / `GroupData` / `SharedObjectData` / `SyncMessage` 等。
- **在线状态引擎**：`PresenceEntity` / `EntityType` / `FocusState` / `TeacherStatus` / `PresenceDashboardMetrics` 等。
- **AI 能力**：`IAICapability` / `IChatCapability` / `ICompletionCapability` / `IToolCapability` / `ILessonCapability` / `IWhiteboardCapability` / `IAnalyticsCapability` / `IPluginCapability`。
- **能力治理**：`GovernanceSpecification` / `CapabilityLifecycleStatus` / `ApprovalTier` / `VisibilityTier` / `CapabilityHealthMetrics`。
- **服务注册**：`ServiceDescriptor` / `ServiceScope` / `ServiceLifecycleState` / `ServiceInspectionInfo` / 各类 `*ServiceContract`。

> 这些类型对应的引擎实例需通过引擎门面 Token（如 `ILessonEngineServiceToken.getRuntime()`）获取，返回值类型为 `unknown`，插件需自行断言后再使用。**不建议插件深度依赖这些内部引擎类型**，除非确有需要。

---

## 8. 不存在的 Token（切勿捏造）

见 [DI Token 字典](di-tokens.md) 第 4 节：`IWhiteboardToken` / `IAuthToken` / `ILoggerToken` / `IPluginRuntimeToken` / `IUnifiedPluginContextToken` 等均**不存在**。

---

## 9. 文件存储三插槽接口（v0.7.15+）

`#504` 统一文件持久化层在 `packages/core/di/interfaces.ts` 定义、并由 `@openlearn/plugin-sdk` 导出以下类型。它们只描述**内核宿主 / 同进程受信任扩展**的插槽契约；第三方 `process` / `worker` 插件不跨 IPC 传递 `Buffer` / `Readable` 流：

| 类型                                                  | 作用                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FilePurpose`                                         | `courseware` / `avatar` / `assignment` / `lesson-asset` / `theme` / `attachment`                  |
| `FileAccessScope`                                     | `public` / `authenticated` / `assignment`                                                         |
| `FileAssetContext`                                    | 写入时携带的 `purpose`、作者 / 课程 / 课节 / 作业 / 班级与 `metadata`                             |
| `FileStorageBackend`                                  | 物理后端：`put` / `exists` / `stat` / `readStream` / `delete`（可选 `copy` / `getSignedUrl`）     |
| `FileStorageBackendCapabilities`                      | `supportsRange` / `supportsPresignedUrl` / `externalBacked` / `maxFileSizeBytes`                  |
| `FileProcessor`                                       | 生命周期处理器：`before-store` / `after-store` / `before-serve`；可按 MIME / purpose / 扩展名匹配 |
| `FileProcessorContext`                                | 处理器入参：资产上下文、字节、哈希、`localPath` 与累计 `metadata`                                 |
| `FileProcessorResult`                                 | 可改写 buffer / MIME / 文件名，或返回 `metadataPatch`、响应头                                     |
| `FileLayoutTokenResolver`                             | 自定义目录模板变量解析器（如 `{school}`）                                                         |
| `IRegisteredFileBackend` / `IRegisteredFileProcessor` | 注册表内的 `{ owner, backend/processor }` 包装项                                                  |
| `IFileStorageExtensionRegistry`                       | 注册 / 注销后端与处理器、注册布局变量、按 owner 清理                                              |

```typescript
interface IFileStorageExtensionRegistry {
  registerBackend(owner: string, backend: FileStorageBackend): void;
  unregisterBackend(owner: string, id: string): boolean;
  getBackend(id: string): FileStorageBackend | undefined;
  listBackends(): IRegisteredFileBackend[];

  registerProcessor(owner: string, processor: FileProcessor): void;
  unregisterProcessor(owner: string, id: string): boolean;
  listProcessors(stage?: FileProcessorStage): IRegisteredFileProcessor[];

  registerLayoutToken(owner: string, tokenName: string, resolver: FileLayoutTokenResolver): void;
  unregisterLayoutToken(owner: string, tokenName: string): boolean;
  getLayoutTokenResolvers(): ReadonlyMap<string, { owner: string; resolver: FileLayoutTokenResolver }>;

  clear(owner?: string): void;
  listOwners(): string[];
}
```

Token 与详细插槽语义见 [DI 字典](di-tokens.md) §2.I 与[文件存储扩展设计](../architecture/file-storage-extension-design.md) §4。

> 最后更新：2026-11-14
