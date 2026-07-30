/**
 * OpenLearn Platform Kernel - Unified Plugin Lifecycle Manager (EU-01)
 * Coordinates plugin lifecycle execution by wrapping existing PluginHost state machine and hooks.
 * Minimal invasive adapter; preserves 100% backward compatibility.
 */

import type { PluginHost } from './index.js';
import type { PluginState, PluginInfo } from './types.js';
import type {
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

export interface IPluginLifecycleManager {
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

export class PluginLifecycleManager implements IPluginLifecycleManager {
  public readonly id = 'srv_plugin_lifecycle_manager';
  public readonly name = 'PluginLifecycleManager';
  public readonly version = '0.2.3';

  constructor(public readonly pluginHost: PluginHost) {}

  public getPluginState(pluginId: string): PluginState | undefined {
    return this.pluginHost.getPluginState(pluginId);
  }

  public listPlugins(): ReadonlyArray<PluginInfo> {
    return this.pluginHost.listPlugins();
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

  public async uninstallPlugin(pluginId: string): Promise<void> {
    await this.pluginHost.uninstallPlugin(pluginId);
  }

  public health(): IntegrationHealthStatus {
    const plugins = this.pluginHost.listPlugins();
    const activePlugins = plugins.filter((p) => p.state === 'active').length;

    return {
      isHealthy: true,
      details: {
        totalPlugins: plugins.length,
        activePlugins,
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Unified Plugin Lifecycle Manager for OpenLearn V2',
    };
  }
}
