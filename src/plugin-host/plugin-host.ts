/**
 * FrontendPluginHost — browser-side plugin lifecycle manager.
 *
 * D-01: Uses zustand store for all state mutations.
 * D-03: Mirrors backend PluginHost lifecycle (initialize, installPlugin,
 *       activatePlugin, deactivatePlugin, uninstallPlugin) adapted for
 *       the browser environment.
 *
 * Lifecycle (inline mode):
 *   install → INSTALLED → activatePlugin → ACTIVATING → activate() → ACTIVE
 *   ACTIVE → deactivatePlugin → DEACTIVATING → deactivate() → INACTIVE
 *   Any ERROR state → ERROR (auto-set on activation failure)
 *
 * T-09-02: All Blob URL creation uses try/finally with URL.revokeObjectURL()
 *          to prevent memory leaks.
 */

import { FrontendServiceRegistry } from './service-registry';
import { BrowserWorkerManager } from './browser-worker-manager';
import { usePluginHostStore } from './plugin-host-store';
import {
  PluginState,
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
} from './types';
import type {
  FrontendPluginManifest,
  FrontendPluginContext,
  ExtensionSlot,
  ExtensionPointConfig,
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
} from './types';

// ── Module Loader type ───────────────────────────────────────────────────

/**
 * Function type for loading a plugin module from source code.
 *
 * Default implementation uses Blob URL + import() for browser ESM loading.
 * Tests can provide a custom loader to avoid browser-specific APIs.
 */
export type ModuleLoader = (sourceCode: string) => Promise<PluginModule>;

/**
 * Shape of a loaded plugin module (ESM default or named exports).
 */
export interface PluginModule {
  default?: {
    manifest: FrontendPluginManifest;
    activate: (ctx: FrontendPluginContext) => Promise<void>;
    deactivate?: () => Promise<void>;
  };
  manifest?: FrontendPluginManifest;
  activate?: (ctx: FrontendPluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

/** All frontend service tokens available for Worker plugin RPC. */
const FRONTEND_SERVICE_TOKENS = [
  '@openlearn/frontend:IFrontendAPI',
  '@openlearn/frontend:ISocketService',
  '@openlearn/frontend:IUIService',
  '@openlearn/frontend:IStorageService',
];

// ── FrontendPluginHost ───────────────────────────────────────────────────

export class FrontendPluginHost {
  private registry: FrontendServiceRegistry | null = null;
  private initialized = false;
  private sourceCodes = new Map<string, string>();
  private pluginModules = new Map<string, PluginModule>();
  private moduleLoader: ModuleLoader;
  /** BrowserWorkerManager for worker-mode plugin execution. */
  private workerManager: BrowserWorkerManager | null = null;

  constructor(options?: { moduleLoader?: ModuleLoader }) {
    this.moduleLoader = options?.moduleLoader ?? this.defaultModuleLoader;
  }

  /**
   * Set the BrowserWorkerManager for worker-mode plugin execution.
   * Mirrors backend PluginHost.setWorkerManager pattern.
   * Must be called before activating any worker-mode plugins.
   */
  setWorkerManager(wm: BrowserWorkerManager): void {
    this.workerManager = wm;
  }

  // ── Initialization ───────────────────────────────────────────────────

  /**
   * Initialize the FrontendPluginHost with the four frontend services.
   *
   * Creates the FrontendServiceRegistry, registers all four services
   * with their token constants, and updates the zustand store.
   */
  async initialize(
    frontendApiImpl: IFrontendAPI,
    socketServiceImpl: ISocketService,
    uiServiceImpl: IUIService,
    storageServiceImpl: IStorageService,
  ): Promise<void> {
    const registry = new FrontendServiceRegistry();
    await registry.register(FRONTEND_API_TOKEN, frontendApiImpl);
    await registry.register(SOCKET_SERVICE_TOKEN, socketServiceImpl);
    await registry.register(UI_SERVICE_TOKEN, uiServiceImpl);
    await registry.register(STORAGE_SERVICE_TOKEN, storageServiceImpl);
    this.registry = registry;
    this.initialized = true;
    usePluginHostStore.getState().initialize(registry);
  }

  /** Returns true if initialize() has been called. */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ── Plugin Lifecycle ─────────────────────────────────────────────────

  /**
   * Install a plugin into local state.
   *
   * Stores the source code internally and adds plugin info to the zustand store
   * with state = INSTALLED. The actual server-side install is done via REST API
   * in the PluginCenter component.
   */
  async installPlugin(manifest: FrontendPluginManifest, sourceCode: string): Promise<void> {
    this.sourceCodes.set(manifest.id, sourceCode);
    usePluginHostStore.getState().addPlugin({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      state: PluginState.INSTALLED,
      executionMode: 'inline',
    });
  }

  /**
   * Activate a previously installed plugin.
   *
   * Flow:
   * 1. Find plugin info in zustand store
   * 2. Validate state transition → ACTIVATING
   * 3. Load plugin module via moduleLoader (Blob URL + import() in production)
   * 4. Validate manifest and activate function
   * 5. Register classroomTools as extension points automatically
   * 6. Build FrontendPluginContext with resolved frontend services
   * 7. Call plugin.activate(ctx) with 5s timeout
   * 8. Success: set state to ACTIVE
   * 9. Error: set state to ERROR, unroll extension points
   */
  async activatePlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);
    if (!pluginInfo) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (pluginInfo.executionMode === 'worker') {
      return this.activateWorkerPlugin(pluginId, pluginInfo);
    }

    if (pluginInfo.executionMode !== 'inline') {
      throw new Error(`Unsupported execution mode for activation: ${pluginInfo.executionMode}`);
    }

    store.updatePluginState(pluginId, PluginState.ACTIVATING);

    try {
      const sourceCode = this.sourceCodes.get(pluginId);
      if (!sourceCode) {
        throw new Error(`No source code found for plugin: ${pluginId}`);
      }

      const mod = await this.moduleLoader(sourceCode);
      const plugin = mod.default ?? mod;
      const manifest: FrontendPluginManifest | undefined = plugin.manifest ?? (mod as any).manifest;
      const activate: ((ctx: FrontendPluginContext) => Promise<void>) | undefined =
        plugin.activate ?? (mod as any).activate;
      const deactivate: (() => Promise<void>) | undefined =
        plugin.deactivate ?? (mod as any).deactivate;

      if (!manifest || typeof activate !== 'function') {
        throw new Error('Invalid plugin: missing manifest or activate function');
      }

      if (manifest.id !== pluginId) {
        throw new Error(
          `Manifest id mismatch: expected "${pluginId}", got "${manifest.id}"`,
        );
      }

      // Automatically register classroomTools as extension points
      if (manifest.classroomTools) {
        for (const tool of manifest.classroomTools) {
          store.registerExtensionPoint('classroom.tool', {
            id: tool.id,
            label: tool.name,
            icon: tool.icon,
            component: () => Promise.resolve({ default: (() => null) as any }),
            pluginId,
          });
        }
      }

      const ctx = await this.buildContext(pluginId, manifest);

      // 5s activation timeout
      await Promise.race([
        activate(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Activation timeout (5000ms)')), 5000),
        ),
      ]);

      this.pluginModules.set(pluginId, {
        manifest,
        activate,
        deactivate: typeof deactivate === 'function' ? deactivate : undefined,
      });

      store.updatePluginState(pluginId, PluginState.ACTIVE);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      store.unregisterPluginExtensionPoints(pluginId);
      throw err;
    }
  }

  /**
   * Activate a plugin in worker execution mode via BrowserWorkerManager.
   *
   * Creates a Web Worker, loads the plugin inside it, and sets up
   * the ServiceProxy RPC channel.
   */
  private async activateWorkerPlugin(
    pluginId: string,
    pluginInfo: FrontendPluginInfo,
  ): Promise<void> {
    if (!this.workerManager) {
      throw new Error(
        `Cannot activate plugin "${pluginId}" in worker mode: BrowserWorkerManager not set. ` +
          'Call setWorkerManager() first.',
      );
    }

    const store = usePluginHostStore.getState();
    const sourceCode = this.sourceCodes.get(pluginId);
    if (!sourceCode) {
      throw new Error(`No source code found for plugin: ${pluginId}`);
    }

    // Build manifest from source or stored data
    const manifest: FrontendPluginManifest = {
      id: pluginId,
      name: pluginInfo.name,
      version: pluginInfo.version,
    };

    store.updatePluginState(pluginId, PluginState.ACTIVATING);

    try {
      // Resolve ISocketService for event forwarding if available
      let socketService: ISocketService | undefined;
      if (this.registry) {
        try {
          socketService = await this.registry.resolve<ISocketService>(
            '@openlearn/frontend:ISocketService',
          );
        } catch {
          // No socket service registered — event forwarding disabled
        }
      }

      const { serviceHost } = await this.workerManager.createWorker(
        pluginId,
        manifest,
        sourceCode,
        FRONTEND_SERVICE_TOKENS,
        socketService,
      );

      this.pluginModules.set(pluginId, {
        manifest,
        activate: async () => {}, // Already activated via Worker bootstrap
        deactivate: async () => {
          await this.workerManager!.terminateWorker(pluginId);
        },
      });

      store.updatePluginState(pluginId, PluginState.ACTIVE);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      store.unregisterPluginExtensionPoints(pluginId);
      throw err;
    }
  }

  /**
   * Deactivate an active plugin.
   *
   * Calls plugin.deactivate() if available (5s timeout), then cleans up
   * extension points and zustand state. Always transitions to INACTIVE
   * even on deactivation error.
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);
    if (!pluginInfo || pluginInfo.state !== PluginState.ACTIVE) return;

    store.updatePluginState(pluginId, PluginState.DEACTIVATING);

    try {
      const instance = this.pluginModules.get(pluginId);
      if (instance?.deactivate) {
        await Promise.race([
          instance.deactivate(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Deactivation timeout (5000ms)')), 5000),
          ),
        ]);
      }
    } catch (err) {
      console.error(
        `[FrontendPluginHost] Deactivation error for "${pluginId}":`,
        err,
      );
    } finally {
      store.unregisterPluginExtensionPoints(pluginId);
      this.pluginModules.delete(pluginId);
      store.updatePluginState(pluginId, PluginState.INACTIVE);
    }
  }

  /**
   * Uninstall a plugin (removes it from local state and calls server-side DELETE).
   *
   * Deactivates first if currently active, then removes from zustand store
   * and internal maps.
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);

    if (pluginInfo?.state === PluginState.ACTIVE) {
      await this.deactivatePlugin(pluginId);
    }

    try {
      await fetch(`/api/plugins/${pluginId}`, { method: 'DELETE' });
    } catch (err) {
      console.error(
        `[FrontendPluginHost] Failed to DELETE plugin "${pluginId}" on server:`,
        err,
      );
    }

    this.sourceCodes.delete(pluginId);
    this.pluginModules.delete(pluginId);
    store.removePlugin(pluginId);
  }

  // ── Extension Points ─────────────────────────────────────────────────

  /**
   * Get all registered extension point configs for a given slot.
   */
  getExtensions(slot: ExtensionSlot): ExtensionPointConfig[] {
    return usePluginHostStore.getState().getExtensions(slot);
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Default module loader: creates a Blob URL from source code and uses
   * dynamic import() to load the ESM module.
   *
   * T-09-02: try/finally with URL.revokeObjectURL() prevents Blob URL leaks.
   */
  private async defaultModuleLoader(sourceCode: string): Promise<PluginModule> {
    const blob = new Blob([sourceCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ url);
      return mod as PluginModule;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Build a FrontendPluginContext for the given plugin.
   *
   * Resolves all four frontend services from the registry and wraps
   * the extension point registration methods to update the zustand store.
   */
  private async buildContext(
    pluginId: string,
    manifest: FrontendPluginManifest,
  ): Promise<FrontendPluginContext> {
    if (!this.registry) {
      throw new Error('FrontendPluginHost not initialized');
    }

    const frontendApi = await this.registry.resolve<IFrontendAPI>(FRONTEND_API_TOKEN);
    const socketService = await this.registry.resolve<ISocketService>(SOCKET_SERVICE_TOKEN);
    const uiService = await this.registry.resolve<IUIService>(UI_SERVICE_TOKEN);
    const storageService = await this.registry.resolve<IStorageService>(STORAGE_SERVICE_TOKEN);

    return {
      services: {
        frontendApi,
        socketService,
        uiService,
        storageService,
      },
      pluginId,
      manifest,
      ui: {
        registerExtensionPoint: (slot: ExtensionSlot, config: ExtensionPointConfig) => {
          usePluginHostStore.getState().registerExtensionPoint(slot, config);
        },
        unregisterExtensionPoint: (slot: ExtensionSlot, id: string) => {
          usePluginHostStore.getState().unregisterExtensionPoint(slot, id);
        },
      },
    };
  }
}
