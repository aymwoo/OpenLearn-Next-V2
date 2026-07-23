import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ServiceRegistryKernel,
  ServiceDescriptor,
  DependencyResolver,
  IAIServiceContract,
} from '../service-registry/index.js';

describe('OpenLearn Platform Service Registry Test Suite', () => {
  let kernel: ServiceRegistryKernel;

  beforeEach(() => {
    kernel = new ServiceRegistryKernel();
  });

  class MockAIService implements IAIServiceContract {
    async generateText(prompt: string): Promise<string> {
      return `AI Response to: ${prompt}`;
    }
  }

  const aiDesc: ServiceDescriptor<IAIServiceContract> = {
    id: 'srv_ai',
    namespace: 'service.ai',
    serviceType: 'IAIServiceContract',
    version: '1.0.0',
    implementation: MockAIService,
    scope: 'Singleton',
    singleton: true,
    dependencies: [],
    metadata: {},
  };

  describe('1. Registry Core Operations (register, resolve, exists, replace, dispose)', () => {
    it('should register and resolve service contracts', async () => {
      kernel.registry.register(aiDesc);

      expect(kernel.registry.exists('srv_ai')).toBe(true);

      const resolved = kernel.registry.resolve<IAIServiceContract>('srv_ai');
      const text = await resolved.generateText('test prompt');
      expect(text).toBe('AI Response to: test prompt');
    });

    it('should replace active service instance and dispose cleanly', async () => {

      kernel.registry.register(aiDesc);

      const replacement: IAIServiceContract = {
        generateText: async () => 'Replaced AI Response',
      };

      kernel.registry.replace('srv_ai', replacement);
      const res = kernel.registry.resolve<IAIServiceContract>('srv_ai');
      await expect(res.generateText('hello')).resolves.toBe('Replaced AI Response');

      kernel.registry.dispose('srv_ai');

      expect(kernel.registry.exists('srv_ai')).toBe(false);
    });
  });

  describe('2. Dependency Resolver & Cycle Detection', () => {
    it('should resolve dependency graph in topological order and detect cycles', () => {
      const descA: ServiceDescriptor = { ...aiDesc, id: 'srv_a', dependencies: ['srv_b'] };
      const descB: ServiceDescriptor = { ...aiDesc, id: 'srv_b', dependencies: [] };

      const ordered = DependencyResolver.resolveOrder([descA, descB]);
      expect(ordered[0].id).toBe('srv_b');
      expect(ordered[1].id).toBe('srv_a');

      const cycleA: ServiceDescriptor = { ...aiDesc, id: 'cycle_a', dependencies: ['cycle_b'] };
      const cycleB: ServiceDescriptor = { ...aiDesc, id: 'cycle_b', dependencies: ['cycle_a'] };

      expect(() => DependencyResolver.resolveOrder([cycleA, cycleB])).toThrow('Circular Service Dependency Detected');
    });
  });

  describe('3. Service Inspector & Telemetry Events', () => {
    it('should inspect active services and publish lifecycle events', () => {
      const eventSpy = vi.fn();
      kernel.eventBus.subscribe('ServiceReady', eventSpy);

      kernel.registry.register(aiDesc);

      expect(eventSpy).toHaveBeenCalled();

      const inspectList = kernel.inspect();
      expect(inspectList.length).toBe(1);
      expect(inspectList[0].id).toBe('srv_ai');
      expect(inspectList[0].lifecycleState).toBe('Ready');
    });
  });
});
