/**
 * OpenLearn Platform Kernel - Plugin Runtime Composition (EU-01)
 * Coordinates existing runtime services startup, shutdown order, and facade lookup.
 * Minimal invasive facade; does not replace existing runtime implementations.
 */

import type { PluginHost } from './index.js';
import type { WorkerManager } from '../worker-runtime/worker-manager.js';
import type {
  IntegrationContext,
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

export interface IRuntimeCompositionOptions {
  readonly pluginHost: PluginHost;
  readonly workerManager?: WorkerManager;
}

export class PluginRuntimeComposition {
  public readonly id = 'srv_plugin_runtime_composition';
  public readonly name = 'PluginRuntimeComposition';
  public readonly version = '2.5.0';

  private _isStarted = false;
  private _context?: IntegrationContext;

  constructor(
    public readonly pluginHost: PluginHost,
    public readonly workerManager?: WorkerManager,
  ) {}

  public get isStarted(): boolean {
    return this._isStarted;
  }

  /**
   * Orderly startup sequence: wire worker manager if present, mark runtime composition active.
   */
  public async start(context?: IntegrationContext): Promise<void> {
    if (this._isStarted) return;
    this._context = context;

    if (this.workerManager && this.pluginHost) {
      this.pluginHost.setWorkerManager(this.workerManager);
    }

    this._isStarted = true;
  }

  /**
   * Orderly shutdown sequence: stop all worker threads and mark runtime composition inactive.
   */
  public async stop(): Promise<void> {
    if (!this._isStarted) return;

    if (this.workerManager) {
      await this.workerManager.shutdownAll();
    }

    this._isStarted = false;
  }

  public health(): IntegrationHealthStatus {
    const activePluginsCount = this.pluginHost
      ? this.pluginHost.listPlugins().filter((p) => p.state === 'active').length
      : 0;

    return {
      isHealthy: true,
      details: {
        isStarted: this._isStarted,
        activePluginsCount,
        hasWorkerManager: Boolean(this.workerManager),
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Coordinates OpenLearn V2 Plugin Runtime Services',
    };
  }
}
