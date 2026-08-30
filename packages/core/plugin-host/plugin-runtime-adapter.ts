/**
 * OpenLearn Platform Kernel - Unified Plugin Runtime Adapter
 * Integrates existing PluginHost into the platform's IPluginHostAdapter and IPluginRuntime interfaces.
 */

import type { PluginHost } from './index.js';
import type { IPluginHostAdapter } from '../bootstrap/integration/domain-adapters.js';
import type {
  IntegrationContext,
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

export interface IPluginRuntime extends IPluginHostAdapter {
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

export class PluginRuntimeAdapter implements IPluginRuntime {
  public readonly id = 'srv_plugin_runtime';
  public readonly name = 'PluginRuntimeAdapter';
  public readonly version = '0.2.5';

  private _initialized = false;
  private _context?: IntegrationContext;

  constructor(public readonly pluginHost: PluginHost) {}

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public async initialize(context?: IntegrationContext): Promise<void> {
    this._context = context;
    this._initialized = true;
  }

  public async activate(): Promise<void> {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  public async deactivate(): Promise<void> {
    // No-op or deactivate plugins
  }

  public async dispose(): Promise<void> {
    this._initialized = false;
  }

  public health(): IntegrationHealthStatus {
    const activePluginsCount = this.pluginHost
      ? this.pluginHost.listPlugins().filter((p) => p.state === 'active').length
      : 0;

    return {
      isHealthy: true,
      details: {
        initialized: this._initialized,
        activePluginsCount,
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Unified Plugin Runtime Adapter for OpenLearn V2',
    };
  }

  public async getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>> {
    const plugins = this.pluginHost.listPlugins();
    return plugins
      .filter((p) => p.state === 'active')
      .map((p: any) => ({
        id: p.id,
        name: p.name ?? p.manifest?.name,
        version: p.version ?? p.manifest?.version,
        state: p.state,
      }));
  }

  public listPlugins(): ReadonlyArray<unknown> {
    return this.pluginHost.listPlugins();
  }

  public getPluginState(pluginId: string): string | undefined {
    return this.pluginHost.getPluginState(pluginId);
  }

  public async activatePlugin(pluginId: string): Promise<void> {
    await this.pluginHost.activatePlugin(pluginId);
  }

  public async deactivatePlugin(pluginId: string): Promise<void> {
    await this.pluginHost.deactivatePlugin(pluginId);
  }

  public async reloadPlugin(pluginId: string, newCode?: string): Promise<void> {
    await this.pluginHost.reloadPlugin(pluginId, newCode);
  }
}
