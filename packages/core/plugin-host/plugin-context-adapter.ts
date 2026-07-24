/**
 * OpenLearn Platform Kernel - Plugin Context Adapter (EU-02)
 * Unified Runtime Context abstraction reusing existing PluginContext & ContextBuilder.
 * Preserves 100% backward compatibility for all existing Context APIs.
 */

import type {
  PluginContext,
  IPluginLogger,
  PluginDatabaseAPI,
  ContributionAccessor,
} from './types.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type { Token } from '../di/token.js';
import type { IConfigService } from './config-service.js';

export interface IUnifiedPluginContext {
  readonly pluginId: string;
  readonly manifest: Manifest;
  readonly environment: 'development' | 'production' | 'test';

  // Core Scoped Services
  readonly services: PluginContext['services'];
  readonly log: IPluginLogger;
  readonly db: PluginDatabaseAPI;
  readonly contributions: ContributionAccessor;
  readonly config: IConfigService;

  // Methods
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  require(moduleName: string): unknown;
  getRawContext(): PluginContext;
}

export class PluginContextAdapter implements IUnifiedPluginContext {
  public readonly environment: 'development' | 'production' | 'test';

  constructor(
    private readonly _context: PluginContext,
    env?: 'development' | 'production' | 'test',
  ) {
    this.environment = env ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  }

  public get pluginId(): string {
    return this._context.pluginId;
  }

  public get manifest(): Manifest {
    return this._context.manifest;
  }

  public get services(): PluginContext['services'] {
    return this._context.services;
  }

  public get log(): IPluginLogger {
    return this._context.log;
  }

  public get db(): PluginDatabaseAPI {
    return this._context.db;
  }

  public get contributions(): ContributionAccessor {
    return this._context.contributions;
  }

  public get config(): IConfigService {
    return this._context.config;
  }

  public resolve<T>(token: Token<T>): Promise<T> {
    return this._context.resolve(token);
  }

  public provide<T>(token: Token<T>, instance: T): Promise<void> {
    return this._context.provide(token, instance);
  }

  public require(moduleName: string): unknown {
    return this._context.require(moduleName);
  }

  public getRawContext(): PluginContext {
    return this._context;
  }
}
