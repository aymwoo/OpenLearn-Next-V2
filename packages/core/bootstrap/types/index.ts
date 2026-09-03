/**
 * OpenLearn Platform Kernel - Bootstrap Types & Platform Contracts (EU-01 & EU-02 / PI-002)
 *
 * Establishes the foundational common language, lifecycle stages, error hierarchy,
 * platform constants, abstract interfaces, and bootstrap context contracts.
 */

// ── ⑦ Common Platform Types ──────────────────────────────────────────────

/** Unique identifier for a platform instance. */
export type PlatformId = string;

/** Unique identifier for a platform capability. */
export type CapabilityId = string;

/** Unique identifier for a platform service. */
export type ServiceId = string;

/** Unique identifier for a platform extension. */
export type ExtensionId = string;

/** Dot-separated namespace string (e.g. 'lesson.generate.quiz'). */
export type Namespace = string;

/** Semantic version string (e.g. '0.2.5'). */
export type Version = string;

/** Environment deployment mode. */
export type EnvironmentType = 'development' | 'production' | 'test';

/** Platform execution mode. */
export type PlatformMode = 'standalone' | 'cluster' | 'embedded';


// ── ① Bootstrap Lifecycle Enum ───────────────────────────────────────────

/**
 * Platform Kernel lifecycle stages.
 */
export enum PlatformStage {
  Created = 'Created',
  Configuring = 'Configuring',
  Registering = 'Registering',
  Initializing = 'Initializing',
  Activating = 'Activating',
  Ready = 'Ready',
  ShuttingDown = 'ShuttingDown',
  Disposed = 'Disposed',
}

/** Legacy type alias for stage compatibility. */
export type StartupStageType = `${PlatformStage}`;

/** Lifecycle state of the bootstrap process. */
export type BootstrapState =
  | 'Uninitialized'
  | 'Bootstrapping'
  | 'Active'
  | 'Failed'
  | 'Terminated';


// ── ② Bootstrap Error Hierarchy ──────────────────────────────────────────

/** Base class for all platform bootstrap errors. */
export class PlatformBootstrapError extends Error {
  constructor(
    message: string,
    public readonly stage?: PlatformStage,
    public readonly cause?: unknown
  ) {
    super(`[PlatformBootstrapError${stage ? `:${stage}` : ''}] ${message}`);
    this.name = 'PlatformBootstrapError';
  }
}

/** Thrown when platform configuration is invalid or missing required fields. */
export class ConfigurationError extends PlatformBootstrapError {
  constructor(message: string, cause?: unknown) {
    super(message, PlatformStage.Configuring, cause);
    this.name = 'ConfigurationError';
  }
}

/** Thrown when a required service or capability dependency is unresolvable or forms a cycle. */
export class DependencyError extends PlatformBootstrapError {
  constructor(message: string, cause?: unknown) {
    super(message, PlatformStage.Registering, cause);
    this.name = 'DependencyError';
  }
}

/** Thrown when service or capability registration fails due to collision or invalid descriptor. */
export class RegistrationError extends PlatformBootstrapError {
  constructor(message: string, cause?: unknown) {
    super(message, PlatformStage.Registering, cause);
    this.name = 'RegistrationError';
  }
}

/** Thrown when an invalid lifecycle state transition occurs during startup or shutdown. */
export class LifecycleError extends PlatformBootstrapError {
  constructor(message: string, stage?: PlatformStage, cause?: unknown) {
    super(message, stage, cause);
    this.name = 'LifecycleError';
  }
}

/** Thrown when a bootstrap stage exceeds the configured startup timeout limit. */
export class StartupTimeoutError extends PlatformBootstrapError {
  constructor(message: string, stage?: PlatformStage, cause?: unknown) {
    super(message, stage, cause);
    this.name = 'StartupTimeoutError';
  }
}

/** Legacy alias for backward compatibility. */
export const BootstrapError = PlatformBootstrapError;


// ── ③ Platform Constants ─────────────────────────────────────────────────

/** Current OpenLearn platform semantic version. */
export const PLATFORM_VERSION: Version = '0.2.5';

/** Official kernel name. */
export const PLATFORM_KERNEL_NAME = 'OpenLearn Platform Kernel';

/** Default startup stage timeout limit in milliseconds. */
export const BOOTSTRAP_TIMEOUT = 30000;

/** Default service scope. */
export const DEFAULT_SCOPE = 'Singleton';

/** Default root namespace. */
export const DEFAULT_NAMESPACE: Namespace = 'openlearn.core';

/** Platform event namespace prefix. */
export const EVENT_NAMESPACE: Namespace = 'openlearn.event';

/** Immutable array of platform stages in strict execution order. */
export const BOOTSTRAP_STAGE_NAMES: ReadonlyArray<PlatformStage> = Object.freeze([
  PlatformStage.Created,
  PlatformStage.Configuring,
  PlatformStage.Registering,
  PlatformStage.Initializing,
  PlatformStage.Activating,
  PlatformStage.Ready,
  PlatformStage.ShuttingDown,
  PlatformStage.Disposed,
]);

/** Default bootstrap configuration values. */
export interface PlatformBootstrapConfig {
  readonly environment: EnvironmentType;
  readonly mode: PlatformMode;
  readonly port: number;
  readonly debug: boolean;
  readonly pluginsDir: string;
  readonly dbPath: string;
  readonly metadata?: Record<string, unknown>;
}

export const DEFAULT_BOOTSTRAP_CONFIG: PlatformBootstrapConfig = Object.freeze({
  environment: 'development',
  mode: 'standalone',
  port: 9000,
  debug: false,
  pluginsDir: './plugins',
  dbPath: './packages/core/db/educational_os.db',
});


// ── ⑥ Lifecycle Contracts ────────────────────────────────────────────────

/** Disposable resource contract. */
export interface IPlatformDisposable {
  dispose(): Promise<void> | void;
}

/** Platform startup lifecycle contract. */
export interface IPlatformStartup {
  start(): Promise<void>;
}

/** Platform shutdown lifecycle contract. */
export interface IPlatformShutdown {
  shutdown(): Promise<void>;
}

/** Complete platform lifecycle contract combining startup, shutdown, and disposal. */
export interface IPlatformLifecycle extends IPlatformStartup, IPlatformShutdown, IPlatformDisposable {
  readonly currentStage: PlatformStage;
}


// ── PI-002: Bootstrap Context Contracts ─────────────────────────────────

/** System runtime metadata contract describing operating environment & process details. */
export interface IRuntimeMetadata {
  readonly os: string;
  readonly nodeVersion: string;
  readonly arch: string;
  readonly processId: number;
  readonly memoryUsage: { readonly heapUsed: number; readonly heapTotal: number; readonly rss: number };
  readonly buildVersion: Version;
}

/** Deployment environment context contract. */
export interface IEnvironmentContext {
  readonly type: EnvironmentType;
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isPluginSandbox: boolean;
}

/** Feature flags contract for querying runtime feature toggles. */
export interface IFeatureFlags {
  isEnabled(flagName: string): boolean;
  getFlag<T = unknown>(flagName: string, defaultValue?: T): T;
  getAllFlags(): Readonly<Record<string, unknown>>;
}

/** Platform diagnostics contract for system metrics and status checks. */
export interface IPlatformDiagnostics {
  getMetrics(): Readonly<Record<string, number>>;
  getSystemStatus(): { readonly isHealthy: boolean; readonly activeServicesCount: number; readonly uptimeSeconds: number };
}

/** Service Locator interface contract. */
export interface IServiceLocator {
  hasService(serviceId: ServiceId): boolean;
  getService<T>(serviceId: ServiceId): T;
}

/** Capability Catalog interface contract. */
export interface ICapabilityCatalog {
  hasCapability(capabilityId: CapabilityId): boolean;
  getCapability<T = unknown>(capabilityId: CapabilityId): T;
}

/** Extension Catalog interface contract. */
export interface IExtensionCatalog {
  hasExtension(extensionId: ExtensionId): boolean;
  getExtension<T = unknown>(extensionId: ExtensionId): T;
}

/** Event Dispatcher interface contract. */
export interface IEventDispatcher {
  dispatch(eventType: string, payload: unknown): Promise<unknown>;
}

/** Options supplied during platform startup. */
export interface PlatformStartupOptions {
  readonly timeoutMs?: number;
  readonly skipPluginDiscovery?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/** Shutdown cancellation token interface. */
export interface IShutdownToken {
  readonly isRequested: boolean;
  onShutdown(callback: () => void | Promise<void>): void;
}

/** Abstract Logger interface contract. */
export interface IPlatformLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * PlatformContext Interface
 * Central context interface describing platform identity, versioning, mode,
 * configuration, feature flags, runtime metadata, diagnostics, locators, and tokens.
 */
export interface IPlatformContext {
  readonly platformId: PlatformId;
  readonly version: Version;
  readonly namespace: Namespace;
  readonly mode: PlatformMode;
  readonly environment: IEnvironmentContext;
  readonly config: PlatformBootstrapConfig;
  readonly featureFlags: IFeatureFlags;
  readonly runtimeMetadata: IRuntimeMetadata;
  readonly bootstrapState: BootstrapState;
  readonly logger: IPlatformLogger;
  readonly diagnostics: IPlatformDiagnostics;
  readonly serviceLocator: IServiceLocator;
  readonly capabilityCatalog: ICapabilityCatalog;
  readonly extensionCatalog: IExtensionCatalog;
  readonly eventDispatcher: IEventDispatcher;
  readonly shutdownToken: IShutdownToken;
  /** 当前平台启动阶段（供 bootstrap 管线与上下文读取） */
  readonly currentStage?: PlatformStage;
}

/** Startup Cancellation Token contract. */
export interface IStartupToken {
  readonly token: string;
  readonly isCancelled: boolean;
  cancel(reason?: string): void;
}

/**
 * BootstrapContext Interface
 * Extended context interface specific to the platform startup execution pipeline.
 */
export interface IBootstrapContext {
  readonly startupTimestamp: number;
  readonly startupOptions: PlatformStartupOptions;
  readonly startupStage: PlatformStage;
  readonly startupToken: IStartupToken;
  readonly isCancelled: boolean;
  readonly platformContext: IPlatformContext;

  // Legacy helper methods preserved for backward compatibility
  readonly config: PlatformBootstrapConfig;
  readonly state: BootstrapState;
  readonly currentStage: PlatformStage;
  readonly startTime: number;
  getMetadata(key: string): unknown;
  setStage(stage: PlatformStage): void;
}

export interface IBootstrapStage {
  readonly id: string;
  readonly name: PlatformStage | string;
  readonly description: string;
  readonly timeoutMs?: number;
  execute(context: IBootstrapContext): Promise<void>;
  rollback?(context: IBootstrapContext): Promise<void>;
}

export interface IBootstrapPipeline {
  readonly stages: ReadonlyArray<IBootstrapStage>;
  run(context: IBootstrapContext): Promise<void>;
}


// ── ⑤ PlatformBuilder Interface ───────────────────────────────────────────

/**
 * PlatformBuilder Interface describing standard fluent APIs for assembling
 * configuration, loggers, environments, services, capabilities, and extensions.
 */
export interface IPlatformBuilder {
  withConfiguration(config: Partial<PlatformBootstrapConfig>): IPlatformBuilder;
  withLogger(logger: IPlatformLogger): IPlatformBuilder;
  withEnvironment(env: EnvironmentType): IPlatformBuilder;
  addService<T>(serviceId: ServiceId, instance: T): IPlatformBuilder;
  addCapability(capabilityId: CapabilityId, descriptor: unknown): IPlatformBuilder;
  addExtension(extensionId: ExtensionId, extensionSpec: unknown): IPlatformBuilder;
  build(): Promise<IPlatformLifecycle>;
  start(): Promise<IPlatformLifecycle>;
  shutdown(): Promise<void>;
}
