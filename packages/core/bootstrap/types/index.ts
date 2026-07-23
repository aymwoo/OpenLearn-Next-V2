/**
 * OpenLearn Platform Kernel - Bootstrap Types & Platform Contracts (EU-01)
 *
 * Establishes the foundational common language, lifecycle stages, error hierarchy,
 * platform constants, and abstract interfaces used across the Platform Kernel.
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

/** Semantic version string (e.g. '2.5.0'). */
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
export const PLATFORM_VERSION: Version = '2.5.0';

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


// ── ④ BootstrapContext Interface ──────────────────────────────────────────

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

/** Interface reference for Service Registry. */
export interface IServiceRegistryReference {
  hasService(serviceId: ServiceId): boolean;
  getService<T>(serviceId: ServiceId): T;
}

/** Interface reference for Event Bus. */
export interface IEventBusReference {
  publish(eventType: string, payload: unknown): Promise<unknown>;
}

/**
 * Immutable bootstrap context interface supplying configuration, logger,
 * service/event-bus references, environment, metadata, and shutdown token.
 */
export interface IBootstrapContext {
  readonly platformId: PlatformId;
  readonly config: PlatformBootstrapConfig;
  readonly logger: IPlatformLogger;
  readonly serviceRegistryRef: IServiceRegistryReference;
  readonly eventBusRef: IEventBusReference;
  readonly environment: EnvironmentType;
  readonly state: BootstrapState;
  readonly currentStage: PlatformStage;
  readonly startTime: number;
  readonly startupOptions: PlatformStartupOptions;
  readonly shutdownToken: IShutdownToken;

  getMetadata(key: string): unknown;
  setStage(stage: PlatformStage): void;
}

export interface IBootstrapStage {
  readonly name: PlatformStage;
  readonly description: string;
  execute(context: IBootstrapContext): Promise<void>;
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
