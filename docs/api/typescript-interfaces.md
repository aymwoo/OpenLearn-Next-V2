# TypeScript Interfaces 规范

汇总 `@openlearn/plugin-sdk@3.5.2` 与 `packages/core/` 定义的所有核心 TS 接口。SDK 仅导出**类型 + Token 值**，不含运行时代码。

---

## 1. 插件上下文

### `PluginContext`（后端）
插件 `activate(ctx)` 收到的上下文，完整定义见 [DI Token 字典](di-tokens) 第 1 节。核心成员：

```typescript
interface PluginContext {
  services: { commandBus; eventBus; actionRegistry; capability; processManager; storage; ai };
  pluginId: string;
  manifest: Manifest;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  db: PluginDatabaseAPI;
  log: IPluginLogger;
  config: IConfigService;
  contributions: ContributionAccessor;
  require(moduleName: string): unknown;
}
```

### `FrontendPluginContext`（前端）
前端插件 `activate(ctx)` 收到的上下文，见 [UI 扩展槽位](../reference/plugin-ui-extension-slots) 第 3 节：

```typescript
interface FrontendPluginContext {
  services: { frontendApi; socketService; uiService; storageService };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: { registerExtensionPoint; unregisterExtensionPoint };
  invokeCommand<T>(type: string, payload?: unknown): Promise<T>;
  navigation: { getTeacherTab; setTeacherTab; subscribeTeacherTab };
  registerPanel? / registerMenu? / registerToolbarButton?;   // 兼容 shim
}
```

---

## 2. 服务接口（`packages/core/di/interfaces.ts`）

完整方法签名见 [DI Token 字典](di-tokens) 第 3 节：

| 接口 | 用途 |
|---|---|
| `ICommandBusService` | 命令总线（execute / registerHandler / createCommand / setInterceptor） |
| `IEventBusService` | 事件总线（publish / subscribe / unsubscribe） |
| `IActionRegistryService` | AI Action 注册表 |
| `ICapabilityService` | 权限校验（grant / revokeAll / check） |
| `IProcessService` | 受控后台进程（spawn / kill / registerHandler / registerInterval） |
| `IStorageService` | 键值存储（get / set / delete） |
| `IAIService` | AI 文本生成（generateText） |
| `ISemesterGradeService` | 学期成绩（saveSemesterGrade） |
| `IPointsDimensionRegistry` | 积分维度（registerDimension / getDimension / listDimensions） |
| `IPointsLedgerService` | 积分流水（addPoints / getLogs / …） |
| 引擎门面 | `ILessonEngineService` / `IClassroomRuntimeService` / `IPresenceEngineService` / `ITeachingCollaborationService` / `ILearningAnalyticsService` / `IAICapabilityService` / `ICapabilityRuntimeService` / `ICapabilityGovernanceService` / `IPlatformServiceRegistryService`（均为 `getX(): Promise<unknown>` 薄门面） |

---

## 3. 数据库接口

### `PluginDatabaseAPI`（`ctx.db`）
见 [插件数据库 API](../reference/plugin-database-api)。

### `SqliteDatabase` / `SqliteStatement`（`IDatabaseToken` 解析类型）
`better-sqlite3.Database` 的 SDK 内联声明：`prepare()` / `transaction()` / `exec()` / `pragma()` / `close()`。

---

## 4. 插件平台接口（P7-A2）

`IPluginLifecycleManager` / `IPluginDistributionManager` / `IPluginRuntimeComposition` / `IUnifiedExtensionRegistry` / `IPluginCapabilityGateway` 及其类实现，完整方法签名见 [DI Token 字典](di-tokens) 第 3 节。

---

## 5. Manifest / 贡献点

- `Manifest` / `ManifestV3` —— 见 [插件 Manifest 规范](../plugin/plugin-manifest-spec)。
- `ContributionConfig` 联合类型（`ClassroomToolConfig` / `TeacherTabConfig` / `DashboardWidgetConfig` / `StudentViewConfig` / `StudentLessonToolConfig` / `HelpDocConfig`）—— 见 [UI 扩展槽位](../reference/plugin-ui-extension-slots)。
- `ExtensionSlot` / `ExtensionPointConfig` —— 见 [UI 扩展槽位](../reference/plugin-ui-extension-slots)。

---

## 6. 活动生态 / 能力框架

- 活动生态：`ActivityProvider` / `ActivityProviderDescriptor` / `ActivityContext` / `ActivityRegistry` / `BaseActivityProvider` / `defineActivityProvider` —— 见 [活动生态开发指南](../reference/activity-ecosystem)。
- 能力框架：`CapabilityDescriptor` / `ICapabilityProviderHandler` / `CapabilityContext` / `InvocationRequest` / `CapabilityResult` —— 见 [能力 Provider 框架](../reference/capability-provider-framework)。

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

见 [DI Token 字典](di-tokens) 第 4 节：`IWhiteboardToken` / `IAuthToken` / `ILoggerToken` / `IPluginRuntimeToken` / `IUnifiedPluginContextToken` 等均**不存在**。

> 最后更新：2026-08-29
