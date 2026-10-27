/**
 * @openlearn/plugin-sdk — 插件开发类型定义包（V3.3）
 *
 * 为 OpenLearn 插件开发者提供类型安全的 API 契约。
 * 仅包含类型 + Token 值，不包含运行时代码。
 *
 * 用法：
 *   import type { PluginContext, Manifest } from '@openlearn/plugin-sdk';
 *   import { ICommandBusServiceToken } from '@openlearn/plugin-sdk';
 *
 * P7-A2 统一插件服务（已接入内核，插件可经 ctx.resolve 消费）：
 *   import { IPluginLifecycleManagerToken, IPluginCapabilityGatewayToken } from '@openlearn/plugin-sdk';
 *   const lifecycle = await ctx.resolve(IPluginLifecycleManagerToken); // 类型: PluginLifecycleManager
 *   const gateway = await ctx.resolve(IPluginCapabilityGatewayToken);   // 类型: PluginCapabilityGateway
 *   await lifecycle.uninstallPlugin(pluginId);
 *   gateway.listCapabilities().forEach((c) => console.log(c.id));
 */

// ── Plugin Context & Lifecycle ──────────────────────────────────────────

export type {
  PluginContext,
  PluginDatabaseAPI,
  PluginInfo,
  Disposable,
  IPluginLogger,
  ContributionAccessor,
  PluginApiRequest,
  PluginApiResponse,
  PluginApiHandler,
  PluginStreamResponse,
  PluginStreamHandler,
  IPluginHttpRouter,
} from '../core/plugin-host/types.js';

// `PluginState` 在源码里是 **enum**（运行时值），必须走 value 再导出，
// 否则消费侧 `PluginState.ACTIVE` 报 TS1362。
export { PluginState } from '../core/plugin-host/types.js';

export { PluginHttpRouter } from '../core/plugin-host/http-router.js';
export { CAP_STUDENT_DATA_READ, CAP_STUDENT_DATA_WRITE } from '../core/plugin-host/method-policy.js';

// ── Unified Foundation Layer (P7 Sprints) ──────────────────────────────

export type {
  IPluginRuntime,
  IUnifiedPluginContext,
  IPluginLifecycleManager,
  IPluginCapabilityGateway,
  IUnifiedExtensionRegistry,
  IPluginDistributionManager,
  CapabilityMetadata,
  ExtensionItemMetadata,
} from '../core/plugin-host/index.js';

// ⚠️ 7 个宿主内部类：**只以类型形式**对外暴露（3.7.2 起）。
//
// 历史：它们一度被放进上面的 `export type` 块，于是消费侧写 `new X(...)` 时拿到
// `TS1362: cannot be used as a value because it was exported using 'export type'`。
// 为消除该报错，曾改成值导出 —— 代价是把整条 `packages/core` 实现链（含
// `core/version.ts` 的 `import fs from 'node:fs'`）内联进 `dist/index.js`：
// 产物 13 KB → 75 KB，开头出现 `node:fs` / `node:path` / `node:url` / `node:crypto`
// 静态导入。任何把 SDK 打进 worker bundle 的第三方插件（`external: []`）都会在
// 「产物不得残留 import」自检上失败 —— class_manager 实测，CI 作业
// `Third-party plugin compatibility` 连续红。
//
// 权衡：TS1362 是**编译期**报错（看得见、可定位）；把 node 内置模块打进插件产物
// 是**运行期**崩溃（插件作者完全无从判断）。所以选类型导出。
//
// 宿主侧要用这些类请从 `packages/core/plugin-host/*.js` 直接导入 ——
// `packages/core/kernel/index.ts` 就是这么做的，SDK 不是宿主的内部依赖通道。
//
// 若将来真的出现「仓库外消费者需要 new 出来」的场景，正确做法是把该类下沉到
// 独立包，而不是重新值导出。
export type { PluginRuntimeAdapter } from '../core/plugin-host/plugin-runtime-adapter.js';
export type { PluginRuntimeComposition } from '../core/plugin-host/plugin-runtime-composition.js';
export type { PluginContextAdapter } from '../core/plugin-host/plugin-context-adapter.js';
export type { PluginLifecycleManager } from '../core/plugin-host/plugin-lifecycle-manager.js';
export type { PluginCapabilityGateway } from '../core/plugin-host/plugin-capability-gateway.js';
export type { UnifiedExtensionRegistry } from '../core/plugin-host/unified-extension-registry.js';
export type { PluginDistributionManager } from '../core/plugin-host/plugin-distribution-manager.js';

// ── Configuration Service (V3.2) ────────────────────────────────────────

export type { IConfigService, ConfigProperty, ConfigDeclaration } from '../core/plugin-host/config-service.js';

// ── Contribution Registry (V3.2) ────────────────────────────────────────

export type {
  ContributionSummary,
  ClassroomToolConfig,
  TeacherTabConfig,
  DashboardWidgetConfig,
  StudentViewConfig,
  StudentLessonToolConfig,
  AnchorToolConfig,
  HelpDocConfig,
  QuickActivityConfig,
  TimelineSegmentConfig,
  PaletteItemContributionConfig,
  CockpitWidgetConfig,
  StageCardConfig,
  ClassroomTopbarActionConfig,
  ClassroomAttributionAwardConfig,
  StudentCompetencyDimensionConfig,
  StudentProfileWidgetConfig,
  CanvasWidgetConfig,
  BarometerMetricConfig,
  PeerReviewRubricConfig,
  PeerReviewBadgeConfig,
  PreclassPasscodeActionConfig,
  PreclassPasscodeAddonConfig,
  CommandPaletteItemConfig,
  QuickInsertItemConfig,
  AIPromptTemplateConfig,
  AISkillProviderConfig,
  ClassTabConfig,
  ClassBatchActionConfig,
  StudentRowPanelConfig,
  EditorHeaderActionConfig,
  PostClassWidgetConfig,
  CoursewareViewerToolbarConfig,
  CoursewareViewerOverlayConfig,
  PortalTelemetryConfig,
  PortalCourseBadgeConfig,
  PortalTeachingModeConfig,
  PortalInsightConfig,
  PortalPreflightConfig,
  PortalLaunchActionConfig,
  CountdownWidgetConfig,
  CountdownActionConfig,
  StudentCountdownConfig,
  StudentQuickActionsItemConfig,
  StudentQuickActionsActionConfig,
  StudentQuickActionsFabConfig,
  NotificationTabsConfig,
  PacingDashboardConfig,
  DiagnosticFeedConfig,
  CollabCanvasConfig,
  TopbarPillConfig,
  AttributionActionConfig,
  LeaderboardActionConfig,
  StudentProfileActionConfig,
  StudentProfileTimelineItemConfig,
  ClassroomHeaderActionConfig,
  ClassroomAgendaActionConfig,
  WhiteboardDockPluginConfig,
  ClassroomAuditEventConfig,
  PeerReviewActionConfig,
  PeerReviewShowcaseWidgetConfig,
  SeatingToolbarConfig,
  SeatingLegendConfig,
  SeatingSeatBadgeConfig,
  SeatingSeatActionsConfig,
  SeatingSummaryConfig,
  WhiteboardAutosaveStatusConfig,
  WhiteboardAutosaveActionConfig,
  TeacherPanelConfig,
  StudentFullscreenConfig,
  GlobalSettingConfig,
  NavUserMenuConfig,
  CourseListToolbarActionConfig,
  CourseCardActionConfig,
  CourseCardBadgeConfig,
  EditorSegmentActionConfig,
  ClassroomCockpitDrawerItemConfig,
  ClassroomAlertBannerConfig,
  ClassroomStageDisplayTickerConfig,
  ClassroomPostClassExporterConfig,
  TimetableToolbarActionConfig,
  TimetableCardBadgeConfig,
  ComputerLabToolbarActionConfig,
  ComputerLabSeatOverlayConfig,
  ComputerLabSeatingToolbarConfig,
  ComputerLabUnassignedItemConfig,
  ComputerLabSeatingSidebarConfig,
  StudentDashboardHeroWidgetConfig,
  StudentAssignmentToolbarActionConfig,
  StudentLessonNotesAddonConfig,
  StudentLessonToolboxConfig,
  AdminDashboardCardConfig,
  AdminUserActionConfig,
  HeaderStatusPillConfig,
  AISidebarTabConfig,
  AssignmentGradeToolbarActionConfig,
  AssignmentGradeItemAddonConfig,
  AssignmentGradeRubricAddonConfig,
  StudentSegmentGateFallbackConfig,
  EditorSegmentTypeConfigConfig,
  TimetableImportSourceConfig,
  TimetableEntryActionConfig,
  ClassroomActiveSegmentMainConfig,
  StudentAcademicYearMetricCardConfig,
  EditorTimelineNodeBadgeConfig,
  StudentSegmentBadgeConfig,
  HeaderAsyncTaskItemConfig,
  ContributionConfig,
} from '../core/plugin-host/contribution-registry.js';

// ── Manifest ────────────────────────────────────────────────────────────

export type { Manifest, ManifestV3 } from '../core/esm-loader/manifest-schema.js';

// ── DI / Tokens ─────────────────────────────────────────────────────────

// V3.2: Token class export for plugin DI provide/consume
export { Token } from '../core/di/token.js';

export type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
  AIPersonaDefinition,
  ILessonEngineService,
  IClassroomRuntimeService,
  IPresenceEngineService,
  ITeachingCollaborationService,
  ILearningAnalyticsService,
  IAICapabilityService,
  IAssessmentGraderRegistry,
  IAssessmentQuestionTypeSummary,
  CoursewareRuntimeScript,
  IRegisteredCoursewareRuntimeScript,
  ICoursewareRuntimeScriptRegistry,
  CommandHandler,
  CommandMetadata,
  EventSubscriber,
} from '../core/di/interfaces.js';

export {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
  IPluginHostToken,
  ISemesterGradeServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  ILessonEngineServiceToken,
  IClassroomRuntimeServiceToken,
  IPresenceEngineServiceToken,
  ITeachingCollaborationServiceToken,
  ILearningAnalyticsServiceToken,
  IAICapabilityServiceToken,
  ICapabilityRuntimeServiceToken,
  IPlatformServiceRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  ICapabilityRegistryToken,
  IAuthSessionBridgeToken,
  ICoursewareRuntimeScriptRegistryToken,
  IStageGuardServiceToken,
} from '../core/di/interfaces.js';

// ── 已收回对外承诺的 Token（@deprecated，随 SDK 3.8.0 移出导出）────────────
//
// 审计项 M-10 / F-3：`kernel/index.ts:224-226` 把这三个注册进 ServiceRegistry，
// 但**零生产 resolve** —— 全仓唯一的提及是本文件顶部的一段注释示例。
// D-2/D-6 决策：标 `@deprecated` 并移出导出。
//
// 影响面已核实：`grep -rlE "IUnifiedExtensionRegistry|IPluginCapabilityGateway|
// IPluginRuntimeComposition" v2_plugins/ assets/` 零命中，三个脚手架模板也都没用到。
//
// 内核侧引用不受影响（走 packages/core 相对路径）。若将来接入真实消费者，把它们
// 加回上面的 value 导出块，并同步恢复 openlearn.d.ts 末尾导出块里的对应名字
// （generate-dts.mjs 会自动补齐 export 漏洞）。
//
// export type { ICapabilityGovernanceServiceToken }  ← 同 F-2，见下方注释

export type {
  PointsDimensionSpec,
  IPointsDimensionRegistry,
  PointLogItem,
  IPointsLedgerService,
  IAuthSessionBridgeService,
  AuthBridgeUser,
  StageGuardContext,
  StageGuard,
  IStageGuardService,
} from '../core/di/interfaces.js';

export type {
  IAICapability,
  IChatCapability,
  ICompletionCapability,
  IToolCapability,
  ILessonCapability,
  IWhiteboardCapability,
  IAnalyticsCapability,
  IPluginCapability,
} from '../core/ai-capability/index.js';

// `CapabilityRegistry` 在源码里是 **class**（运行时值），见 generate-dts.mjs 反向体检。
export { CapabilityRegistry } from '../core/ai-capability/registry/capability-registry.js';

export type {
  CapabilityDescriptor,
  CapabilityContext,
  CapabilityRole,
  CapabilityCategory,
  ResultType,
  InvocationRequest,
  CapabilityResult,
  ICapabilityProviderHandler,
} from '../core/capability/index.js';

// ── Capability Governance (@experimental，已移出 SDK 导出) ────────────────
//
// 审计项 M-9 / F-2：capability-governance 子系统（529 行）在内核启动时被实例化并
// 注册进 DI，但**零生产 resolve**。D-2 决策：标 `@experimental` 并收回对外承诺。
//
// 这段导出在 SDK 3.8.0 中移除。外部插件若曾 import 这些类型会编译失败 —— 这是有意的：
// 对外承诺一个零消费者的 API 比不承诺更糟。若将来接入真实调用路径并稳定，把
// `export type { … }` 加回并去掉 index.ts 里的 @experimental 注释即可。

export type {
  ServiceDescriptor,
  ServiceLifecycleState,
  ServiceInspectionInfo,
  IAIServiceContract,
  ILessonServiceContract,
  IWhiteboardServiceContract,
  IAnalyticsServiceContract,
  IStorageServiceContract,
  IPluginServiceContract,
  IRuntimeServiceContract,
} from '../core/service-registry/index.js';

// `ServiceScope` 在源码里是 **class**（运行时值），见 generate-dts.mjs 反向体检。
export { ServiceScope } from '../core/service-registry/index.js';

// ── Learning Analytics Engine ───────────────────────────────────────────

export type {
  NormalizedAnalyticsEvent,
  RawAnalyticsMetrics,
  HighLevelIndicators,
  StudentAnalyticsModel,
  GroupAnalyticsModel,
  LessonAnalyticsModel,
  WhiteboardAnalyticsModel,
  CodeAnalyticsModel,
  QuizAnalyticsModel,
  AIAnalyticsModel,
  AnalyticsInsight,
  PredictionResult,
  AnalyticsPrivacyConfig,
  CustomMetricDefinition,
  CustomIndicatorDefinition,
  CustomInsightRule,
} from '../core/analytics-engine/index.js';

// ── Teaching Collaboration Engine ───────────────────────────────────────

export type {
  Participant,
  ParticipantRole,
  CollaborationPermission,
  CollaborationMode,
  GroupData,
  GroupWorkspaceData,
  SharedObjectData,
  ObjectLock,
  SyncType,
  SyncMessage,
  CollaborationAnalyticsData,
  CollaborationEventType,
  CollaborationEventMap,
} from '../core/collaboration-engine/index.js';

// ── Presence Engine ─────────────────────────────────────────────────────

export type {
  PresenceEntity,
  EntityType,
  EntityRole,
  FocusState,
  ConnectionState,
  InteractionSignal,
  TeacherStatus,
  StudentStatus,
  AIStatus,
  PluginStatus,
  WhiteboardStatus,
  StageStatus,
  GroupStatus,
  GroupPresenceData,
  PresenceDashboardMetrics,
  PresencePrivacyConfig,
  PresenceDiff,
  PresenceEventType,
  PresenceEventMap,
  CustomPresenceDefinition,
} from '../core/presence-engine/index.js';

// ── Classroom Runtime ───────────────────────────────────────────────────

export type {
  RuntimeLifecycleState,
  RuntimeRole,
  RuntimePermission,
  UserParticipant,
  RuntimeStateTree,
  RuntimeEventMap,
  RuntimeEventType,
  RuntimeEventEnvelope,
  IRuntimeService,
  IRuntimeModule,
  RuntimeHookName,
  RuntimeContextData,
  RuntimeSnapshot,
} from '../core/classroom-runtime/index.js';

// ── Lesson Engine ───────────────────────────────────────────────────────

export type {
  Lesson,
  Flow,
  Stage,
  Activity,
  ActivityDefinition,
  ActivityConfig,
  StageAnalytics,
  TeachingObject,
  StudentAction,
  LessonSnapshot,
  LessonEventType,
  TeachingContextData,
} from '../core/lesson-engine/index.js';

// ── Command & Event ─────────────────────────────────────────────────────

export type { PlatformCommand } from '../core/command-bus/index.js';
export type { PlatformEvent } from '../core/event-bus/index.js';

// ── Action Registry ─────────────────────────────────────────────────────

export type { ActionDescriptor } from '../core/registry/index.js';

// ── Activity Ecosystem (Sprint P7-01) ─────────────────────────────────
// Third-party plugins build Activity Providers with the SAME APIs as the
// official activities, then register them via `ctx.resolve(IActivityRegistryToken)`.

export type {
  ActivityCategory,
  ActivityRole,
  ActivityDevice,
  ActivityLifecycleState,
  ActivityProviderDescriptor,
  ActivityProvider,
  ActivityContext,
  ActivityClassroomContext,
  // `defineActivityProvider` / `BaseActivityProvider` 的签名组成部分 ——
  // 插件要传 descriptor + 生命周期钩子就必须能 import 到这两个类型。
  ActivityEventName,
  BaseActivityProviderOptions,
} from '../activity-ecosystem/index.js';

export {
  IActivityRegistryToken,
  ACTIVITY_EVENTS,
  BaseActivityProvider,
  defineActivityProvider,
} from '../activity-ecosystem/index.js';

// ── Classroom Lifecycle & Interaction Engine Extensibility ─────────────────
export type {
  ClassroomLifecycleStage,
  StageGuardResult,
  ClassroomStageGuard,
  IClassroomLifecycleService,
  QuickActivityDescriptor,
  IInteractionRuntimeService,
  ClassroomCountdownDescriptor,
  IClassroomCountdownService,
} from '../core/di/interfaces.js';

export {
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
  IClassroomCountdownServiceToken,
  IAssessmentGraderRegistryToken,
} from '../core/di/interfaces.js';
export type { INetworkProxyService } from '../core/di/interfaces.js';
export { INetworkProxyServiceToken } from '../core/di/interfaces.js';
