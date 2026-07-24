import { describe, it, expect, vi } from 'vitest';
import { PluginRuntimeComposition } from '../plugin-runtime-composition.js';
import type { PluginHost } from '../index.js';
import type { WorkerManager } from '../../worker-runtime/worker-manager.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('PluginRuntimeComposition (EU-01)', () => {
  const createMocks = () => {
    const mockHost = {
      listPlugins: vi.fn().mockReturnValue([
        { id: 'p1', state: 'active', manifest: { name: 'P1', version: '1.0' } },
      ]),
      setWorkerManager: vi.fn(),
    } as unknown as PluginHost;

    const mockWorkerManager = {
      shutdownAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkerManager;

    return { mockHost, mockWorkerManager };
  };

  it('should start cleanly and wire WorkerManager into PluginHost', async () => {
    const { mockHost, mockWorkerManager } = createMocks();
    const composition = new PluginRuntimeComposition(mockHost, mockWorkerManager);

    expect(composition.isStarted).toBe(false);
    await composition.start();
    expect(composition.isStarted).toBe(true);

    expect(mockHost.setWorkerManager).toHaveBeenCalledWith(mockWorkerManager);

    const health = composition.health();
    expect(health.isHealthy).toBe(true);
    expect(health.details?.isStarted).toBe(true);
    expect(health.details?.activePluginsCount).toBe(1);
    expect(health.details?.hasWorkerManager).toBe(true);
  });

  it('should stop cleanly and trigger workerManager shutdown', async () => {
    const { mockHost, mockWorkerManager } = createMocks();
    const composition = new PluginRuntimeComposition(mockHost, mockWorkerManager);

    await composition.start();
    await composition.stop();

    expect(composition.isStarted).toBe(false);
    expect(mockWorkerManager.shutdownAll).toHaveBeenCalled();
  });

  it('should register srv_plugin_runtime_composition in PluginCompositionModule', () => {
    const { mockHost, mockWorkerManager } = createMocks();
    const composition = new PluginRuntimeComposition(mockHost, mockWorkerManager);
    const module = new PluginCompositionModule();

    const refs = new Map<string, unknown>();
    refs.set('runtimeComposition', composition);

    expect(() => {
      module.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });
});
