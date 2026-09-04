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
    properties?: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'integer';
      default?: unknown;
      description?: string;
      enum?: unknown[];
      minimum?: number;
      maximum?: number;
    }>;
  };
  contributes?: Record<string, Array<{ id: string; [key: string]: unknown }>>;
  /** 远端更新源配置。声明后插件中心可自动检测 GitHub/Gitee Release 中的新版本 */
  updateSource?: {
    /** 远端仓库类型：github-release | gitee-release */
    type: 'github-release' | 'gitee-release';
    /** 仓库路径，如 "user/repo-name" */
    repo: string;
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
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): PlatformCommand<T> | Promise<PlatformCommand<T>>;
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
  registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): string | Promise<string>;
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
  };
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
type ActivityCategory =
  | 'assessment'
  | 'engagement'
  | 'collaboration'
  | 'management'
  | 'ai'
  | 'media'
  | 'custom';

type ActivityRole = 'teacher' | 'student' | 'assistant' | 'observer' | 'all';

type ActivityDevice = 'desktop' | 'tablet' | 'mobile' | 'all';

type ActivityLifecycleState =
  | 'registered'
  | 'initialized'
  | 'running'
  | 'paused'
  | 'finished'
  | 'disposed';

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
};

export {
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
  IActivityRegistryToken,
};

declare const IActivityRegistryToken: Token<ActivityRegistry>;






