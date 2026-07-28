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
  PluginState,
  Disposable,
  IPluginLogger,
  ContributionAccessor,
} from '../core/plugin-host/types.js';

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

export type {
  IConfigService,
  ConfigProperty,
  ConfigDeclaration,
} from '../core/plugin-host/config-service.js';

// ── Contribution Registry (V3.2) ────────────────────────────────────────

export type {
  ContributionSummary,
  ClassroomToolConfig,
  TeacherTabConfig,
  DashboardWidgetConfig,
  StudentViewConfig,
  StudentLessonToolConfig,
  HelpDocConfig,
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
  ILessonEngineService,
  IClassroomRuntimeService,
  IPresenceEngineService,
  ITeachingCollaborationService,
  ILearningAnalyticsService,
  IAICapabilityService,
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
  ICapabilityGovernanceServiceToken,
  IPlatformServiceRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
  ICapabilityRegistryToken,
} from '../core/di/interfaces.js';

export type {
  PointsDimensionSpec,
  IPointsDimensionRegistry,
  PointLogItem,
  IPointsLedgerService,
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

export type { CapabilityRegistry } from '../core/ai-capability/registry/capability-registry.js';

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

export type {
  GovernanceSpecification,
  CapabilityLifecycleStatus,
  GovernanceCategory,
  ApprovalTier,
  VisibilityTier,
  CapabilityHealthMetrics,
  CapabilitySearchResult,
} from '../core/capability-governance/index.js';

export type {
  ServiceDescriptor,
  ServiceScope,
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
} from '../activity-ecosystem/index.js';

export {
  IActivityRegistryToken,
  ACTIVITY_EVENTS,
  BaseActivityProvider,
  defineActivityProvider,
} from '../activity-ecosystem/index.js';

