/**
 * PlatformConfiguration — unified platform configuration facade (PI-011).
 *
 * Wraps the {@link ConfigurationRegistry} and adds:
 *  - convenient source registration (memory / environment / JSON / YAML),
 *  - seeding of kernel defaults from `DEFAULT_BOOTSTRAP_CONFIG`,
 *  - integration with the PlatformBuilder, BootstrapPipeline, CompositionRoot,
 *    ServiceRegistry, DependencyInjection container, CapabilityRuntime, and
 *    EventBus — all via structural seams, so no business module is modified.
 *
 * It manages ONLY platform/kernel/infrastructure configuration.
 */

import {
  DEFAULT_BOOTSTRAP_CONFIG,
  type IPlatformLogger,
} from '../bootstrap/types/index.js';
import { DefaultPlatformLogger } from '../bootstrap/builder/platform-builder.js';
import { ConfigurationRegistry } from './ConfigurationRegistry.js';
import { ConfigurationContext } from './ConfigurationContext.js';
import type {
  BootstrapPipelineIntegrationSource,
  BuilderIntegrationSource,
  CapabilityRuntimeIntegrationSource,
  CompositionRootIntegrationSource,
  ConfigurationDescriptorInit,
  ConfigurationLoadResult,
  ConfigurationProviderInit,
  ConfigurationScope,
  ConfigurationSourceInit,
  ConfigurationValidationReport,
  ContainerIntegrationSource,
  EventBusIntegrationSource,
  ServiceRegistryIntegrationSource,
} from './types.js';

export interface PlatformConfigurationOptions {
  readonly logger?: IPlatformLogger;
  readonly serviceRegistry?: ServiceRegistryIntegrationSource;
  readonly container?: ContainerIntegrationSource;
  readonly eventBus?: EventBusIntegrationSource;
  readonly builder?: BuilderIntegrationSource;
  readonly bootstrapPipeline?: BootstrapPipelineIntegrationSource;
  readonly compositionRoot?: CompositionRootIntegrationSource;
  readonly capabilityRuntime?: CapabilityRuntimeIntegrationSource;
  /** Seed kernel defaults from `DEFAULT_BOOTSTRAP_CONFIG` (default true). */
  readonly seedDefaults?: boolean;
}

const CONFIG_SERVICE_ID = 'kernel.configuration';

export class PlatformConfiguration {
  private readonly registry: ConfigurationRegistry;
  private readonly logger: IPlatformLogger;
  private readonly serviceRegistry?: ServiceRegistryIntegrationSource;
  private readonly container?: ContainerIntegrationSource;
  private eventBus?: EventBusIntegrationSource;
  private builder?: BuilderIntegrationSource;
  private bootstrapPipeline?: BootstrapPipelineIntegrationSource;
  private compositionRoot?: CompositionRootIntegrationSource;
  private capabilityRuntime?: CapabilityRuntimeIntegrationSource;

  private selfRegistered = false;

  public constructor(options?: PlatformConfigurationOptions) {
    this.logger = options?.logger ?? new DefaultPlatformLogger();
    this.serviceRegistry = options?.serviceRegistry;
    this.container = options?.container;
    this.eventBus = options?.eventBus;
    this.builder = options?.builder;
    this.bootstrapPipeline = options?.bootstrapPipeline;
    this.compositionRoot = options?.compositionRoot;
    this.capabilityRuntime = options?.capabilityRuntime;
    this.registry = new ConfigurationRegistry(this.logger);

    if (options?.seedDefaults !== false) {
      this.registry.registerProvider({
        id: 'kernel-defaults',
        scope: 'Kernel',
        priority: -100,
        source: { kind: 'memory', values: { ...DEFAULT_BOOTSTRAP_CONFIG } },
      });
    }

    if (this.builder?.getConfiguration) {
      this.registry.registerProvider({
        id: 'builder-config',
        scope: 'Platform',
        priority: 50,
        source: { kind: 'memory', values: this.builder.getConfiguration() },
      });
    }

    console.log('[PlatformConfiguration] Initialized.');
  }

  // ── Provider registration ─────────────────────────────────────────────

  public registerProvider(init: ConfigurationProviderInit): this {
    this.registry.registerProvider(init);
    return this;
  }

  public registerMemory(
    values: Record<string, unknown>,
    options?: {
      id?: string;
      scope?: ConfigurationScope;
      priority?: number;
      descriptors?: ConfigurationDescriptorInit[];
    },
  ): this {
    return this.registerProvider({
      id: options?.id ?? `memory-${Object.keys(values).join(',') || 'anon'}`,
      scope: options?.scope ?? 'Platform',
      priority: options?.priority ?? 0,
      source: { kind: 'memory', values },
      descriptors: options?.descriptors,
    });
  }

  public registerEnvironment(
    options?: {
      id?: string;
      scope?: ConfigurationScope;
      priority?: number;
      prefix?: string;
      env?: Record<string, string | undefined>;
      map?: (key: string, value: string) => [string, unknown] | null;
      descriptors?: ConfigurationDescriptorInit[];
    },
  ): this {
    const source: ConfigurationSourceInit = {
      kind: 'environment',
      id: options?.id,
      prefix: options?.prefix,
      env: options?.env,
      map: options?.map,
    };
    return this.registerProvider({
      id: options?.id ?? 'environment',
      scope: options?.scope ?? 'Infrastructure',
      priority: options?.priority ?? 10,
      source,
      descriptors: options?.descriptors,
    });
  }

  public registerJsonFile(
    path: string,
    options?: {
      id?: string;
      scope?: ConfigurationScope;
      priority?: number;
      descriptors?: ConfigurationDescriptorInit[];
    },
  ): this {
    return this.registerProvider({
      id: options?.id ?? `json:${path}`,
      scope: options?.scope ?? 'Platform',
      priority: options?.priority ?? 0,
      source: { kind: 'json', path },
      descriptors: options?.descriptors,
    });
  }

  public registerYamlFile(
    path: string,
    options?: {
      id?: string;
      scope?: ConfigurationScope;
      priority?: number;
      descriptors?: ConfigurationDescriptorInit[];
    },
  ): this {
    return this.registerProvider({
      id: options?.id ?? `yaml:${path}`,
      scope: options?.scope ?? 'Platform',
      priority: options?.priority ?? 0,
      source: { kind: 'yaml', path },
      descriptors: options?.descriptors,
    });
  }

  public removeProvider(id: string): boolean {
    return this.registry.removeProvider(id);
  }

  // ── Load / reload ─────────────────────────────────────────────────────

  public async load(context?: ConfigurationContext): Promise<ConfigurationLoadResult> {
    const result = await this.registry.load(context);
    this.integrateAfterLoad(result.config);
    return result;
  }

  public reload(context?: ConfigurationContext): Promise<ConfigurationLoadResult> {
    return this.load(context);
  }

  // ── Read access (delegated) ───────────────────────────────────────────

  public get<T = unknown>(path: string, scope?: ConfigurationScope): T {
    return this.registry.get<T>(path, scope);
  }

  public tryGet<T = unknown>(path: string, fallback?: T, scope?: ConfigurationScope): T | undefined {
    return this.registry.tryGet<T>(path, fallback, scope);
  }

  public exists(path: string, scope?: ConfigurationScope): boolean {
    return this.registry.exists(path, scope);
  }

  public list(): ReadonlyArray<string> {
    return this.registry.list();
  }

  public snapshot() {
    return this.registry.snapshot();
  }

  public getValidationReport(): ConfigurationValidationReport {
    return this.registry.getValidationReport();
  }

  // ── Integration seams (mutable; can be attached post-construction) ──────

  public attachBuilder(source: BuilderIntegrationSource): void {
    this.builder = source;
    if (source.getConfiguration && !this.registry.hasProvider('builder-config')) {
      this.registry.registerProvider({
        id: 'builder-config',
        scope: 'Platform',
        priority: 50,
        source: { kind: 'memory', values: source.getConfiguration() },
      });
    }
  }
  public attachBootstrapPipeline(source: BootstrapPipelineIntegrationSource): void {
    this.bootstrapPipeline = source;
  }
  public attachCompositionRoot(source: CompositionRootIntegrationSource): void {
    this.compositionRoot = source;
  }
  public attachCapabilityRuntime(source: CapabilityRuntimeIntegrationSource): void {
    this.capabilityRuntime = source;
  }
  public attachEventBus(source: EventBusIntegrationSource): void {
    this.eventBus = source;
  }

  public isBuilderAware(): boolean {
    return !!this.builder;
  }
  public isBootstrapPipelineAware(): boolean {
    return !!this.bootstrapPipeline;
  }
  public isCompositionRootAware(): boolean {
    return !!this.compositionRoot;
  }
  public isCapabilityRuntimeAware(): boolean {
    return !!this.capabilityRuntime;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private integrateAfterLoad(config: Record<string, unknown>): void {
    if (!this.selfRegistered) {
      if (this.serviceRegistry && !this.serviceRegistry.exists(CONFIG_SERVICE_ID)) {
        this.serviceRegistry.register({ id: CONFIG_SERVICE_ID, instance: this, lifetime: 'Singleton' });
      }
      if (this.container) {
        this.container.registerInstance(CONFIG_SERVICE_ID, this);
      }
      this.selfRegistered = true;
    }

    if (this.eventBus?.publishConfigurationLoaded) {
      void this.eventBus.publishConfigurationLoaded(config);
    }
    if (this.builder?.onConfigurationLoaded) {
      this.builder.onConfigurationLoaded(config);
    }
    if (this.compositionRoot?.registerModule) {
      this.compositionRoot.registerModule(this);
    }
  }
}
