import { describe, it, expect, vi } from 'vitest';
import {
  PlatformIntegration,
  IAIRuntimeAdapter,
  IPluginHostAdapter,
  ILessonEngineAdapter,
  IntegrationContext,
} from '../bootstrap/integration/index.js';

describe('PI-007 Platform Integration Layer Test Suite', () => {
  const mockContext: IntegrationContext = {
    platformId: 'plt_test_123',
    environment: 'development',
  };

  class MockAIAdapter implements IAIRuntimeAdapter {
    public readonly id = 'adapter_ai';
    public readonly name = 'AI Runtime Adapter';
    public readonly version = '1.0.0';

    async initialize(): Promise<void> {}
    async activate(): Promise<void> {}
    async deactivate(): Promise<void> {}
    async dispose(): Promise<void> {}
    async health() { return { isHealthy: true }; }
    metadata() { return { id: this.id, name: this.name, version: this.version, description: 'Mock AI Adapter' }; }
    async generateText(prompt: string): Promise<string> { return `Mock text for: ${prompt}`; }
  }

  class MockPluginAdapter implements IPluginHostAdapter {
    public readonly id = 'adapter_plugin';
    public readonly name = 'Plugin Host Adapter';
    public readonly version = '1.0.0';

    async initialize(): Promise<void> {}
    async activate(): Promise<void> {}
    async deactivate(): Promise<void> {}
    async dispose(): Promise<void> {}
    async health() { return { isHealthy: true }; }
    metadata() { return { id: this.id, name: this.name, version: this.version, description: 'Mock Plugin Adapter' }; }
    async getActivePlugins() { return []; }
  }

  it('should register and retrieve domain integration adapters', () => {
    const integration = new PlatformIntegration();
    const aiAdapter = new MockAIAdapter();

    integration.register(aiAdapter);
    expect(integration.has('adapter_ai')).toBe(true);
    expect(integration.get('adapter_ai')).toBe(aiAdapter);
    expect(integration.list().length).toBe(1);
  });

  it('should throw collision error on duplicate adapter registration', () => {
    const integration = new PlatformIntegration();
    const aiAdapter = new MockAIAdapter();

    integration.register(aiAdapter);
    expect(() => integration.register(aiAdapter)).toThrow('Integration Adapter Collision');
  });

  it('should dispatch lifecycle methods across all registered adapters', async () => {
    const integration = new PlatformIntegration();
    const aiAdapter = new MockAIAdapter();
    const pluginAdapter = new MockPluginAdapter();

    const aiInitSpy = vi.spyOn(aiAdapter, 'initialize');
    const pluginActivateSpy = vi.spyOn(pluginAdapter, 'activate');

    integration.register(aiAdapter);
    integration.register(pluginAdapter);

    const initResults = await integration.initializeAll(mockContext);
    expect(initResults.length).toBe(2);
    expect(initResults.every((r) => r.status === 'Success')).toBe(true);
    expect(aiInitSpy).toHaveBeenCalledTimes(1);

    await integration.activateAll();
    expect(pluginActivateSpy).toHaveBeenCalledTimes(1);

    await integration.disposeAll();
    expect(integration.has('adapter_ai')).toBe(false);
  });
});
