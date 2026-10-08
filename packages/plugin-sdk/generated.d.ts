/**
 * @openlearn/plugin-sdk — **自动生成，请勿手工编辑**
 *
 * 由 packages/plugin-sdk/generate-dts.mts 从 packages/core/ 源码抽取。
 * 手写契约请改 openlearn.d.ts —— 本文件会在 build 时被覆盖。
 *
 * 覆盖符号：152 个（入口导出但手写 d.ts 未声明的 152 项及其类型引用闭包）
 */

/** @see packages/core/analytics-engine/types.ts */
interface AIAnalyticsModel {
    readonly callCount: number;
    readonly generatedContentCount: number;
    readonly teacherAdoptionRate: number;
    readonly studentUsageRate: number;
    readonly averageResponseTimeMs: number;
}

/** @see packages/core/presence-engine/types.ts */
type AIStatus = 'Idle' | 'Thinking' | 'Generating' | 'Explaining' | 'Evaluating' | 'Waiting' | 'Unavailable';

/** @see packages/core/lesson-engine/types.ts */
interface Activity {
    id: string;
    type: string; // e.g. 'video', 'image', 'python', 'quiz', 'discussion', 'ai_question', 'web_browse', 'geogebra'
    title: string;
    config: ActivityConfig;
    status: ActivityStatus;
    teachingObjects: TeachingObject[];
    metadata?: Record<string, unknown>;
}

/** @see packages/core/lesson-engine/types.ts */
interface ActivityConfig {
    autoAdvance?: boolean;
    timeoutSeconds?: number;
    allowStudentInteraction?: boolean;
    customProps?: Record<string, unknown>;
}

/** @see packages/core/lesson-engine/types.ts */
interface ActivityDefinition {
    type: string;
    name: string;
    description: string;
    category: 'media' | 'coding' | 'assessment' | 'collaboration' | 'simulation' | 'ai' | 'custom';
    icon?: string;
    defaultConfig?: ActivityConfig;
    onStart?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
    onPause?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
    onEnd?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
}

/** @see packages/core/lesson-engine/types.ts */
type ActivityStatus = 'idle' | 'active' | 'paused' | 'completed' | 'skipped';

/** @see packages/core/analytics-engine/types.ts */
interface AnalyticsInsight {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly severity: InsightSeverity;
    readonly category: 'interaction' | 'completion' | 'duration' | 'mastery' | 'pace';
    readonly recommendation?: string;
    readonly timestamp: number;
}

/** @see packages/core/analytics-engine/types.ts */
// ── Privacy & SDK Extensions ───────────────────────────────────────────────
interface AnalyticsPrivacyConfig {
    readonly anonymousAnalysis: boolean;
    readonly dataMasking: boolean;
    readonly retentionPeriodDays: number;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the classroom.barometer.metric slot (rhythm barometer metric gauge). */
interface BarometerMetricConfig {
    id: string;
    label: string;
    icon?: string;
    valueSource?: string;
    color?: string;
    tooltip?: string;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the whiteboard.canvas.widget slot (draggable interactive canvas widgets). */
interface CanvasWidgetConfig {
    id: string;
    title: string;
    component: string;
    description?: string;
    icon?: string;
    defaultWidth?: number;
    defaultHeight?: number;
    resizable?: boolean;
}

/** @see packages/core/capability/types/index.ts */
type CapabilityCategory = 'lesson' | 'whiteboard' | 'notebook' | 'plugin' | 'analytics' | 'ai' | string;

/** @see packages/core/capability/types/index.ts */
interface CapabilityContext {
    readonly lessonId?: string;
    readonly whiteboardId?: string;
    readonly studentId?: string;
    readonly teacherId?: string;
    readonly analyticsSessionId?: string;
    readonly conversationId?: string;
    readonly pluginId?: string;
    readonly actorRole: CapabilityRole;
}

/** @see packages/core/capability/types/index.ts */
interface CapabilityDescriptor {
    readonly id: string;
    readonly name: string;
    readonly category: CapabilityCategory;
    readonly provider: string;
    readonly permission: ReadonlyArray<CapabilityRole>;
    readonly inputSchema: Record<string, unknown>;
    readonly outputSchema: Record<string, unknown>;
    readonly metadata: Record<string, unknown>;
    readonly tags: ReadonlyArray<string>;
    readonly version: string;
}

/** @see packages/core/capability/types/index.ts */
interface CapabilityResult<T = unknown> {
    readonly invocationId: string;
    readonly capabilityId: string;
    readonly resultType: ResultType;
    readonly data: T;
    readonly executionTimeMs: number;
    readonly success: boolean;
    readonly error?: string;
}

/** @see packages/core/capability/types/index.ts */
/**
 * OpenLearn Capability Invocation Framework - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */
type CapabilityRole = 'Teacher' | 'Student' | 'Plugin' | 'AI' | 'Observer' | 'System';

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the classroom.attribution.award slot (custom award criteria in point awarding modal). */
interface ClassroomAttributionAwardConfig {
    id: string;
    dimensionId: string;
    name: string;
    description: string;
    icon?: string;
    defaultDeltaPoints: number;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the classroom.topbar.action slot (custom action buttons in the unified 48px topbar). */
interface ClassroomTopbarActionConfig {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    badge?: string | number;
    commandType?: string;
    payload?: Record<string, unknown>;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the teacher.cockpit.widget slot (learning radar cards). */
interface CockpitWidgetConfig {
    id: string;
    title: string;
    icon?: string;
    position?: number;
    width?: 'full' | 'half' | 'third';
}

/** @see packages/core/analytics-engine/types.ts */
interface CodeAnalyticsModel {
    readonly runCount: number;
    readonly errorRate: number;
    readonly debugCount: number;
    readonly completionRate: number;
}

/** @see packages/core/collaboration-engine/types.ts */
interface CollaborationAnalyticsData {
    participationCount: number;
    editCount: number;
    discussionCount: number;
    teacherPatrolCount: number;
    groupSwitchCount: number;
    broadcastCount: number;
}

/** @see packages/core/collaboration-engine/types.ts */
// ── Collaboration Event Map ────────────────────────────────────────────────
interface CollaborationEventMap {
    ParticipantJoined: {
        readonly participant: Participant;
        readonly timestamp: number;
    };
    ParticipantLeft: {
        readonly participantId: string;
        readonly timestamp: number;
    };
    PermissionChanged: {
        readonly role: ParticipantRole;
        readonly permissions: ReadonlyArray<CollaborationPermission>;
        readonly timestamp: number;
    };
    GroupCreated: {
        readonly group: GroupData;
        readonly timestamp: number;
    };
    GroupChanged: {
        readonly groupId: string;
        readonly action: string;
        readonly timestamp: number;
    };
    TeacherPatrol: {
        readonly teacherId: string;
        readonly targetGroupId: string;
        readonly action: 'enter' | 'leave' | 'annotate' | 'takeover';
        readonly timestamp: number;
    };
    BroadcastStarted: {
        readonly broadcastType: string;
        readonly sourceId: string;
        readonly targetGroupIds: ReadonlyArray<string>;
        readonly timestamp: number;
    };
    BroadcastFinished: {
        readonly broadcastId: string;
        readonly timestamp: number;
    };
    WorkspaceMerged: {
        readonly sourceWorkspaceId: string;
        readonly targetWorkspaceId: string;
        readonly timestamp: number;
    };
    ResultCollected: {
        readonly groupResults: ReadonlyArray<Record<string, unknown>>;
        readonly timestamp: number;
    };
}

/** @see packages/core/collaboration-engine/types.ts */
type CollaborationEventType = keyof CollaborationEventMap;

/** @see packages/core/collaboration-engine/types.ts */
type CollaborationMode = 'Teacher Presentation' | 'Teacher + Student' | 'Student Independent' | 'Small Group' | 'Whole Class' | 'Teacher Review' | 'AI Assisted';

/** @see packages/core/collaboration-engine/types.ts */
type CollaborationPermission = 'Whiteboard Edit' | 'Whiteboard View' | 'Comment' | 'Annotation' | 'Run Code' | 'Submit Quiz' | 'Create Object' | 'Delete Object' | 'Broadcast' | 'Group Switch' | 'Teacher Review' | 'AI Operation';

/** @see packages/core/presence-engine/types.ts */
type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'offline';

/** @see packages/core/analytics-engine/types.ts */
interface CustomIndicatorDefinition {
    readonly name: string;
    readonly description: string;
    readonly computeFn: (metrics: RawAnalyticsMetrics) => number;
}

/** @see packages/core/analytics-engine/types.ts */
interface CustomInsightRule {
    readonly id: string;
    readonly evaluateFn: (metrics: RawAnalyticsMetrics, indicators: HighLevelIndicators) => AnalyticsInsight | null;
}

/** @see packages/core/analytics-engine/types.ts */
interface CustomMetricDefinition {
    readonly name: string;
    readonly description: string;
    readonly computeFn: (events: ReadonlyArray<NormalizedAnalyticsEvent>) => number;
}

/** @see packages/core/presence-engine/types.ts */
// ── Plugin SDK Presence Definition ────────────────────────────────────────
interface CustomPresenceDefinition {
    readonly type: EntityType | string;
    readonly name: string;
    readonly defaultStatus: string;
    readonly rolesAllowed: ReadonlyArray<EntityRole>;
    readonly providerFn?: (entityId: string) => Promise<Partial<PresenceEntity>>;
}

/** @see packages/core/presence-engine/types.ts */
type EntityRole = 'teacher' | 'student' | 'assistant' | 'ai' | 'plugin' | 'system';

/** @see packages/core/presence-engine/types.ts */
type EntityStatus = TeacherStatus | StudentStatus | AIStatus | PluginStatus | WhiteboardStatus | StageStatus | GroupStatus | string;

/** @see packages/core/presence-engine/types.ts */
/**
 * OpenLearn Presence Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */
type EntityType = 'teacher' | 'student' | 'assistant' | 'ai' | 'plugin' | 'whiteboard' | 'teaching_object' | 'lesson' | 'stage' | 'group';

/** @see packages/core/bootstrap/types/index.ts */
/** Environment deployment mode. */
type EnvironmentType = 'development' | 'production' | 'test';

/** @see packages/core/analytics-engine/types.ts */
/**
 * OpenLearn Learning Analytics Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */
interface EventActor {
    readonly id: string;
    readonly role: string;
}

/** @see packages/core/analytics-engine/types.ts */
interface EventTarget {
    readonly id: string;
    readonly type: string;
}

/** @see packages/core/lesson-engine/types.ts */
interface Flow {
    id: string;
    name: string;
    description: string;
    version: number;
    stages: Stage[];
    isCurrent?: boolean;
    createdAt: number;
    updatedAt: number;
}

/** @see packages/core/presence-engine/types.ts */
type FocusState = 'Focused' | 'Distracted' | 'Inactive' | 'Minimized' | 'Background';

/** @see packages/core/analytics-engine/types.ts */
interface GroupAnalyticsModel {
    readonly groupId: string;
    readonly activityLevel: number;
    readonly collaborationEfficiency: number;
    readonly memberContribution: Readonly<Record<string, number>>;
    readonly completionRate: number;
}

/** @see packages/core/collaboration-engine/types.ts */
interface GroupData {
    readonly id: string;
    readonly name: string;
    readonly memberIds: ReadonlyArray<string>;
    readonly leaderId?: string;
    readonly workspaceId: string;
    readonly createdAt: number;
}

/** @see packages/core/presence-engine/types.ts */
interface GroupPresenceData {
    readonly groupId: string;
    readonly name: string;
    readonly onlineCount: number;
    readonly activeCount: number;
    readonly discussionStatus: 'idle' | 'active' | 'paused';
    readonly taskProgress: number; // 0 to 100
    readonly isCompleted: boolean;
    readonly members: ReadonlyArray<string>;
}

/** @see packages/core/presence-engine/types.ts */
type GroupStatus = 'Active' | 'Idle' | 'Discussing' | 'Finished';

/** @see packages/core/collaboration-engine/types.ts */
interface GroupWorkspaceData {
    readonly workspaceId: string;
    readonly groupId: string;
    readonly canvasState: Record<string, unknown>;
    readonly teachingObjects: ReadonlyArray<Record<string, unknown>>;
    readonly timelinePosition: number;
    readonly pluginState: Record<string, unknown>;
    readonly aiContext: Record<string, unknown>;
}

/** @see packages/core/analytics-engine/types.ts */
interface HighLevelIndicators {
    readonly participationIndex: number; // 0 - 100
    readonly focusIndex: number; // 0 - 100
    readonly paceIndex: number; // 0 - 100
    readonly collaborationIndex: number; // 0 - 100
    readonly thinkingActivityIndex: number; // 0 - 100
    readonly knowledgeMasteryIndex: number; // 0 - 100
    readonly teacherPatrolIndex: number; // 0 - 100
    readonly aiAssistanceIndex: number; // 0 - 100
    readonly timestamp: number;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
/**
 * OpenLearn Platform Service Contracts
 * Standard interface contracts preventing direct business class coupling.
 */
interface IAIServiceContract {
    generateText(prompt: string, options?: {
        systemInstruction?: string;
        temperature?: number;
    }): Promise<string>;
}

/** @see packages/core/ai-capability/types/index.ts */
interface IAnalyticsCapability extends IAICapability {
    generateInsight(metrics: Record<string, unknown>): Promise<ReadonlyArray<Record<string, unknown>>>;
    generateSuggestion(indicators: Record<string, unknown>): Promise<string>;
    generateReflection(lessonAnalytics: Record<string, unknown>): Promise<string>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface IAnalyticsServiceContract {
    getMetrics(): Promise<Record<string, unknown>>;
    publishEvent(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

/** @see packages/core/capability/types/index.ts */
// ── Framework Capability Handler Interface ────────────────────────────────
interface ICapabilityProviderHandler {
    readonly descriptor: CapabilityDescriptor;
    execute(request: InvocationRequest): Promise<unknown>;
}

/** @see packages/core/ai-capability/types/index.ts */
// ── Standard Capability Interfaces ────────────────────────────────────────
interface IChatCapability extends IAICapability {
    chat(message: string, sessionId?: string): Promise<{
        reply: string;
        sessionId: string;
    }>;
}

/** @see packages/core/ai-capability/types/index.ts */
interface ICompletionCapability extends IAICapability {
    complete(prompt: string, options?: {
        systemInstruction?: string;
        temperature?: number;
    }): Promise<string>;
}

/** @see packages/core/bootstrap/integration/integration-types.ts */
interface IIntegrationAdapter {
    readonly id: string;
    readonly name: string;
    readonly version: Version;
    initialize(context: IntegrationContext): Promise<void> | void;
    activate(): Promise<void> | void;
    deactivate(): Promise<void> | void;
    dispose(): Promise<void> | void;
    health(): Promise<IntegrationHealthStatus> | IntegrationHealthStatus;
    metadata(): IntegrationDescriptor;
}

/** @see packages/core/ai-capability/types/index.ts */
interface ILessonCapability extends IAICapability {
    generateLessonPlan(subject: string, grade: string, topic: string): Promise<Record<string, unknown>>;
    generateQuiz(stageTitle: string, knowledgePoints: ReadonlyArray<string>, count?: number): Promise<ReadonlyArray<Record<string, unknown>>>;
    generateSummary(activityTitle: string, activityType: string): Promise<string>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface ILessonServiceContract {
    getLesson(lessonId: string): Promise<Record<string, unknown>>;
    createLesson(title: string, subject: string): Promise<Record<string, unknown>>;
}

/** @see packages/core/bootstrap/types/index.ts */
/** Abstract Logger interface contract. */
interface IPlatformLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

/** @see packages/core/ai-capability/types/index.ts */
interface IPluginCapability extends IAICapability {
    invokeAI(pluginId: string, prompt: string, options?: Record<string, unknown>): Promise<string>;
}

/** @see packages/core/bootstrap/integration/domain-adapters.ts */
/**
 * Lightweight domain adapter interface for PluginHost.
 * Canonically implemented by IPluginRuntime (@openlearn/core/plugin-host).
 */
interface IPluginHostAdapter extends IIntegrationAdapter {
    getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/** @see packages/core/plugin-host/plugin-runtime-adapter.ts */
interface IPluginRuntime extends IPluginHostAdapter {
    readonly pluginHost: PluginHost;
    readonly isInitialized: boolean;
    initialize(context?: IntegrationContext): Promise<void>;
    getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
    listPlugins(): ReadonlyArray<unknown>;
    getPluginState(pluginId: string): string | undefined;
    activatePlugin(pluginId: string): Promise<void>;
    deactivatePlugin(pluginId: string): Promise<void>;
    reloadPlugin(pluginId: string, newCode?: string): Promise<void>;
    dispose(): Promise<void>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface IPluginServiceContract {
    getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/** @see packages/core/classroom-runtime/types.ts */
// ── Module Interface ───────────────────────────────────────────────────────
interface IRuntimeModule {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    initialize(context: RuntimeContextData): Promise<void>;
    start(context: RuntimeContextData): Promise<void>;
    stop(context: RuntimeContextData): Promise<void>;
    dispose(): Promise<void>;
}

/** @see packages/core/classroom-runtime/types.ts */
// ── Service Interfaces ─────────────────────────────────────────────────────
interface IRuntimeService {
    readonly serviceId: string;
    readonly name: string;
    initialize(context: RuntimeContextData): Promise<void>;
    dispose(): Promise<void>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface IRuntimeServiceContract {
    getSessionState(): Promise<Record<string, unknown>>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface IStorageServiceContract {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
}

/** @see packages/core/ai-capability/types/index.ts */
interface IToolCapability extends IAICapability {
    executeToolCall(toolName: string, args: Record<string, unknown>): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
    }>;
}

/** @see packages/core/plugin-host/plugin-context-adapter.ts */
interface IUnifiedPluginContext {
    readonly pluginId: string;
    readonly manifest: Manifest;
    readonly environment: 'development' | 'production' | 'test';
    // Core Scoped Services
    readonly services: PluginContext['services'];
    readonly log: IPluginLogger;
    readonly db: PluginDatabaseAPI;
    readonly contributions: ContributionAccessor;
    readonly config: IConfigService;
    readonly http: PluginContext['http'];
    // Methods
    resolve<T>(token: Token<T>): Promise<T>;
    provide<T>(token: Token<T>, instance: T): Promise<void>;
    require(moduleName: string): unknown;
    getRawContext(): PluginContext;
}

/** @see packages/core/ai-capability/types/index.ts */
interface IWhiteboardCapability extends IAICapability {
    generateDiagram(prompt: string): Promise<Record<string, unknown>>;
    summarizeSelection(selectedElements: ReadonlyArray<Record<string, unknown>>): Promise<string>;
    explainObject(objectData: Record<string, unknown>): Promise<string>;
    beautifyLayout(elements: ReadonlyArray<Record<string, unknown>>): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/** @see packages/core/service-registry/contracts/service-contracts.ts */
interface IWhiteboardServiceContract {
    getElements(whiteboardId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
    createElement(whiteboardId: string, elementData: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** @see packages/core/analytics-engine/types.ts */
// ── Insight Engine Models ──────────────────────────────────────────────────
type InsightSeverity = 'info' | 'warning' | 'critical';

/** @see packages/core/bootstrap/integration/integration-types.ts */
interface IntegrationContext {
    readonly platformId: string;
    readonly environment: string;
    readonly logger?: IPlatformLogger;
    readonly config?: Partial<PlatformBootstrapConfig>;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/** @see packages/core/presence-engine/types.ts */
type InteractionSignal = 'Raise Hand' | 'Question' | 'Agree' | 'Disagree' | 'Need Help' | 'Finished' | 'None';

/** @see packages/core/capability/types/index.ts */
interface InvocationRequest {
    readonly id: string;
    readonly capabilityId: string;
    readonly payload: Record<string, unknown>;
    readonly context: CapabilityContext;
    readonly timeoutMs?: number;
}

/** @see packages/core/lesson-engine/types.ts */
interface Lesson {
    id: string;
    title: string;
    subject: string;
    grade: string;
    teacher: UserRef;
    durationMinutes: number;
    status: LessonStatus;
    flows: Flow[];
    activeFlowId?: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, unknown>;
}

/** @see packages/core/analytics-engine/types.ts */
interface LessonAnalyticsModel {
    readonly lessonId: string;
    readonly stageDurationMap: Readonly<Record<string, number>>;
    readonly paceRatio: number;
    readonly peakInteractionTimestamp: number;
    readonly knowledgeCoverageRate: number;
}

/** @see packages/core/lesson-engine/types.ts */
type LessonEventType = 'LessonStarted' | 'LessonPaused' | 'LessonEnded' | 'StageEntered' | 'StageFinished' | 'ActivityStarted' | 'ActivityFinished' | 'ActivitySkipped' | 'TeacherJump' | 'StudentSynced';

/** @see packages/core/lesson-engine/types.ts */
interface LessonSnapshot {
    id: string;
    lessonId: string;
    timestamp: number;
    lessonState: Lesson;
    activeFlowId: string;
    activeStageId: string;
    activeActivityId?: string;
    elapsedSeconds: number;
    whiteboardData?: Record<string, unknown>;
}

/** @see packages/core/lesson-engine/types.ts */
/**
 * OpenLearn Lesson Flow Engine - Domain Types
 */
type LessonStatus = 'idle' | 'draft' | 'ready' | 'active' | 'paused' | 'completed';

/** @see packages/core/esm-loader/manifest-schema.ts */
/**
 * ManifestV3 类型 — 由 manifestSchemaV3 推导的类型，保留供引用。
 */
type ManifestV3 = z.infer<typeof manifestSchemaV3>;

/** @see packages/core/analytics-engine/types.ts */
interface NormalizedAnalyticsEvent<T = Record<string, unknown>> {
    readonly eventId: string;
    readonly eventType: string;
    readonly timestamp: number;
    readonly actor: EventActor;
    readonly target?: EventTarget;
    readonly lessonId?: string;
    readonly stageId?: string;
    readonly activityId?: string;
    readonly metadata: T;
}

/** @see packages/core/collaboration-engine/types.ts */
interface ObjectLock {
    readonly objectId: string;
    readonly lockedBy: string;
    readonly lockedAt: number;
    readonly expiresAt: number;
}

/** @see packages/core/version.ts */
declare const PLATFORM_VERSION: string;

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the palette.items slot (custom whiteboard tools & widgets). */
interface PaletteItemContributionConfig {
    id: string;
    type: string;
    labelZh: string;
    labelEn: string;
    icon?: string;
    category?: 'media' | 'interactive' | 'container' | 'custom';
    defaultData?: Record<string, unknown>;
}

/** @see packages/core/collaboration-engine/types.ts */
interface Participant {
    readonly id: string;
    readonly name: string;
    readonly role: ParticipantRole;
    readonly isOnline: boolean;
    readonly currentGroupId?: string;
    readonly lastActive: number;
    readonly lastHeartbeat: number;
    readonly metadata: Record<string, unknown>;
}

/** @see packages/core/collaboration-engine/types.ts */
/**
 * OpenLearn Teaching Collaboration Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */
type ParticipantRole = 'Teacher' | 'Teaching Assistant' | 'Student' | 'Observer' | 'AI Tutor' | 'AI Assistant' | 'Plugin';

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the peer_review.badge slot (custom peer nomination micro-badges). */
interface PeerReviewBadgeConfig {
    id: string;
    title: string;
    emoji?: string;
    description?: string;
    color?: string;
    points?: number;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the peer_review.rubric.dimension slot (custom rubric assessment dimensions). */
interface PeerReviewRubricConfig {
    id: string;
    name: string;
    description?: string;
    maxScore?: number;
    weight?: number;
    icon?: string;
    targetMetric?: string;
}

/** @see packages/core/bootstrap/types/index.ts */
/** Default bootstrap configuration values. */
interface PlatformBootstrapConfig {
    readonly environment: EnvironmentType;
    readonly mode: PlatformMode;
    readonly port: number;
    readonly debug: boolean;
    readonly pluginsDir: string;
    readonly dbPath: string;
    readonly metadata?: Record<string, unknown>;
}

/** @see packages/core/bootstrap/types/index.ts */
/** Platform execution mode. */
type PlatformMode = 'standalone' | 'cluster' | 'embedded';

/** @see packages/core/plugin-host/plugin-capability-gateway.ts */
declare class PluginCapabilityGateway implements IPluginCapabilityGateway {
  readonly id: any;
  readonly name: any;
  readonly version: any;
  constructor(capabilityRegistry: CapabilityRegistry);
  listCapabilities(): ReadonlyArray<CapabilityMetadata>;
  hasCapability(capabilityId: string): boolean;
  resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T;
  executeCapability<T = unknown>(capabilityId: string, methodName: string, ...args: unknown[]): Promise<T>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
  readonly capabilityRegistry: CapabilityRegistry;
}

/** @see packages/core/plugin-host/plugin-context-adapter.ts */
declare class PluginContextAdapter implements IUnifiedPluginContext {
  readonly environment: 'development' | 'production' | 'test';
  constructor(_context: PluginContext, env?: 'development' | 'production' | 'test');
  get pluginId(): string;
  get manifest(): Manifest;
  get services(): PluginContext['services'];
  get log(): IPluginLogger;
  get http(): PluginContext['http'];
  get db(): PluginDatabaseAPI;
  get contributions(): ContributionAccessor;
  get config(): IConfigService;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  require(moduleName: string): unknown;
  getRawContext(): PluginContext;
  readonly _context: PluginContext;
}

/** @see packages/core/plugin-host/plugin-distribution-manager.ts */
declare class PluginDistributionManager implements IPluginDistributionManager {
  readonly id: any;
  readonly name: any;
  readonly version: any;
  constructor(pluginHost: PluginHost);
  registerRepository(repo: IPluginRepositoryAdapter): void;
  listRepositories(): ReadonlyArray<IPluginRepositoryAdapter>;
  listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  installFromZip(zipBuffer: Buffer, executionMode?: PluginExecutionMode): Promise<{
    pluginId: string;
    manifest: Manifest;
}>;
  installFromRepository(repoId: string, pluginId: string): Promise<{
    pluginId: string;
    manifest: Manifest;
}>;
  updatePlugin(pluginId: string, zipBuffer?: Buffer): Promise<void>;
  updateFromZip(zipBuffer: Buffer, options: PluginUpdateOptions): Promise<PluginUpdateResult>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
  readonly pluginHost: PluginHost;
}

/** @see packages/core/plugin-host/types.ts */
/**
 * 插件的执行模式（L-1 P1 阶段 3）。
 *
 * | 值 | 隔离强度 | 说明 |
 * |---|---|---|
 * | `'inline'` | 无 | 与宿主同进程同线程运行。默认。 |
 * | `'worker'` | 崩溃隔离 | `worker_threads.Worker` —— 独立 V8 isolate，但**同进程**，共享内存与 `process.env`。 |
 * | `'process'` | **进程隔离** | `child_process` 子进程 + 最小 env 白名单 —— 爆炸半径为一个进程。见 `child-spawn.ts`。 |
 *
 * ## 为什么用具名类型而不是各处内联字面量联合
 *
 * 加第三个取值时，`'inline' | 'worker'` 这个字面量在 `plugin-host/index.ts`
 * 里内联出现 5 处、`plugin-distribution-manager.ts` 3 处、`server/routes/plugins.ts`
 * 3 处（API 层的入参收窄）。逐个改漏一处，那个入口就会**悄悄退回只认两种模式**：
 * `'process'` 在收窄处被判为 `undefined` → 落到默认 `inline` → 插件**根本没进隔离路径**，
 * 而类型系统不会报任何错（因为收窄本身是合法的）。
 *
 * 这个失效形态最坏的地方在于**它不报错**：管理员选了「进程隔离」，插件却跑在
 * inline 里，界面上看着生效了。故收敛到单一来源，并配
 * `execution-mode.test.ts` 守住「三处 API 入口都认得 process」。
 */
type PluginExecutionMode = 'inline' | 'worker' | 'process';

/** @see packages/core/plugin-host/plugin-lifecycle-manager.ts */
declare class PluginLifecycleManager implements IPluginLifecycleManager {
  readonly id: any;
  readonly name: any;
  readonly version: any;
  constructor(pluginHost: PluginHost);
  getPluginState(pluginId: string): PluginState | undefined;
  listPlugins(): ReadonlyArray<PluginInfo>;
  activatePlugin(pluginId: string): Promise<void>;
  deactivatePlugin(pluginId: string): Promise<void>;
  reloadPlugin(pluginId: string, newCode?: string): Promise<void>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
  readonly pluginHost: PluginHost;
}

/** @see packages/core/plugin-host/plugin-runtime-adapter.ts */
declare class PluginRuntimeAdapter implements IPluginRuntime {
  readonly id: any;
  readonly name: any;
  readonly version: any;
  constructor(pluginHost: PluginHost);
  get isInitialized(): boolean;
  initialize(context?: IntegrationContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
  getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
  listPlugins(): ReadonlyArray<unknown>;
  getPluginState(pluginId: string): string | undefined;
  activatePlugin(pluginId: string): Promise<void>;
  deactivatePlugin(pluginId: string): Promise<void>;
  reloadPlugin(pluginId: string, newCode?: string): Promise<void>;
  readonly pluginHost: PluginHost;
}

/** @see packages/core/presence-engine/types.ts */
type PluginStatus = 'Loading' | 'Running' | 'Paused' | 'Error' | 'Finished';

/** @see packages/core/analytics-engine/types.ts */
// ── Prediction Interface ───────────────────────────────────────────────────
interface PredictionResult {
    readonly targetStudentId?: string;
    readonly predictedCompletionRate: number;
    readonly riskLevel: 'low' | 'medium' | 'high';
    readonly predictedPaceRatio: number;
    readonly timestamp: number;
}

/** @see packages/core/presence-engine/types.ts */
interface PresenceDashboardMetrics {
    readonly onlineCount: number;
    readonly activeCount: number;
    readonly focusCount: number;
    readonly handRaiseCount: number;
    readonly helpRequestCount: number;
    readonly taskCompletionRate: number;
    readonly aiWorkStatus: AIStatus;
    readonly activePluginCount: number;
    readonly timestamp: number;
}

/** @see packages/core/presence-engine/types.ts */
interface PresenceDiff {
    readonly entityId: string;
    readonly changes: Partial<PresenceEntity>;
    readonly timestamp: number;
}

/** @see packages/core/presence-engine/types.ts */
interface PresenceEntity<TStatus extends string = EntityStatus> {
    readonly id: string;
    readonly type: EntityType;
    readonly status: TStatus;
    readonly activity: string;
    readonly focus: FocusState;
    readonly role: EntityRole;
    readonly permission: ReadonlyArray<string>;
    readonly lastActive: number;
    readonly lastHeartbeat: number;
    readonly connectionState: ConnectionState;
    readonly interactionSignal?: InteractionSignal;
    readonly device?: {
        readonly type: string;
        readonly os?: string;
        readonly browser?: string;
    };
    readonly network?: {
        readonly latencyMs?: number;
        readonly quality?: 'good' | 'fair' | 'poor';
    };
    readonly location?: {
        readonly classroomId?: string;
        readonly seatNumber?: string;
    };
    readonly metadata: Record<string, unknown>;
}

/** @see packages/core/presence-engine/types.ts */
// ── Presence Event Map ─────────────────────────────────────────────────────
interface PresenceEventMap {
    PresenceChanged: {
        readonly entityId: string;
        readonly previous: PresenceEntity;
        readonly current: PresenceEntity;
    };
    StudentOnline: {
        readonly studentId: string;
        readonly timestamp: number;
    };
    StudentOffline: {
        readonly studentId: string;
        readonly timestamp: number;
    };
    TeacherChanged: {
        readonly teacherId: string;
        readonly newStatus: TeacherStatus;
        readonly timestamp: number;
    };
    PluginRunning: {
        readonly pluginId: string;
        readonly status: PluginStatus;
        readonly timestamp: number;
    };
    FocusChanged: {
        readonly entityId: string;
        readonly focus: FocusState;
        readonly timestamp: number;
    };
    HelpRequested: {
        readonly studentId: string;
        readonly message?: string;
        readonly timestamp: number;
    };
    HandRaised: {
        readonly studentId: string;
        readonly signal: InteractionSignal;
        readonly timestamp: number;
    };
    HeartbeatTimeout: {
        readonly entityId: string;
        readonly lastHeartbeat: number;
        readonly timestamp: number;
    };
}

/** @see packages/core/presence-engine/types.ts */
type PresenceEventType = keyof PresenceEventMap;

/** @see packages/core/presence-engine/types.ts */
interface PresencePrivacyConfig {
    readonly permissionRequired: boolean;
    readonly anonymousMode: boolean;
    readonly disableCollection: boolean;
    readonly retentionDays: number;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the classroom.quick_activity slot (interactive quick tools). */
interface QuickActivityConfig {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    category?: string;
    commandType?: string;
    payload?: Record<string, unknown>;
}

/** @see packages/core/analytics-engine/types.ts */
interface QuizAnalyticsModel {
    readonly accuracyRate: number;
    readonly knowledgeMasteryMap: Readonly<Record<string, number>>;
    readonly averageTimeSeconds: number;
    readonly optionDistribution: Readonly<Record<string, number>>;
}

/** @see packages/core/analytics-engine/types.ts */
interface RawAnalyticsMetrics {
    readonly onlineCount: number;
    readonly activeCount: number;
    readonly participationRate: number; // 0 - 100%
    readonly totalInteractions: number;
    readonly quizAnswerRate: number; // 0 - 100%
    readonly quizAccuracyRate: number; // 0 - 100%
    readonly averageTimeSeconds: number;
    readonly completionRate: number; // 0 - 100%
    readonly codeExecutionCount: number;
    readonly whiteboardEditCount: number;
    readonly aiInvocationCount: number;
    readonly timestamp: number;
}

/** @see packages/core/classroom-runtime/types.ts */
type ResourceType = 'image' | 'video' | 'audio' | 'pdf' | 'plugin' | 'ai';

/** @see packages/core/capability/types/index.ts */
type ResultType = 'teaching_object' | 'whiteboard_object' | 'markdown' | 'quiz' | 'code' | 'image' | 'analytics_insight' | 'plugin_data' | 'generic';

/** @see packages/core/classroom-runtime/types.ts */
// ── Context Interface ──────────────────────────────────────────────────────
interface RuntimeContextData {
    readonly runtimeId: string;
    readonly sessionId: string;
    readonly courseId?: string;
    readonly lessonId?: string;
    readonly teacher?: UserParticipant;
    readonly currentUser?: UserParticipant;
    readonly role: RuntimeRole;
    readonly permissions: ReadonlyArray<RuntimePermission>;
    readonly lifecycleState: RuntimeLifecycleState;
}

/** @see packages/core/classroom-runtime/types.ts */
interface RuntimeEventEnvelope<K extends RuntimeEventType = RuntimeEventType> {
    readonly id: string;
    readonly type: K;
    readonly payload: RuntimeEventMap[K];
    readonly source: string;
    readonly timestamp: number;
}

/** @see packages/core/classroom-runtime/types.ts */
// ── Event Bus Channels & Payloads ──────────────────────────────────────────
interface RuntimeEventMap {
    SessionCreated: {
        readonly sessionId: string;
        readonly teacherId: string;
        readonly timestamp: number;
    };
    StudentJoined: {
        readonly student: UserParticipant;
        readonly timestamp: number;
    };
    StudentLeft: {
        readonly studentId: string;
        readonly timestamp: number;
    };
    LessonStarted: {
        readonly lessonId: string;
        readonly timestamp: number;
    };
    StageChanged: {
        readonly fromStageId?: string;
        readonly toStageId: string;
        readonly index: number;
        readonly timestamp: number;
    };
    ObjectUpdated: {
        readonly objectId: string;
        readonly action: 'create' | 'update' | 'delete';
        readonly timestamp: number;
    };
    QuizSubmitted: {
        readonly studentId: string;
        readonly score: number;
        readonly timestamp: number;
    };
    PluginLoaded: {
        readonly pluginId: string;
        readonly name: string;
        readonly timestamp: number;
    };
    AIFinished: {
        readonly prompt: string;
        readonly response: string;
        readonly timestamp: number;
    };
    NetworkDisconnected: {
        readonly actorId: string;
        readonly timestamp: number;
    };
    RuntimePaused: {
        readonly elapsedTime: number;
        readonly timestamp: number;
    };
    LifecycleChanged: {
        readonly from: RuntimeLifecycleState;
        readonly to: RuntimeLifecycleState;
        readonly timestamp: number;
    };
}

/** @see packages/core/classroom-runtime/types.ts */
type RuntimeEventType = keyof RuntimeEventMap;

/** @see packages/core/classroom-runtime/types.ts */
// ── Runtime Hooks ──────────────────────────────────────────────────────────
type RuntimeHookName = 'beforeLessonStart' | 'afterLessonStart' | 'beforeStageChange' | 'afterStageChange' | 'beforePluginLoad' | 'afterPluginLoad' | 'beforeStudentJoin' | 'afterStudentJoin';

/** @see packages/core/classroom-runtime/types.ts */
/**
 * OpenLearn Classroom Runtime - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */
type RuntimeLifecycleState = 'Create' | 'Initialize' | 'Prepare' | 'Running' | 'Pause' | 'Resume' | 'Stop' | 'Dispose';

/** @see packages/core/classroom-runtime/types.ts */
type RuntimePermission = 'lesson:control' | 'stage:navigate' | 'whiteboard:draw' | 'quiz:submit' | 'plugin:execute' | 'ai:invoke' | 'session:manage';

/** @see packages/core/classroom-runtime/types.ts */
interface RuntimeResource {
    readonly id: string;
    readonly type: ResourceType;
    readonly url: string;
    readonly sizeBytes?: number;
    readonly status: 'pending' | 'loaded' | 'error';
    readonly cachedAt: number;
}

/** @see packages/core/classroom-runtime/types.ts */
type RuntimeRole = 'Teacher' | 'Assistant' | 'Student' | 'Observer' | 'Plugin' | 'AI';

/** @see packages/core/classroom-runtime/types.ts */
// ── Snapshot & Recovery ────────────────────────────────────────────────────
interface RuntimeSnapshot {
    readonly snapshotId: string;
    readonly timestamp: number;
    readonly stateTree: RuntimeStateTree;
    readonly activeServices: ReadonlyArray<string>;
    readonly loadedModules: ReadonlyArray<string>;
    readonly resources: ReadonlyArray<RuntimeResource>;
}

/** @see packages/core/classroom-runtime/types.ts */
// ── State Tree Definition ──────────────────────────────────────────────────
interface RuntimeStateTree {
    readonly runtime: {
        readonly id: string;
        readonly lifecycle: RuntimeLifecycleState;
        readonly startTime: number;
        readonly elapsedTime: number;
    };
    readonly lesson: {
        readonly activeLessonId?: string;
        readonly title?: string;
        readonly subject?: string;
        readonly status?: string;
    };
    readonly stage: {
        readonly activeStageId?: string;
        readonly index: number;
        readonly title?: string;
        readonly completionStatus?: string;
    };
    readonly activity: {
        readonly activeActivityId?: string;
        readonly type?: string;
        readonly status?: string;
    };
    readonly whiteboard: {
        readonly activeStageViewId?: string;
        readonly objectCount: number;
        readonly isLocked: boolean;
    };
    readonly teachingObjects: ReadonlyArray<{
        readonly id: string;
        readonly type: string;
        readonly title: string;
    }>;
    readonly students: ReadonlyArray<UserParticipant>;
    readonly plugin: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly status: string;
    }>;
    readonly ai: {
        readonly isGenerating: boolean;
        readonly lastPrompt?: string;
        readonly lastResponse?: string;
    };
    readonly analytics: {
        readonly totalInteractions: number;
        readonly activeStudentCount: number;
        readonly averageScore: number;
    };
}

/** @see packages/core/service-registry/types/index.ts */
interface ServiceDescriptor<T = unknown> {
    readonly id: string;
    readonly namespace?: string;
    readonly serviceType?: string;
    readonly version?: string;
    readonly implementation?: new (...args: any[]) => T;
    readonly factory?: (scope?: unknown) => T;
    readonly instance?: T;
    readonly lifetime?: ServiceLifetime;
    readonly scope?: ServiceScopeType;
    readonly singleton?: boolean;
    readonly dependencies?: ReadonlyArray<string>;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly description?: string;
}

/** @see packages/core/service-registry/types/index.ts */
interface ServiceInspectionInfo {
    readonly id: string;
    readonly namespace: string;
    readonly serviceType: string;
    readonly version: string;
    readonly scope: ServiceScopeType;
    readonly lifecycleState: ServiceLifecycleState;
    readonly dependencies: ReadonlyArray<string>;
}

/** @see packages/core/service-registry/types/index.ts */
type ServiceLifecycleState = 'Registered' | 'Initialized' | 'Started' | 'Ready' | 'Stopped' | 'Disposed';

/** @see packages/core/service-registry/types/index.ts */
/**
 * OpenLearn Platform Service Registry - Strict TypeScript Definitions (PI-007)
 */
type ServiceLifetime = 'Singleton' | 'Scoped' | 'Transient';

/** @see packages/core/service-registry/service-scope.ts */
declare class ServiceScope {
  readonly scopeId: string;
  constructor(scopeId?: string);
  get<T>(serviceId: string): T | undefined;
  set<T>(serviceId: string, instance: T): void;
  has(serviceId: string): boolean;
  dispose(): void;
}

/** @see packages/core/service-registry/types/index.ts */
type ServiceScopeType = 'Singleton' | 'Session' | 'Lesson' | 'Plugin' | 'Transient' | 'Scoped';

/** @see packages/core/collaboration-engine/types.ts */
interface SharedObjectData {
    readonly id: string;
    readonly sourceGroupId?: string;
    readonly targetGroupIds: ReadonlyArray<string>;
    readonly mode: 'sync' | 'copy' | 'mirror' | 'reference';
    readonly content: Record<string, unknown>;
    readonly version: number;
}

/** @see packages/core/lesson-engine/types.ts */
interface Stage {
    id: string;
    title: string;
    estimatedDurationSeconds: number;
    teachingGoals: string[];
    knowledgePoints: string[];
    completionStatus: StageCompletionStatus;
    assignee: 'teacher' | 'student' | 'group' | string;
    activities: Activity[];
    locked?: boolean;
    metadata?: Record<string, unknown>;
    analytics?: StageAnalytics;
}

/** @see packages/core/lesson-engine/types.ts */
interface StageAnalytics {
    completionRate: number; // 0 to 100
    participantCount: number;
    elapsedTimeSeconds: number;
    interactionCount: number;
    quizScores: Array<{
        studentId: string;
        score: number;
        maxScore: number;
    }>;
    discussionHeat: number; // 0 to 100 rating
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the stage.display.card slot (large projector display cards). */
interface StageCardConfig {
    id: string;
    title: string;
    icon?: string;
    theme?: 'dark' | 'light' | 'accent';
}

/** @see packages/core/lesson-engine/types.ts */
type StageCompletionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/** @see packages/core/presence-engine/types.ts */
type StageStatus = 'Waiting' | 'Running' | 'Completed' | 'Paused' | 'Skipped';

/** @see packages/core/lesson-engine/types.ts */
interface StudentAction {
    id: string;
    studentId: string;
    studentName: string;
    stageId: string;
    activityId?: string;
    actionType: 'answer' | 'quiz_submit' | 'discussion_post' | 'hand_raise' | 'interaction';
    payload: Record<string, unknown>;
    timestamp: number;
}

/** @see packages/core/analytics-engine/types.ts */
interface StudentAnalyticsModel {
    readonly studentId: string;
    readonly learningTrajectory: ReadonlyArray<StudentTrajectoryPoint>;
    readonly totalQuizSubmits: number;
    readonly correctQuizSubmits: number;
    readonly totalCodeExecutions: number;
    readonly totalWhiteboardEdits: number;
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the student.profile.dimension slot (custom competency radar dimensions). */
interface StudentCompetencyDimensionConfig {
    id: string;
    label: string;
    key: string;
    maxScore?: number;
    defaultWeight?: number;
    icon?: string;
    category?: 'cognitive' | 'practice' | 'collaboration' | 'focus' | 'custom';
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the student.profile.card slot (custom widgets inside student growth profile). */
interface StudentProfileWidgetConfig {
    id: string;
    title: string;
    description?: string;
    icon?: string;
    placement?: 'sidebar' | 'content' | 'footer';
    order?: number;
}

/** @see packages/core/presence-engine/types.ts */
type StudentStatus = 'Online' | 'Offline' | 'Reconnecting' | 'Idle' | 'Listening' | 'Writing' | 'Coding' | 'Answering' | 'Discussing' | 'Watching' | 'Presenting' | 'Finished' | 'Need Help' | 'Away';

/** @see packages/core/analytics-engine/types.ts */
// ── Domain Analytics Models ────────────────────────────────────────────────
interface StudentTrajectoryPoint {
    readonly timestamp: number;
    readonly stageId: string;
    readonly actionType: string;
    readonly score?: number;
}

/** @see packages/core/collaboration-engine/types.ts */
interface SyncMessage<T = unknown> {
    readonly id: string;
    readonly type: SyncType;
    readonly payload: T;
    readonly senderId: string;
    readonly timestamp: number;
}

/** @see packages/core/collaboration-engine/types.ts */
type SyncType = 'object_sync' | 'selection_sync' | 'viewport_sync' | 'pointer_sync' | 'stage_sync' | 'lesson_sync';

/** @see packages/core/presence-engine/types.ts */
type TeacherStatus = 'Preparing' | 'Teaching' | 'Explaining' | 'Writing' | 'Observing' | 'Reviewing' | 'Answering' | 'Discussing' | 'Waiting' | 'Offline';

/** @see packages/core/lesson-engine/types.ts */
interface TeachingContextData {
    currentLesson?: Lesson;
    currentFlow?: Flow;
    currentStage?: Stage;
    currentActivity?: Activity;
    teacher?: UserRef;
    currentUser?: UserRef;
    role: UserRole;
    isPresentationMode: boolean;
}

/** @see packages/core/lesson-engine/types.ts */
interface TeachingObject {
    id: string;
    type: string; // e.g., 'whiteboard_element', 'document', 'geogebra_model', 'code_snippet', 'quiz_card'
    title: string;
    content: unknown;
    metadata?: Record<string, unknown>;
    sharedAcrossStages?: string[]; // stage IDs where this object is shared
}

/** @see packages/core/plugin-host/contribution-registry.ts */
/** A contribution to the timeline.segments slot (custom lesson segment types). */
interface TimelineSegmentConfig {
    id: string;
    labelZh: string;
    labelEn: string;
    icon?: string;
    color?: string;
    defaultDurationMin?: number;
}

/** @see packages/core/plugin-host/unified-extension-registry.ts */
declare class UnifiedExtensionRegistry implements IUnifiedExtensionRegistry {
  readonly id: any;
  readonly name: any;
  readonly version: any;
  registerExtension(category: string, id: string, impl: unknown, meta?: Partial<ExtensionItemMetadata>): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
  unregisterProvider(providerId: string): number;
  syncContributionRegistry(contributionRegistry: {
    listAll(): Array<{
        slot: string;
        pluginId: string;
        configs: Array<{
            id: string;
            name?: string;
            label?: string;
            description?: string;
        }>;
    }>;
}): void;
  syncActivityRegistry(activityRegistry: {
    listProviders(): ReadonlyArray<{
        descriptor: {
            id: string;
            name: string;
            provider: string;
            description?: string;
        };
    }>;
}): void;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

/** @see packages/core/classroom-runtime/types.ts */
interface UserParticipant {
    readonly id: string;
    readonly name: string;
    readonly role: RuntimeRole;
    readonly avatar?: string;
    readonly isOnline: boolean;
    readonly joinedAt: number;
}

/** @see packages/core/lesson-engine/types.ts */
interface UserRef {
    id: string;
    name: string;
    role: UserRole;
    avatar?: string;
}

/** @see packages/core/lesson-engine/types.ts */
type UserRole = 'teacher' | 'student' | 'administrator' | 'assistant';

/** @see packages/core/bootstrap/types/index.ts */
/** Semantic version string (e.g. '0.2.5'). */
type Version = string;

/** @see packages/core/analytics-engine/types.ts */
interface WhiteboardAnalyticsModel {
    readonly objectCount: number;
    readonly editHeatmaps: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
        readonly intensity: number;
    }>;
    readonly focusRegions: ReadonlyArray<string>;
    readonly presentationDurationSeconds: number;
    readonly annotationFrequency: number;
}

/** @see packages/core/presence-engine/types.ts */
type WhiteboardStatus = 'Editing' | 'Presenting' | 'Locked' | 'ReadOnly' | 'Collaborating';

declare function buildRedactOptions(env: NodeJS.ProcessEnv): {
    paths: string[];
    censor: string;
} | false;

/** @see packages/core/db/index.ts */
declare const db: any; // 初始化器非字面量，未收敛

declare function hasCapability(caps: readonly string[], name: string): boolean;

declare function isRedactionEnabled(env: NodeJS.ProcessEnv): boolean;

/** @see packages/core/observability/logger.ts */
declare const logger: any; // 初始化器非字面量，未收敛

/** @see packages/core/esm-loader/manifest-schema.ts */
declare const manifestSchemaV3: z.ZodObject<{ id: z.ZodString; name: z.ZodString; version: z.ZodString; main: z.ZodString; icon: z.ZodOptional<z.ZodString>; description: z.ZodOptional<z.ZodString>; requires: z.ZodOptional<z.ZodArray<z.ZodString>>; optional: z.ZodOptional<z.ZodArray<z.ZodString>>; capabilitiesProposed: z.ZodOptional<z.ZodArray<z.ZodString>>; }, z.core.$loose>;

export type {
  AIAnalyticsModel,
  AIStatus,
  Activity,
  ActivityConfig,
  ActivityDefinition,
  AnalyticsInsight,
  AnalyticsPrivacyConfig,
  AnchorToolConfig,
  BarometerMetricConfig,
  CanvasWidgetConfig,
  CapabilityCategory,
  CapabilityContext,
  CapabilityDescriptor,
  CapabilityResult,
  CapabilityRole,
  ClassroomAttributionAwardConfig,
  ClassroomToolConfig,
  ClassroomTopbarActionConfig,
  CockpitWidgetConfig,
  CodeAnalyticsModel,
  CollaborationAnalyticsData,
  CollaborationEventMap,
  CollaborationEventType,
  CollaborationMode,
  CollaborationPermission,
  CommandMetadata,
  ConfigDeclaration,
  ConfigProperty,
  ConnectionState,
  ContributionAccessor,
  ContributionConfig,
  ContributionSummary,
  CustomIndicatorDefinition,
  CustomInsightRule,
  CustomMetricDefinition,
  CustomPresenceDefinition,
  DashboardWidgetConfig,
  EntityRole,
  EntityType,
  EventSubscriber,
  Flow,
  FocusState,
  GroupAnalyticsModel,
  GroupData,
  GroupPresenceData,
  GroupStatus,
  GroupWorkspaceData,
  HelpDocConfig,
  HighLevelIndicators,
  IAIServiceContract,
  IAnalyticsCapability,
  IAnalyticsServiceContract,
  ICapabilityProviderHandler,
  IChatCapability,
  ICompletionCapability,
  IConfigService,
  ILessonCapability,
  ILessonServiceContract,
  IPluginCapability,
  IPluginRuntime,
  IPluginServiceContract,
  IRuntimeModule,
  IRuntimeService,
  IRuntimeServiceContract,
  IStorageServiceContract,
  IToolCapability,
  IUnifiedPluginContext,
  IWhiteboardCapability,
  IWhiteboardServiceContract,
  InteractionSignal,
  InvocationRequest,
  Lesson,
  LessonAnalyticsModel,
  LessonEventType,
  LessonSnapshot,
  ManifestV3,
  NormalizedAnalyticsEvent,
  ObjectLock,
  PaletteItemContributionConfig,
  Participant,
  ParticipantRole,
  PeerReviewBadgeConfig,
  PeerReviewRubricConfig,
  PlatformEvent,
  PluginStatus,
  PredictionResult,
  PresenceDashboardMetrics,
  PresenceDiff,
  PresenceEntity,
  PresenceEventMap,
  PresenceEventType,
  PresencePrivacyConfig,
  QuickActivityConfig,
  QuizAnalyticsModel,
  RawAnalyticsMetrics,
  ResultType,
  RuntimeContextData,
  RuntimeEventEnvelope,
  RuntimeEventMap,
  RuntimeEventType,
  RuntimeHookName,
  RuntimeLifecycleState,
  RuntimePermission,
  RuntimeRole,
  RuntimeSnapshot,
  RuntimeStateTree,
  ServiceDescriptor,
  ServiceInspectionInfo,
  ServiceLifecycleState,
  SharedObjectData,
  Stage,
  StageAnalytics,
  StageCardConfig,
  StageStatus,
  StudentAction,
  StudentAnalyticsModel,
  StudentCompetencyDimensionConfig,
  StudentLessonToolConfig,
  StudentProfileWidgetConfig,
  StudentStatus,
  StudentViewConfig,
  SyncMessage,
  SyncType,
  TeacherStatus,
  TeacherTabConfig,
  TeachingContextData,
  TeachingObject,
  TimelineSegmentConfig,
  UserParticipant,
  WhiteboardAnalyticsModel,
  WhiteboardStatus,
};
export {
  PluginCapabilityGateway,
  PluginContextAdapter,
  PluginDistributionManager,
  PluginLifecycleManager,
  PluginRuntimeAdapter,
  ServiceScope,
  UnifiedExtensionRegistry,
};
