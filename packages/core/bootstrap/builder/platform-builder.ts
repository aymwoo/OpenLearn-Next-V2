/**
 * OpenLearn Platform Kernel - PlatformBuilder Implementation (PI-004)
 * Public entry point for assembling the Platform Kernel without auto-starting execution.
 */

import {
  BuilderState,
  PlatformBuilderOptions,
  PlatformBuilderResult,
} from './builder-types.js';
import { BuilderValidationEngine } from './builder-validation-engine.js';
import {
  IPlatformBuilder,
  IPlatformContext,
  IPlatformLogger,
  EnvironmentType,
  PlatformBootstrapConfig,
  DEFAULT_BOOTSTRAP_CONFIG,
  PLATFORM_VERSION,
  PlatformStage,
  ServiceId,
  CapabilityId,
  ExtensionId,
  ConfigurationError,
} from '../types/index.js';
import { BootstrapPipeline } from '../pipeline/bootstrap-pipeline.js';
import { IBootstrapStage } from '../pipeline/bootstrap-stage.js';

export class DefaultPlatformLogger implements IPlatformLogger {
  info(message: string, ...args: unknown[]): void {
    console.log(`[PlatformBuilder:INFO] ${message}`, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[PlatformBuilder:WARN] ${message}`, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    console.error(`[PlatformBuilder:ERROR] ${message}`, ...args);
  }
  debug(message: string, ...args: unknown[]): void {
    console.debug(`[PlatformBuilder:DEBUG] ${message}`, ...args);
  }
}

export class PlatformBuilder implements IPlatformBuilder {
  private _state: BuilderState = 'Created';
  private _config: PlatformBootstrapConfig = { ...DEFAULT_BOOTSTRAP_CONFIG };
  private _logger: IPlatformLogger = new DefaultPlatformLogger();
  private _environment: EnvironmentType = 'development';
  private _metadata: Map<string, unknown> = new Map();
  private _services: Map<string, unknown> = new Map();
  private _capabilities: Map<string, unknown> = new Map();
  private _extensions: Map<string, unknown> = new Map();
  private _pipeline: BootstrapPipeline = new BootstrapPipeline();

  private constructor(options?: PlatformBuilderOptions) {
    this._state = 'Created';
    this._logger.info('Builder Started');

    if (options) {
      if (options.config) this.withConfiguration(options.config);
      if (options.logger) this.withLogger(options.logger);
      if (options.environment) this.withEnvironment(options.environment);
      if (options.metadata) {
        for (const [k, v] of Object.entries(options.metadata)) {
          this.withMetadata(k, v);
        }
      }
    }
  }

  public static create(options?: PlatformBuilderOptions): PlatformBuilder {
    return new PlatformBuilder(options);
  }

  public get state(): BuilderState {
    return this._state;
  }

  private transitionTo(newState: BuilderState): void {
    if (this._state === 'Disposed') {
      throw new Error('PlatformBuilder has been disposed and cannot accept further transitions.');
    }
    if (this._state === 'Built' && newState !== 'Disposed') {
      throw new Error(`Invalid state transition from Built to ${newState}. Builder is already built.`);
    }
    this._state = newState;
  }

  public withConfiguration(config: Partial<PlatformBootstrapConfig>): this {
    this.transitionTo('Configuring');
    this._config = { ...this._config, ...config };
    if (config.environment) {
      this._environment = config.environment;
    }
    this._logger.info('Configuration Loaded');
    return this;
  }

  public withLogger(logger: IPlatformLogger): this {
    this.transitionTo('Configuring');
    this._logger = logger;
    return this;
  }

  public withEnvironment(env: EnvironmentType): this {
    this.transitionTo('Configuring');
    this._environment = env;
    this._config = { ...this._config, environment: env };
    return this;
  }

  public withMetadata(key: string, value: unknown): this {
    this.transitionTo('Configuring');
    this._metadata.set(key, value);
    return this;
  }

  public addBootstrapStage(stage: IBootstrapStage): this {
    this.transitionTo('Configuring');
    this._pipeline.addStage(stage);
    return this;
  }

  public addService<T>(serviceId: ServiceId, instance: T): this {
    this.transitionTo('Configuring');
    this._services.set(serviceId, instance);
    return this;
  }

  public addCapability(capabilityId: CapabilityId, descriptor: unknown): this {
    this.transitionTo('Configuring');
    this._capabilities.set(capabilityId, descriptor);
    return this;
  }

  public addExtension(extensionId: ExtensionId, extensionSpec: unknown): this {
    this.transitionTo('Configuring');
    this._extensions.set(extensionId, extensionSpec);
    return this;
  }

  public buildResult(): PlatformBuilderResult {
    const buildStart = Date.now();
    this.transitionTo('Validating');
    this._logger.info('Validation Started');

    const validation = BuilderValidationEngine.validate(
      this._config,
      this._environment,
      this._pipeline.stages
    );

    this._logger.info('Validation Completed');

    if (!validation.isValid) {
      this._logger.error(`Validation Failed with ${validation.errors.length} errors.`);
      throw new ConfigurationError(
        `PlatformBuilder validation failed: ${validation.errors.map((e) => e.message).join('; ')}`
      );
    }

    this.transitionTo('Building');
    this._logger.info('Build Started');

    const platformContext: IPlatformContext = {
      platformId: `plt_${globalThis.crypto.randomUUID()}`,
      version: PLATFORM_VERSION,
      namespace: 'openlearn.core',
      mode: this._config.mode,
      environment: {
        type: this._environment,
        isDevelopment: this._environment === 'development',
        isProduction: this._environment === 'production',
        isTest: this._environment === 'test',
        isPluginSandbox: false,
      },
      config: this._config,
      featureFlags: {
        isEnabled: () => true,
        getFlag: <T>(_: string, def?: T) => def as T,
        getAllFlags: () => ({}),
      },
      runtimeMetadata: {
        os: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
        processId: process.pid,
        memoryUsage: process.memoryUsage(),
        buildVersion: PLATFORM_VERSION,
      },
      bootstrapState: 'Bootstrapping',
      logger: this._logger,
      diagnostics: {
        getMetrics: () => ({ uptime: 0 }),
        getSystemStatus: () => ({ isHealthy: true, activeServicesCount: this._services.size, uptimeSeconds: 0 }),
      },
      serviceLocator: {
        hasService: (id) => this._services.has(id),
        getService: (id) => this._services.get(id) as any,
      },
      capabilityCatalog: {
        hasCapability: (id) => this._capabilities.has(id),
        getCapability: (id) => this._capabilities.get(id) as any,
      },
      extensionCatalog: {
        hasExtension: (id) => this._extensions.has(id),
        getExtension: (id) => this._extensions.get(id) as any,
      },
      eventDispatcher: {
        dispatch: async () => {},
      },
      shutdownToken: {
        isRequested: false,
        onShutdown: () => {},
      },
    };

    const buildDurationMs = Date.now() - buildStart;
    this.transitionTo('Built');
    this._logger.info(`Build Completed in ${buildDurationMs} ms`);

    const result: PlatformBuilderResult = {
      platformContext,
      pipeline: this._pipeline,
      buildDurationMs,
      validation,
      metadata: Object.fromEntries(this._metadata.entries()),
      builderVersion: PLATFORM_VERSION,
    };

    return result;
  }

  public async build(): Promise<any> {
    const res = this.buildResult();
    return {
      currentStage: PlatformStage.Created,
      context: res.platformContext,
      pipeline: res.pipeline,
      start: async () => {},
      shutdown: async () => {},
      dispose: async () => {},
    };
  }

  public async start(): Promise<any> {
    const kernel = await this.build();
    await kernel.start();
    return kernel;
  }

  public async shutdown(): Promise<void> {
    this.transitionTo('Disposed');
  }

  public dispose(): void {
    this._state = 'Disposed';
    this._services.clear();
    this._capabilities.clear();
    this._extensions.clear();
    this._metadata.clear();
  }
}
