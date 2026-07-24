import { describe, it, expect, vi } from 'vitest';
import { PluginLifecycleManager } from '../plugin-lifecycle-manager.js';
import type { PluginHost } from '../index.js';
import { PluginState } from '../types.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('PluginLifecycleManager (P7-B3 EU-01)', () => {
  const createMockPluginHost = () => {
    const plugins = [
      { id: 'plugin-quiz', state: PluginState.ACTIVE, manifest: { name: 'Quiz', version: '1.0' } },
      { id: 'plugin-vote', state: PluginState.INSTALLED, manifest: { name: 'Vote', version: '1.0' } },
    ];

    return {
      listPlugins: vi.fn().mockReturnValue(plugins),
      getPluginState: vi.fn((id: string) => plugins.find((p) => p.id === id)?.state),
      activatePlugin: vi.fn().mockResolvedValue(undefined),
      deactivatePlugin: vi.fn().mockResolvedValue(undefined),
      reloadPlugin: vi.fn().mockResolvedValue(undefined),
      uninstallPlugin: vi.fn().mockResolvedValue(undefined),
    } as unknown as PluginHost;
  };

  it('should query plugin state and report health correctly', () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginLifecycleManager(mockHost);

    expect(manager.getPluginState('plugin-quiz')).toBe(PluginState.ACTIVE);
    expect(manager.listPlugins().length).toBe(2);

    const health = manager.health();
    expect(health.isHealthy).toBe(true);
    expect(health.details?.totalPlugins).toBe(2);
    expect(health.details?.activePlugins).toBe(1);
  });

  it('should delegate activate, deactivate, reload, and uninstall calls to PluginHost', async () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginLifecycleManager(mockHost);

    await manager.activatePlugin('plugin-vote');
    expect(mockHost.activatePlugin).toHaveBeenCalledWith('plugin-vote');

    await manager.deactivatePlugin('plugin-quiz');
    expect(mockHost.deactivatePlugin).toHaveBeenCalledWith('plugin-quiz');

    await manager.reloadPlugin('plugin-quiz', 'new code');
    expect(mockHost.reloadPlugin).toHaveBeenCalledWith('plugin-quiz', 'new code');

    await manager.uninstallPlugin('plugin-vote');
    expect(mockHost.uninstallPlugin).toHaveBeenCalledWith('plugin-vote');
  });

  it('should register srv_plugin_lifecycle_manager in PluginCompositionModule', () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginLifecycleManager(mockHost);
    const module = new PluginCompositionModule();

    const refs = new Map<string, unknown>();
    refs.set('lifecycleManager', manager);

    expect(() => {
      module.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });
});
