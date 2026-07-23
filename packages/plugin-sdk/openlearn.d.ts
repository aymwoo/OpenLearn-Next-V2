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
  [key: string]: unknown;
}

// ── Command & Event ──────────────────────────────────────────────────────

interface PlatformCommand<T = unknown> {
  id: string;
  type: string;
  actorId: string;
  payload: T;
  timestamp: number;
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
  registerHandler(commandType: string, handler: CommandHandler): Promise<void>;
  unregisterHandler(commandType: string): Promise<void>;
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): Promise<void>;
}

interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
  unsubscribe(eventType: string, subscriber: EventSubscriber): Promise<void>;
}

interface IActionRegistryService {
  register(descriptor: ActionDescriptor): Promise<void>;
  unregister(id: string): Promise<void>;
  getAllActions(): Promise<ActionDescriptor[]>;
  getAgentTools(): Promise<unknown[]>;
  getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined>;
}

interface ICapabilityService {
  grant(actorId: string, cap: string): Promise<void>;
  revokeAll(actorId: string): Promise<void>;
  check(actorId: string, requiredCap: string): Promise<boolean>;
}

interface IProcessService {
  spawn(name: string, taskType: string, payload: unknown): Promise<string>;
  kill(processId: string): Promise<void>;
  registerHandler(taskType: string, handler: ProcessHandler): Promise<void>;
  unregisterHandler(taskType: string): Promise<void>;
  registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): Promise<string>;
  restore(): Promise<void>;
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

// ── Token Constants ──────────────────────────────────────────────────────

declare const ICommandBusServiceToken: Token<ICommandBusService>;
declare const IEventBusServiceToken: Token<IEventBusService>;
declare const IActionRegistryServiceToken: Token<IActionRegistryService>;
declare const ICapabilityServiceToken: Token<ICapabilityService>;
declare const IProcessServiceToken: Token<IProcessService>;
declare const IStorageServiceToken: Token<IStorageService>;
declare const IAIServiceToken: Token<IAIService>;
declare const IDatabaseToken: Token<unknown>;
declare const IPluginHostToken: Token<unknown>;
declare const ISemesterGradeServiceToken: Token<unknown>;
declare const ILessonEngineServiceToken: Token<unknown>;
declare const IClassroomRuntimeServiceToken: Token<unknown>;
declare const IPresenceEngineServiceToken: Token<unknown>;
declare const ITeachingCollaborationServiceToken: Token<unknown>;
declare const ILearningAnalyticsServiceToken: Token<unknown>;





