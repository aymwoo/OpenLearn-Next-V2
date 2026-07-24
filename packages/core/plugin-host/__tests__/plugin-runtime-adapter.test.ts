import { describe, it, expect, vi } from 'vitest';
import { PluginRuntimeAdapter } from '../plugin-runtime-adapter.js';
import type { PluginHost } from '../index.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('PluginRuntimeAdapter & Unified Plugin Runtime', () => {
  const createMockPluginHost = () => {
    const plugins = [
      {
        id: 'plugin-quiz',
        state: 'active',
        manifest: { name: 'Quiz Plugin', version: '1.0.0' },
      },
      {
        id: 'plugin-vote',
        state: 'installed',
        manifest: { name: 'Vote Plugin', version: '1.0.0' },
      },
    ];

    return {
      listPlugins: vi.fn().mockReturnValue(plugins),
      getPluginState: vi.fn((id: string) => plugins.find((p) => p.id === id)?.state),
      activatePlugin: vi.fn().mockResolvedValue(undefined),
      deactivatePlugin: vi.fn().mockResolvedValue(undefined),
      reloadPlugin: vi.fn().mockResolvedValue(undefined),
    } as unknown as PluginHost;
  };

  it('should initialize and report health correctly', async () => {
    const mockHost = createMockPluginHost();
    const adapter = new PluginRuntimeAdapter(mockHost);

    expect(adapter.isInitialized).toBe(false);
    await adapter.initialize();
    expect(adapter.isInitialized).toBe(true);

    const health = adapter.health();
    expect(health.isHealthy).toBe(true);
    expect(health.details?.activePluginsCount).toBe(1);
  });

  it('should return active plugins through getActivePlugins', async () => {
    const mockHost = createMockPluginHost();
    const adapter = new PluginRuntimeAdapter(mockHost);

    const active = await adapter.getActivePlugins();
    expect(active.length).toBe(1);
    expect(active[0]).toEqual({
      id: 'plugin-quiz',
      name: 'Quiz Plugin',
      version: '1.0.0',
      state: 'active',
    });
  });

  it('should delegate lifecycle methods to underlying PluginHost', async () => {
    const mockHost = createMockPluginHost();
    const adapter = new PluginRuntimeAdapter(mockHost);

    await adapter.activatePlugin('plugin-vote');
    expect(mockHost.activatePlugin).toHaveBeenCalledWith('plugin-vote');

    await adapter.deactivatePlugin('plugin-quiz');
    expect(mockHost.deactivatePlugin).toHaveBeenCalledWith('plugin-quiz');

    await adapter.reloadPlugin('plugin-quiz', 'new code');
    expect(mockHost.reloadPlugin).toHaveBeenCalledWith('plugin-quiz', 'new code');
  });

  it('should wire real singletons into PluginCompositionModule via infrastructureRefs', () => {
    const mockHost = createMockPluginHost();
    const adapter = new PluginRuntimeAdapter(mockHost);
    const compositionModule = new PluginCompositionModule();

    const refs = new Map<string, unknown>();
    refs.set('pluginHost', adapter);
    refs.set('contributionRegistry', { slotsCount: 5 });

    expect(() => {
      compositionModule.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });
});
