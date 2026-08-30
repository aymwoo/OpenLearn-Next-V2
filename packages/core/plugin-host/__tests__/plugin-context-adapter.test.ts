import { describe, it, expect, vi } from 'vitest';
import { PluginContextAdapter } from '../plugin-context-adapter.js';
import type { PluginContext } from '../types.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';
import { Token } from '../../di/token.js';

describe('PluginContextAdapter (EU-02)', () => {
  const createMockContext = (): PluginContext => {
    const manifest: Manifest = {
      id: 'ext-test',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'Unit test plugin',
      main: 'index.js',
      engines: { openlearn: '^0.2.5' },
    };

    return {
      pluginId: 'ext-test',
      manifest,
      services: {
        commandBus: {} as any,
        eventBus: {} as any,
        actionRegistry: {} as any,
        capability: {} as any,
        processManager: {} as any,
        storage: {} as any,
        ai: {} as any,
      },
      resolve: vi.fn().mockResolvedValue('resolved_service'),
      provide: vi.fn().mockResolvedValue(undefined),
      db: {} as any,
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      contributions: {
        list: vi.fn().mockReturnValue([]),
      },
      config: {} as any,
      require: vi.fn().mockReturnValue({ shared: true }),
    };
  };

  it('should expose plugin metadata and properties accurately', () => {
    const mockCtx = createMockContext();
    const adapter = new PluginContextAdapter(mockCtx, 'test');

    expect(adapter.pluginId).toBe('ext-test');
    expect(adapter.manifest.name).toBe('Test Plugin');
    expect(adapter.environment).toBe('test');
    expect(adapter.getRawContext()).toBe(mockCtx);
  });

  it('should delegate resolve, provide, and require calls to underlying context', async () => {
    const mockCtx = createMockContext();
    const adapter = new PluginContextAdapter(mockCtx);

    const token = new Token<string>('@openlearn/core:ITestToken');
    const result = await adapter.resolve(token);
    expect(result).toBe('resolved_service');
    expect(mockCtx.resolve).toHaveBeenCalledWith(token);

    await adapter.provide(token, 'instance');
    expect(mockCtx.provide).toHaveBeenCalledWith(token, 'instance');

    const mod = adapter.require('lucide-react');
    expect(mod).toEqual({ shared: true });
    expect(mockCtx.require).toHaveBeenCalledWith('lucide-react');
  });
});
