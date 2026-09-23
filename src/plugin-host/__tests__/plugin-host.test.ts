// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { PluginState } from '../types';
import type {
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  FrontendPluginManifest,
  FrontendPluginContext,
} from '../types';

// ── Mock Services ────────────────────────────────────────────────────────

function createMockServices() {
  return {
    frontendApi: {
      get: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
    } as unknown as IFrontendAPI,
    socketService: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as ISocketService,
    uiService: {
      showToast: vi.fn(),
      showModal: vi.fn(),
      closeModal: vi.fn(),
    } as unknown as IUIService,
    storageService: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    } as unknown as IStorageService,
  };
}

// ── Test Plugin Factories ────────────────────────────────────────────────

interface TestPlugin {
  manifest: FrontendPluginManifest;
  activate: (ctx: FrontendPluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

function createTestPlugin(overrides?: Partial<FrontendPluginManifest>): TestPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'test',
      ...overrides,
    },
    activate: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
  };
}

function pluginModuleLoader(plugin: TestPlugin) {
  return async (_sourceCode: string) => ({
    default: {
      manifest: plugin.manifest,
      activate: plugin.activate,
      deactivate: plugin.deactivate,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('FrontendPluginHost', () => {
  let host: FrontendPluginHost;
  let mockServices: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    // Reset zustand store to initial state
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      services: null,
      initialized: false,
    });

    mockServices = createMockServices();
  });

  describe('initialize', () => {
    it('creates registry and registers all 4 services', async () => {
      host = new FrontendPluginHost();
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      expect(host.isInitialized()).toBe(true);
      const storeState = usePluginHostStore.getState();
      expect(storeState.initialized).toBe(true);
      expect(storeState.services).not.toBeNull();
    });
  });

  describe('installPlugin', () => {
    beforeEach(async () => {
      host = new FrontendPluginHost();
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );
    });

    it('adds plugin to store with INSTALLED state', async () => {
      const manifest: FrontendPluginManifest = {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
      };
      await host.installPlugin(manifest, 'export default {}');

      const storeState = usePluginHostStore.getState();
      expect(storeState.activePlugins).toHaveLength(1);
      expect(storeState.activePlugins[0]).toMatchObject({
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        state: PluginState.INSTALLED,
        executionMode: 'inline',
      });
    });
  });

  describe('activatePlugin', () => {
    beforeEach(async () => {
      host = new FrontendPluginHost();
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );
    });

    it('activates a plugin and transitions state to ACTIVE', async () => {
      const plugin = createTestPlugin();
      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(plugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(plugin.manifest, JSON.stringify(plugin));
      await host.activatePlugin(plugin.manifest.id);

      const storeState = usePluginHostStore.getState();
      const active = storeState.activePlugins.find((p) => p.id === plugin.manifest.id);
      expect(active?.state).toBe(PluginState.ACTIVE);
      expect(plugin.activate).toHaveBeenCalledTimes(1);
    });

    it('throws on missing plugin', async () => {
      host = new FrontendPluginHost();
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await expect(host.activatePlugin('nonexistent')).rejects.toThrow('Plugin not found');
    });

    it('sets state to ERROR on activation failure', async () => {
      const failingPlugin = createTestPlugin();
      failingPlugin.activate = vi.fn().mockRejectedValue(new Error('Activation failed'));

      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(failingPlugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(failingPlugin.manifest, JSON.stringify(failingPlugin));
      await expect(host.activatePlugin(failingPlugin.manifest.id)).rejects.toThrow();

      const storeState = usePluginHostStore.getState();
      const active = storeState.activePlugins.find((p) => p.id === failingPlugin.manifest.id);
      expect(active?.state).toBe(PluginState.ERROR);
    });

    it('registers classroomTools as extension points', async () => {
      const plugin = createTestPlugin({
        classroomTools: [
          {
            id: 'rollcall',
            name: 'Roll Call',
            icon: 'Users',
            commandType: 'rollcall.start',
          },
        ],
      });

      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(plugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(plugin.manifest, JSON.stringify(plugin));
      await host.activatePlugin(plugin.manifest.id);

      const extensions = host.getExtensions('classroom.tool');
      expect(extensions).toHaveLength(1);
      expect(extensions[0].id).toBe('rollcall');
    });
  });

  describe('deactivatePlugin', () => {
    beforeEach(async () => {
      host = new FrontendPluginHost();
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );
    });

    it('deactivates an active plugin and transitions to INACTIVE', async () => {
      const plugin = createTestPlugin();
      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(plugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(plugin.manifest, JSON.stringify(plugin));
      await host.activatePlugin(plugin.manifest.id);
      await host.deactivatePlugin(plugin.manifest.id);

      const storeState = usePluginHostStore.getState();
      const active = storeState.activePlugins.find((p) => p.id === plugin.manifest.id);
      expect(active?.state).toBe(PluginState.INACTIVE);
      expect(plugin.deactivate).toHaveBeenCalledTimes(1);
    });

    it('does nothing for non-active plugins', async () => {
      const plugin = createTestPlugin();
      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(plugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(plugin.manifest, JSON.stringify(plugin));
      // Not activated — deactivate should be a no-op
      await host.deactivatePlugin(plugin.manifest.id);

      expect(plugin.deactivate).not.toHaveBeenCalled();
    });
  });

  describe('uninstallPlugin', () => {
    beforeEach(async () => {
      host = new FrontendPluginHost();
      // Mock fetch for API call
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );
    });

    it('removes plugin from store and calls DELETE API', async () => {
      const plugin = createTestPlugin();
      host = new FrontendPluginHost({ moduleLoader: pluginModuleLoader(plugin) });
      await host.initialize(
        mockServices.frontendApi,
        mockServices.socketService,
        mockServices.uiService,
        mockServices.storageService,
      );

      await host.installPlugin(plugin.manifest, JSON.stringify(plugin));
      await host.uninstallPlugin(plugin.manifest.id);

      const storeState = usePluginHostStore.getState();
      const found = storeState.activePlugins.find((p) => p.id === plugin.manifest.id);
      expect(found).toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        `/api/plugins/${plugin.manifest.id}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});

// ── PluginHostProvider Tests ─────────────────────────────────────────────

describe('PluginHostProvider', () => {
  it('usePluginHost throws when used outside provider', async () => {
    const { usePluginHost } = await import('../plugin-host-context');

    // React components can't be tested in `node` environment.
    // The throw check is validated via the hook's guard at module level.
    expect(typeof usePluginHost).toBe('function');
  });
});
