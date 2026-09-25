/**
 * @openlearn/plugin-sdk — standalone type declarations (V3.2).
 *
 * Self-contained `.d.ts` for npm publishing. No re-exports from monorepo internals.
 * This is the public API contract for OpenLearn plugin development.
 *
 * Generated from packages/core/ source types. Update when core types change.
 */

// ── Token ────────────────────────────────────────────────────────────────

declare class Token<T> {
  readonly name: string;
  readonly version: string;
  // Public phantom carries the service type so `ctx.resolve(token)` can
  // infer `T` structurally even when the token originates from a different
  // `Token` declaration (e.g. core's Token class).
  readonly __serviceType?: T;
  constructor(name: string, version?: string);
}

// ── Plugin State & Lifecycle ─────────────────────────────────────────────

declare enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

interface Disposable {
  dispose(): void;
}

// ── Manifest ─────────────────────────────────────────────────────────────

interface Manifest {
  id: string;
  name: string;
  version: string;
  main: string;
  requires?: string[];
  optional?: string[];
  capabilitiesProposed?: string[];
  engines?: { openlearn: string };
  pluginDependencies?: string[];
  provides?: string[];
  configuration?: {
    properties?: Record<
      string,
      {
        type: 'string' | 'number' | 'boolean' | 'integer';
        default?: unknown;
        description?: string;
        enum?: unknown[];
        minimum?: number;
        maximum?: number;
      }
    >;
  };
  contributes?: Record<string, any>;
  updateSource?: {
    /** 远端仓库类型：github-release | gitee-release */
    type: 'github-release' | 'gitee-release';
    /** 仓库路径，如 "user/repo-name" */
    repo: string;
  };
  /** RESTful API 路由与安全配置（V5.2） */
  api?: {
    baseRoute?: string;
    routes?: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      auth?: boolean;
      roles?: string[];
      rateLimit?: {
        windowMs?: number;
        max?: number;
      };
    }>;
  };
  [key: string]: unknown;
}

// ── Command & Event ──────────────────────────────────────────────────────

interface PlatformCommand<T = unknown> {
  id: string;
  type: string;
  actorId: string;
  payload: T;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

interface CommandHandler {
  execute(command: PlatformCommand): Promise<unknown>;
}

interface CommandMetadata {
  approved?: boolean;
  [key: string]: unknown;
}

interface PlatformEvent<T = unknown> {
  id: string;
  type: string;
  source: string;
  payload: T;
  timestamp: number;
  correlationId?: string;
}

type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;

// ── Action Registry ──────────────────────────────────────────────────────

interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly capabilityRequired: string;
  readonly isHighRisk?: boolean;
}

// ── Service Interfaces ───────────────────────────────────────────────────

interface ICommandBusService {
  execute<T extends PlatformCommand>(command: T): Promise<unknown>;
  registerHandler(commandType: string, handler: CommandHandler): void | Promise<void>;
  unregisterHandler(commandType: string): void | Promise<void>;
  createCommand<T>(
    type: string,
    payload: T,
    actorId: string,
    metadata?: CommandMetadata,
  ): PlatformCommand<T> | Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): void | Promise<void>;
}

interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
  unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
}

interface IActionRegistryService {
  register(descriptor: ActionDescriptor): void | Promise<void>;
  unregister(id: string): void | Promise<void>;
  getAllActions(): ActionDescriptor[] | Promise<ActionDescriptor[]>;
  getAgentTools(): unknown[] | Promise<unknown[]>;
  getActionByToolName(toolName: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): ActionDescriptor | undefined | Promise<ActionDescriptor | undefined>;
}

interface ICapabilityService {
  grant(actorId: string, cap: string): void | Promise<void>;
  revokeAll(actorId: string): void | Promise<void>;
  check(actorId: string, requiredCap: string): boolean | Promise<boolean>;
}

interface IProcessService {
  spawn(name: string, taskType: string, payload: unknown): string | Promise<string>;
  kill(processId: string): void | Promise<void>;
  registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
  unregisterHandler(taskType: string): void | Promise<void>;
  registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
  ): string | Promise<string>;
  restore(): void | Promise<void>;
}

type ProcessHandler = (
  processId: string,
  payload: unknown,
  state: unknown,
  log: (msg: string) => void,
  updateState: (newState: unknown) => void,
) => Promise<void>;

interface IStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface IAIService {
  generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
}

// ── Logger ───────────────────────────────────────────────────────────────

interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ── Config Service ───────────────────────────────────────────────────────

interface IConfigService {
  get<T = unknown>(key: string): T;
  getAll(): Record<string, unknown>;
  set(key: string, value: unknown): Promise<void>;
  onChange(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
}

interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  default?: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

interface ConfigDeclaration {
  properties?: Record<string, ConfigProperty>;
}

// ── Plugin Database API ──────────────────────────────────────────────────

interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string;
  dropAllTables(): Promise<void>;
  migrate(targetVersion: number, upgradeFn: (db: unknown) => Promise<void> | void): Promise<void>;
}

// ── Contribution Registry ────────────────────────────────────────────────

interface ContributionSummary {
  slot: string;
  count: number;
  items: Array<{ id: string; label: string }>;
}

interface ContributionAccessor {
  list(): ContributionSummary[];
}

interface ClassroomToolConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  commandType: string;
  payload?: Record<string, unknown>;
}

interface TeacherTabConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}

interface DashboardWidgetConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}

interface StudentViewConfig {
  id: string;
  label: string;
  icon?: string;
  route?: string;
}

interface StudentLessonToolConfig {
  id: string;
  label: string;
  icon?: string;
}

interface AnchorToolConfig {
  id: string;
  label: string;
  icon?: string;
  placement?: 'before' | 'after';
}

interface HelpDocConfig {
  id: string;
  title: string;
  description?: string;
  markdownUrl?: string;
}
type ContributionConfig =
  | ClassroomToolConfig
  | TeacherTabConfig
  | DashboardWidgetConfig
  | StudentViewConfig
  | StudentLessonToolConfig
  | AnchorToolConfig
  | HelpDocConfig;

// ── V5.2: RESTful API Contracts ──────────────────────────────────────────

interface PluginApiRequest<TBody = unknown, TQuery = Record<string, string | string[]>> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: TQuery;
  readonly headers: Record<string, string>;
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
  status?: number;
  headers?: Record<string, string>;
  body: TBody;
  sessionToken?: string;
}

type PluginApiHandler<TBody = unknown, TRes = unknown> = (
  req: PluginApiRequest<TBody>,
) => Promise<PluginApiResponse<TRes> | TRes> | PluginApiResponse<TRes> | TRes;

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

interface IPluginHttpRouter {
  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  post<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  put<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  patch<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  route<TBody = unknown, TRes = unknown>(method: string, path: string, handler: PluginApiHandler<TBody, TRes>): void;
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;
}

declare class PluginHttpRouter implements IPluginHttpRouter {
  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  post<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  put<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  patch<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  route<TBody = unknown, TRes = unknown>(method: string, path: string, handler: PluginApiHandler<TBody, TRes>): void;
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;
  match(
    method: string,
    path: string,
  ): {
    handler?: PluginApiHandler;
    streamHandler?: PluginStreamHandler;
    isStream?: boolean;
    params: Record<string, string>;
  } | null;
  handle(req: PluginApiRequest): Promise<PluginApiResponse>;
  handleStream(req: PluginApiRequest, stream: PluginStreamResponse): Promise<void>;
  getRegisteredRoutes(): Array<{ method: string; pattern: string; isStream?: boolean }>;
  clear(): void;
}

// ── Plugin Context ───────────────────────────────────────────────────────

interface PluginContext {
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
    /** 积分维度注册表（Worker 模式插件恒为 null，见 worker-manager 白名单说明） */
    pointsDimension: IPointsDimensionRegistry | null;
    /** 积分流水服务（Worker 模式插件恒为 null） */
    pointsLedger: IPointsLedgerService | null;
  };
  pluginId: string;
  manifest: Manifest;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  db: PluginDatabaseAPI;
  log: IPluginLogger;
  config: IConfigService;
  contributions: ContributionAccessor;
  http: IPluginHttpRouter;
  require(moduleName: string): unknown;
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  status?: string;
  execution_mode?: string;
}

// ── Inlined core service / host types (self-contained copy of kernel contracts) ──
// These mirror the concrete types the kernel registers for each service token,
// so that `ctx.resolve(token)` yields a usable (non-`unknown`) type.

interface PointsDimensionSpec {
  id: string;
  name: string;
  category: 'builtin' | 'plugin';
  defaultWeight: number;
  maxScore?: number;
  description?: string;
  pluginId?: string;
}

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

interface ISemesterGradeService {
  saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
}

interface IPointsDimensionRegistry {
  registerDimension(spec: PointsDimensionSpec): void;
  getDimension(id: string): PointsDimensionSpec | undefined;
  listDimensions(): PointsDimensionSpec[];
}

interface IPointsLedgerService {
  addPoints(
    studentId: string,
    classId: string,
    dimensionId: string,
    deltaPoints: number,
    reason: string,
    pluginId?: string,
  ): Promise<PointLogItem>;
  getLogs(studentId: string, classId?: string): Promise<PointLogItem[]>;
  getStudentTotalByDimension(studentId: string, classId: string, dimensionId: string): Promise<number>;
  getStudentDimensionSummary(studentId: string, classId: string): Promise<Record<string, number>>;
}

interface ILessonEngineService {
  getRuntime(): Promise<unknown>;
}

interface IClassroomRuntimeService {
  getRuntimeKernel(): Promise<unknown>;
}

interface IPresenceEngineService {
  getPresenceEngine(): Promise<unknown>;
}

interface ITeachingCollaborationService {
  getCollaborationEngine(): Promise<unknown>;
}

interface ILearningAnalyticsService {
  getAnalyticsEngine(): Promise<unknown>;
}

// Activity ecosystem types (referenced by IActivityRegistryToken).
type ActivityCategory = 'assessment' | 'engagement' | 'collaboration' | 'management' | 'ai' | 'media' | 'custom';

type ActivityRole = 'teacher' | 'student' | 'assistant' | 'observer' | 'all';

type ActivityDevice = 'desktop' | 'tablet' | 'mobile' | 'all';

type ActivityLifecycleState = 'registered' | 'initialized' | 'running' | 'paused' | 'finished' | 'disposed';

interface ActivityClassroomContext {
  readonly classroomId?: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly permissions?: string[];
  readonly lifecycleState?: string;
  readonly raw?: unknown;
}

interface ActivityContext {
  readonly commandBus: ICommandBusService;
  readonly eventBus: IEventBusService;
  readonly actionRegistry: IActionRegistryService;
  readonly capability: ICapabilityService;
  readonly ai: IAIService;
  readonly classroom?: ActivityClassroomContext | null;
}

interface ActivityProviderDescriptor {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category: ActivityCategory;
  permissions?: string[];
  supportedRoles: ActivityRole[];
  supportedDevices?: ActivityDevice[];
  tags?: string[];
  version: string;
  provider: string;
  commandType?: string;
  aiAction?: ActionDescriptor;
  aiContext?: Record<string, unknown>;
}

interface ActivityProvider {
  readonly descriptor: ActivityProviderDescriptor;
  readonly state: ActivityLifecycleState;
  readonly startedAt?: number;
  initialize(context: ActivityContext): Promise<void> | void;
  start(context: ActivityContext, payload?: Record<string, unknown>): Promise<unknown>;
  pause(context: ActivityContext): Promise<void> | void;
  resume(context: ActivityContext): Promise<void> | void;
  finish(context: ActivityContext): Promise<void> | void;
  dispose(context: ActivityContext): Promise<void> | void;
}

interface StartActivityResult {
  provider: string;
  dispatched: boolean;
  result?: unknown;
}

interface ActivityRegistry {
  registerProvider(provider: ActivityProvider): void;
  unregisterProvider(id: string): boolean;
  getProvider(id: string): ActivityProvider | undefined;
  listProviders(): ReadonlyArray<ActivityProvider>;
  listDescriptors(): ActivityProviderDescriptor[];
  listByRole(role: ActivityRole): ActivityProvider[];
  listByCategory(category: ActivityCategory): ActivityProvider[];
  startActivity(
    id: string,
    context: ActivityContext,
    payload?: Record<string, unknown>,
    actorId?: string,
  ): Promise<StartActivityResult>;
  clear(): void;
}

// PluginHost — public surface of the kernel PluginHost consumed via IPluginHostToken.
interface PluginHost {
  registerPreloadedPlugin(
    pluginId: string,
    plugin: { manifest: unknown; activate: (ctx: PluginContext) => Promise<void>; deactivate?: () => Promise<void> },
  ): void;
  listPlugins(): PluginInfo[];
  resolvePluginUuid(idOrManifestId: string): string;
  installPlugin(sourceCode: string): Promise<Manifest>;
  activatePlugin(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void>;
  deactivatePlugin(pluginId: string): Promise<void>;
  togglePlugin(pluginId: string): Promise<string>;
}

// ── Capability & Platform Kernel Services (v0.3.17+) ─────────────────────

interface IntegrationHealthStatus {
  readonly isHealthy: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

interface IntegrationDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies?: ReadonlyArray<string>;
}

interface IAICapabilityService {
  getCapabilityKernel(): Promise<unknown>;
}

interface ICapabilityRuntimeService {
  getRuntimeKernel(): Promise<unknown>;
}

interface ICapabilityGovernanceService {
  getGovernanceKernel(): Promise<unknown>;
}

interface IPlatformServiceRegistryService {
  getServiceRegistryKernel(): Promise<unknown>;
}

// AI capability registry contracts (referenced by ICapabilityRegistryToken
// and IPluginCapabilityGatewayToken).
interface IAICapability {
  readonly meta: {
    readonly id: string;
    readonly name: string;
    /** 能力类型判别字符串（源类型为含 `| string` 的宽松联合，如 'chat' | 'tool' | …） */
    readonly type: string;
    readonly description: string;
    readonly version: string;
  };
}

interface CapabilityRegistry {
  registerCapability(capability: IAICapability): void;
  resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T;
  hasCapability(capabilityId: string): boolean;
  listCapabilities(): ReadonlyArray<IAICapability>;
  clear(): void;
}

// ── P7 Unified Plugin Services ───────────────────────────────────────────

interface CapabilityMetadata {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly version: string;
  readonly description: string;
  readonly provider?: string;
  readonly stability?: 'experimental' | 'stable' | 'deprecated';
}

interface ExtensionItemMetadata {
  readonly id: string;
  readonly category: string;
  readonly name?: string;
  readonly version?: string;
  readonly providerId?: string;
  readonly description?: string;
  readonly impl?: unknown;
}

/** 统一插件生命周期管理器（EU-01）：包装 PluginHost 状态机与钩子的协调层 */
interface IPluginLifecycleManager {
  readonly pluginHost: PluginHost;
  getPluginState(pluginId: string): PluginState | undefined;
  listPlugins(): ReadonlyArray<PluginInfo>;
  activatePlugin(pluginId: string): Promise<void>;
  deactivatePlugin(pluginId: string): Promise<void>;
  reloadPlugin(pluginId: string, newCode?: string): Promise<void>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

/** 插件能力网关：发现 / 解析 / 路由平台能力调用的单一入口 */
interface IPluginCapabilityGateway {
  readonly capabilityRegistry: CapabilityRegistry;
  listCapabilities(): ReadonlyArray<CapabilityMetadata>;
  hasCapability(capabilityId: string): boolean;
  resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T;
  executeCapability<T = unknown>(capabilityId: string, methodName: string, ...args: unknown[]): Promise<T>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

/** 统一扩展注册表：所有平台扩展点（widget / command / AI action / activity 等）的单一管理层 */
interface IUnifiedExtensionRegistry {
  registerExtension(category: string, id: string, impl: unknown, meta?: Partial<ExtensionItemMetadata>): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

interface PluginPackageMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly repositoryId: string;
  readonly downloadUrl?: string;
  readonly manifest?: Manifest;
}

interface IPluginRepositoryAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'official' | 'private' | 'local' | 'offline';
  listPackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  getPackage(pluginId: string): Promise<PluginPackageMetadata | undefined>;
  fetchZipBuffer(pluginId: string): Promise<Buffer>;
}

interface PluginUpdateOptions {
  targetPluginId?: string;
  executionMode?: 'worker' | 'inline';
  allowDowngrade?: boolean;
}

interface PluginUpdateResult {
  pluginId: string;
  manifest: Manifest;
  oldVersion: string;
  newVersion: string;
  previousStatus: string;
  wasActive: boolean;
}

/** 插件分发管理器：仓库注册、包元数据、安装 / 更新编排与卸载 */
interface IPluginDistributionManager {
  readonly pluginHost: PluginHost;
  registerRepository(repo: IPluginRepositoryAdapter): void;
  listRepositories(): ReadonlyArray<IPluginRepositoryAdapter>;
  listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  installFromZip(
    zipBuffer: Buffer,
    executionMode?: 'worker' | 'inline',
  ): Promise<{ pluginId: string; manifest: Manifest }>;
  installFromRepository(repoId: string, pluginId: string): Promise<{ pluginId: string; manifest: Manifest }>;
  updatePlugin(pluginId: string, zipBuffer?: Buffer): Promise<void>;
  updateFromZip(zipBuffer: Buffer, options?: PluginUpdateOptions): Promise<PluginUpdateResult>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

/** 插件运行时组合：插件宿主与 Worker 管理器的有序启停编排 */
declare class PluginRuntimeComposition {
  readonly pluginHost: PluginHost;
  readonly workerManager?: unknown;
  get isStarted(): boolean;
  start(context?: unknown): Promise<void>;
  stop(): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

// ── Courseware Runtime Script Extension (v0.3.22) ────────────────────────
// 插件注册后、在互动课件 iframe（opaque origin）内部执行的脚本扩展点。
// 服务端渲染课件 HTML 时是唯一投递位置（injectLmsSdk），故 list() 为同步。

interface CoursewareRuntimeScript {
  /** 脚本标识，同一 owner 内唯一；重复注册同一 id 视为覆盖 */
  id: string;
  /** 在课件 iframe 内执行的脚本源码（宿主会包进 `<script>` 标签） */
  source: string;
  /** 仅对指定课件生效（对应 `courseware.id`）；与 coursewareUuid 均缺省时为全局脚本 */
  coursewareId?: string;
  /** 仅对指定课件生效（对应 `courseware.uuid`） */
  coursewareUuid?: string;
  /** 注入位置，默认 'body-end'（Bridge SDK 之后，DOM 已可访问） */
  position?: 'head' | 'body-end';
  /** 执行顺序，升序；默认 100 */
  priority?: number;
}

interface IRegisteredCoursewareRuntimeScript extends CoursewareRuntimeScript {
  /** 注册方，通常为 pluginId */
  owner: string;
  position: 'head' | 'body-end';
  priority: number;
}

interface ICoursewareRuntimeScriptRegistry {
  register(owner: string, script: CoursewareRuntimeScript): void;
  unregister(owner: string, id: string): void;
  clear(owner?: string): void;
  list(courseware?: { id?: string; uuid?: string }): IRegisteredCoursewareRuntimeScript[];
  listOwners(): string[];
}

// ── Classroom Lifecycle & Interaction Extensibility (v0.3.22) ────────────

type ClassroomLifecycleStage =
  | 'PRE_CLASS_READY'
  | 'IN_CLASS_TEACHING'
  | 'WRAP_UP_EXIT_TICKET'
  | 'ARCHIVED_REPORT';

interface StageGuardResult {
  allowed: boolean;
  reason?: string;
}

type ClassroomStageGuard = (
  fromStage: ClassroomLifecycleStage,
  toStage: ClassroomLifecycleStage,
  context: { lessonId: string; classId?: string; actorId: string },
) => boolean | StageGuardResult | Promise<boolean | StageGuardResult>;

interface IClassroomLifecycleService {
  getStage(lessonId: string): Promise<ClassroomLifecycleStage>;
  transitionStage(
    lessonId: string,
    toStage: ClassroomLifecycleStage,
    actorId: string,
    classId?: string,
  ): Promise<{ success: boolean; stage: ClassroomLifecycleStage; reason?: string }>;
  registerStageGuard(owner: string, guard: ClassroomStageGuard): void;
  unregisterStageGuard(owner: string): void;
}

interface QuickActivityDescriptor {
  id: string;
  name: string;
  category: string;
  icon?: string;
  description?: string;
  supportedRoles?: ('teacher' | 'student')[];
}

interface IInteractionRuntimeService {
  registerActivityProvider(owner: string, descriptor: QuickActivityDescriptor): void;
  unregisterActivityProvider(owner: string, id: string): void;
  listActivityProviders(): QuickActivityDescriptor[];
}

interface ClassroomCountdownDescriptor {
  lessonId: string;
  totalDuration: number;
  timeRemaining: number;
  isRunning: boolean;
  isPaused: boolean;
  label: string;
  endsAt: number | null;
}

interface IClassroomCountdownService {
  getCountdown(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  start(lessonId: string, duration: number, label?: string): Promise<ClassroomCountdownDescriptor>;
  pause(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  resume(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  reset(lessonId: string): Promise<ClassroomCountdownDescriptor>;
  addTime(lessonId: string, seconds: number): Promise<ClassroomCountdownDescriptor>;
}

// ── Token Constants ──────────────────────────────────────────────────────

declare const ICommandBusServiceToken: Token<ICommandBusService>;
declare const IEventBusServiceToken: Token<IEventBusService>;
declare const IActionRegistryServiceToken: Token<IActionRegistryService>;
declare const ICapabilityServiceToken: Token<ICapabilityService>;
declare const IProcessServiceToken: Token<IProcessService>;
declare const IStorageServiceToken: Token<IStorageService>;
declare const IAIServiceToken: Token<IAIService>;
// Self-contained SQLite database surface (avoids depending on `better-sqlite3`
// type resolution from consumers that may not have it linked).
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  // `any` (not `T`) because the real better-sqlite3 `Database.transaction`
  // returns a `Transaction<T>` wrapper; this keeps real `Database` assignable.
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): any;
  exec(sql: string): unknown;
  pragma(source: string, options?: unknown): unknown;
  close(): void;
}
declare const IDatabaseToken: Token<SqliteDatabase>;
declare const IPluginHostToken: Token<PluginHost>;
declare const ISemesterGradeServiceToken: Token<ISemesterGradeService>;
declare const IPointsDimensionRegistryToken: Token<IPointsDimensionRegistry>;
declare const IPointsLedgerServiceToken: Token<IPointsLedgerService>;
declare const ILessonEngineServiceToken: Token<ILessonEngineService>;
declare const IClassroomRuntimeServiceToken: Token<IClassroomRuntimeService>;
declare const IPresenceEngineServiceToken: Token<IPresenceEngineService>;
declare const ITeachingCollaborationServiceToken: Token<ITeachingCollaborationService>;
declare const ILearningAnalyticsServiceToken: Token<ILearningAnalyticsService>;
declare const IAICapabilityServiceToken: Token<IAICapabilityService>;
declare const ICapabilityRuntimeServiceToken: Token<ICapabilityRuntimeService>;
declare const ICapabilityGovernanceServiceToken: Token<ICapabilityGovernanceService>;
declare const IPlatformServiceRegistryToken: Token<IPlatformServiceRegistryService>;
declare const ICapabilityRegistryToken: Token<CapabilityRegistry>;
declare const IPluginLifecycleManagerToken: Token<IPluginLifecycleManager>;
declare const IPluginCapabilityGatewayToken: Token<IPluginCapabilityGateway>;
declare const IUnifiedExtensionRegistryToken: Token<IUnifiedExtensionRegistry>;
declare const IPluginDistributionManagerToken: Token<IPluginDistributionManager>;
declare const IPluginRuntimeCompositionToken: Token<PluginRuntimeComposition>;
declare const ICoursewareRuntimeScriptRegistryToken: Token<ICoursewareRuntimeScriptRegistry>;
declare const IClassroomLifecycleServiceToken: Token<IClassroomLifecycleService>;
declare const IInteractionRuntimeServiceToken: Token<IInteractionRuntimeService>;
declare const IClassroomCountdownServiceToken: Token<IClassroomCountdownService>;

// ── Frontend Whiteboard Registries (V3.5) ────────────────────────────────
// Type-only mirrors of the host runtime registries for third-party plugins.
// Plugins receive registration functions via `ctx.ui.registerFullscreenRenderer`
// / `ctx.ui.registerPropertyEditor` — they do NOT import the host singletons.

declare interface FullscreenRendererProps {
  elementType: string;
  data: Record<string, any>;
  onClose: () => void;
  containerSize: { width: number; height: number };
  lessonId: string;
}

declare type FullscreenRenderer = (props: FullscreenRendererProps) => unknown;

declare interface PropertyEditorProps {
  elementId: string;
  elementType: string;
  data: Record<string, any>;
  updateData: (partial: Record<string, any>) => void;
  lessonId: string;
  onClose: () => void;
}

declare type PropertyEditorComponent = (props: PropertyEditorProps) => unknown;

declare interface CoursewareSourceLoader {
  id: string;
  resolve(
    data: {
      title?: string;
      code?: string;
      coursewareUuid?: string;
      resourceId?: string;
      sourceType?: string;
      sourceId?: string;
    },
    context: { lessonId: string },
  ): string | null;
}

// ── Frontend Lesson Palette Registries (V5.1) ───────────────────────────
declare interface PaletteSelectOption {
  value: string;
  label: string;
}

declare interface PaletteEditField {
  key: string;
  labelZh: string;
  labelEn: string;
  kind: 'input' | 'textarea' | 'options' | 'select';
  placeholderZh?: string;
  placeholderEn?: string;
  options?: PaletteSelectOption[];
  loadOptions?: () => Promise<PaletteSelectOption[]>;
}

declare interface PaletteItemComponentProps {
  elementId: string;
  lessonId: string;
  data: Record<string, any>;
  userRole?: 'teacher' | 'student';
  onElementUpdate?: (elementId: string, data: Record<string, any>) => Promise<void>;
}

declare interface PaletteItemConfig {
  type: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  icon?: any;
  color?: 'slate' | 'blue' | 'violet' | 'amber' | 'rose' | 'emerald' | 'cyan' | 'pink' | 'indigo';
  group?: string;
  defaultData?: Record<string, any>;
  editFields?: PaletteEditField[];
  component?: (props: PaletteItemComponentProps) => unknown;
}

export type {
  PluginContext,
  PluginDatabaseAPI,
  PluginInfo,
  PluginState,
  Disposable,
  IPluginLogger,
  Manifest,
  PlatformCommand,
  CommandHandler,
  ActionDescriptor,
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
  SqliteDatabase,
  SqliteStatement,
  PointsDimensionSpec,
  PointLogItem,
  ISemesterGradeService,
  IPointsDimensionRegistry,
  IPointsLedgerService,
  ILessonEngineService,
  IClassroomRuntimeService,
  IPresenceEngineService,
  ITeachingCollaborationService,
  ILearningAnalyticsService,
  IAICapabilityService,
  ICapabilityRuntimeService,
  ICapabilityGovernanceService,
  IPlatformServiceRegistryService,
  IAICapability,
  CapabilityRegistry,
  CapabilityMetadata,
  ExtensionItemMetadata,
  IPluginLifecycleManager,
  IPluginCapabilityGateway,
  IUnifiedExtensionRegistry,
  PluginPackageMetadata,
  IPluginRepositoryAdapter,
  PluginUpdateOptions,
  PluginUpdateResult,
  IPluginDistributionManager,
  PluginRuntimeComposition,
  CoursewareRuntimeScript,
  IRegisteredCoursewareRuntimeScript,
  ICoursewareRuntimeScriptRegistry,
  ClassroomLifecycleStage,
  StageGuardResult,
  ClassroomStageGuard,
  IClassroomLifecycleService,
  QuickActivityDescriptor,
  IInteractionRuntimeService,
  ClassroomCountdownDescriptor,
  IClassroomCountdownService,
  IntegrationHealthStatus,
  IntegrationDescriptor,
  ActivityCategory,
  ActivityRole,
  ActivityDevice,
  ActivityLifecycleState,
  ActivityClassroomContext,
  ActivityContext,
  ActivityProviderDescriptor,
  ActivityProvider,
  StartActivityResult,
  ActivityRegistry,
  PluginHost,
  FullscreenRendererProps,
  FullscreenRenderer,
  PropertyEditorProps,
  PropertyEditorComponent,
  CoursewareSourceLoader,
  PaletteSelectOption,
  PaletteEditField,
  PaletteItemComponentProps,
  PaletteItemConfig,
  PluginApiRequest,
  PluginApiResponse,
  PluginApiHandler,
  PluginStreamResponse,
  PluginStreamHandler,
  IPluginHttpRouter,
  AuthBridgeUser,
  IAuthSessionBridgeService,
};

export {
  PluginHttpRouter,
  Token,
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
  ICapabilityRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginCapabilityGatewayToken,
  IUnifiedExtensionRegistryToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  ICoursewareRuntimeScriptRegistryToken,
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
  IClassroomCountdownServiceToken,
  IActivityRegistryToken,
  IAuthSessionBridgeToken,
};

declare const IActivityRegistryToken: Token<ActivityRegistry>;
declare const IAuthSessionBridgeToken: Token<IAuthSessionBridgeService>;

interface AuthBridgeUser {
  userId: string;
  username: string;
  role: 'administrator' | 'teacher' | 'student';
  name?: string;
  email?: string;
  avatar?: string | null;
  classId?: string;
}

interface IAuthSessionBridgeService {
  createSession(user: AuthBridgeUser): Promise<{ token: string; maxAge: number }>;
}
