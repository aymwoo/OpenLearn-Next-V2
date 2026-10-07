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

// 以下 8 个在源码里是 **class**（运行时值）。早期被误放进上面的 `export type` 块，
// 于是消费侧写 `new PluginLifecycleManager(...)` / `PluginRuntimeComposition` 作为值时
// 报 `TS1362: cannot be used as a value because it was exported using 'export type'`。
// 由 generate-dts.mjs 的反向体检发现。
export {
  PluginRuntimeAdapter,
  PluginRuntimeComposition,
  PluginContextAdapter,
  PluginLifecycleManager,
  PluginCapabilityGateway,
  UnifiedExtensionRegistry,
  PluginDistributionManager,
} from '../core/plugin-host/index.js';

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
} from '../core/di/interfaces.js';
