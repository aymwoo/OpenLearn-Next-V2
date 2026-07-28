/**
 * ConfigurationRegistry — provider store & load orchestration engine (PI-011).
 *
 * Owns registered {@link ConfigurationProvider}s and the current merged config,
 * snapshot, and validation report. Implements the registry API surface:
 * `registerProvider` / `removeProvider` / `load` / `reload` / `get` /
 * `tryGet` / `exists` / `list` / `snapshot`.
 */

import { type IPlatformLogger } from '../bootstrap/types/index.js';
import { DefaultPlatformLogger } from '../bootstrap/builder/platform-builder.js';
import { ConfigurationError } from './ConfigurationError.js';
import { ConfigurationProvider } from './ConfigurationProvider.js';
import { ConfigurationLoader } from './ConfigurationLoader.js';
import { ConfigurationValidator } from './ConfigurationValidator.js';
import { ConfigurationSnapshot } from './ConfigurationSnapshot.js';
import { ConfigurationContext } from './ConfigurationContext.js';
import { ConfigurationDescriptor } from './ConfigurationDescriptor.js';
import type {
  ConfigurationLoadResult,
  ConfigurationProviderInit,
  ConfigurationScope,
  ConfigurationValidationReport,
} from './types.js';
import { getByPath } from './utils.js';

export class ConfigurationRegistry {
  private readonly providers = new Map<string, ConfigurationProvider>();
  private readonly loader: ConfigurationLoader;
  private readonly validator: ConfigurationValidator;
  private readonly logger: IPlatformLogger;

  private currentConfig: Record<string, unknown> = {};
  private currentSnapshot: ConfigurationSnapshot = new ConfigurationSnapshot({});
  private lastReport: ConfigurationValidationReport = { isValid: true, errors: [], warnings: [] };

  public constructor(logger?: IPlatformLogger) {
    this.logger = logger ?? new DefaultPlatformLogger();
    this.loader = new ConfigurationLoader(this.logger);
    this.validator = new ConfigurationValidator();
  }

  // ── Provider management ───────────────────────────────────────────────

  public registerProvider(init: ConfigurationProviderInit): ConfigurationProvider {
    if (this.providers.has(init.id)) {
      throw new ConfigurationError(
        `Configuration provider '${init.id}' is already registered.`,
        'PROVIDER_EXISTS',
        init.id,
      );
    }
    const provider = new ConfigurationProvider(init);
    this.providers.set(init.id, provider);
    this.logger.info(`[PlatformConfiguration] Registered provider '${init.id}' (scope=${init.scope}).`);
    return provider;
  }

  public removeProvider(id: string): boolean {
    const removed = this.providers.delete(id);
    if (removed) this.logger.info(`[PlatformConfiguration] Removed provider '${id}'.`);
    return removed;
  }

  public hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  public getProviders(): ReadonlyArray<ConfigurationProvider> {
    return Object.freeze([...this.providers.values()]);
  }

  public getAllDescriptors(): ReadonlyArray<ConfigurationDescriptor> {
    const descriptors: ConfigurationDescriptor[] = [];
    for (const provider of this.providers.values()) {
      descriptors.push(...provider.descriptors);
    }
    return Object.freeze(descriptors);
  }

  // ── Load / reload ─────────────────────────────────────────────────────

  public async load(context?: ConfigurationContext): Promise<ConfigurationLoadResult> {
    const ctx = context ?? new ConfigurationContext();
    const config = await this.loader.load([...this.providers.values()], ctx);
    const report = this.validator.validate(config, this.getAllDescriptors());
    this.currentConfig = config;
    this.currentSnapshot = new ConfigurationSnapshot(config, { timestamp: ctx.timestamp });
    this.lastReport = report;
    this.logger.info(
      `[PlatformConfiguration] Load complete: valid=${report.isValid}, errors=${report.errors.length}.`,
    );
    return { config, report, snapshot: this.currentSnapshot };
  }

  public reload(context?: ConfigurationContext): Promise<ConfigurationLoadResult> {
    return this.load(context);
  }

  // ── Read access ───────────────────────────────────────────────────────

  public get<T = unknown>(path: string, scope?: ConfigurationScope): T {
    if (scope) {
      const descriptor = this.findDescriptor(path);
      // Scope mismatch yields `undefined` (not a thrown error) so scoped reads
      // can be used as predicates; only a truly absent path throws.
      if (descriptor && descriptor.scope !== scope) {
        return undefined as unknown as T;
      }
    }
    const value = getByPath(this.currentConfig, path);
    if (value === undefined) {
      throw new ConfigurationError(
        `Configuration path '${path}' was not found.`,
        'NOT_FOUND',
        path,
        scope,
      );
    }
    return value as T;
  }

  public tryGet<T = unknown>(path: string, fallback?: T, scope?: ConfigurationScope): T | undefined {
    if (scope) {
      const descriptor = this.findDescriptor(path);
      if (descriptor && descriptor.scope !== scope) return fallback;
    }
    const value = getByPath(this.currentConfig, path);
    return value === undefined ? fallback : (value as T);
  }

  public exists(path: string, scope?: ConfigurationScope): boolean {
    if (scope) {
      const descriptor = this.findDescriptor(path);
      if (descriptor && descriptor.scope !== scope) return false;
    }
    return getByPath(this.currentConfig, path) !== undefined;
  }

  /** Top-level section keys of the current configuration. */
  public list(): ReadonlyArray<string> {
    return Object.freeze(Object.keys(this.currentConfig));
  }

  public snapshot(): ConfigurationSnapshot {
    return this.currentSnapshot;
  }

  public getValidationReport(): ConfigurationValidationReport {
    return this.lastReport;
  }

  public validateCurrent(): ConfigurationValidationReport {
    this.lastReport = this.validator.validate(this.currentConfig, this.getAllDescriptors());
    return this.lastReport;
  }

  private findDescriptor(path: string): ConfigurationDescriptor | undefined {
    return this.getAllDescriptors().find((d) => d.path === path);
  }
}
