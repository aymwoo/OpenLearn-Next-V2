/**
 * OpenLearn Platform Kernel - Unified Plugin Lifecycle Manager (EU-01)
 * Coordinates plugin lifecycle execution by wrapping existing PluginHost state machine and hooks.
 * Minimal invasive adapter; preserves 100% backward compatibility.
 */

import type { PluginHost } from './index.js';
import type { PluginState, PluginInfo } from './types.js';
import type { IntegrationHealthStatus, IntegrationDescriptor } from '../bootstrap/integration/integration-types.js';
import { PLATFORM_VERSION } from '../version.js';

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
  public readonly version = PLATFORM_VERSION;

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
    // strict: PluginHost.reloadPlugin 要求 newSourceCode 必填；缺省时沿用“无新源码即原地重载”语义此处显式守卫
    if (newCode === undefined) {
      throw new Error(`[PluginLifecycleManager] reloadPlugin "${pluginId}" requires newCode`);
    }
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
