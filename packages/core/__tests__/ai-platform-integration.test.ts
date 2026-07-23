import { describe, it, expect, vi } from 'vitest';
import {
  PlatformCompositionRoot,
  AICompositionModule,
} from '../bootstrap/composition/index.js';
import { AIRuntimeKernel } from '../ai/index.js';
import { AICapabilityKernel } from '../ai-capability/index.js';
import { EventBus } from '../event-bus/index.js';

describe('Sprint A1 Step 2 AI Platform Integration Test Suite', () => {
  it('should compose AI Runtime via AICompositionModule in PlatformCompositionRoot', () => {
    const root = PlatformCompositionRoot.create();
    const aiModule = new AICompositionModule();

    root.registerModule(aiModule);
    const result = root.compose({ environment: 'development' });

    expect(root.state).toBe('Composed');
    expect(result.validation.isValid).toBe(true);
  });

  it('should verify registration of standard AI capabilities in AICapabilityKernel', () => {
    const runtimeKernel = new AIRuntimeKernel();
    const capabilityKernel = new AICapabilityKernel(runtimeKernel);

    expect(capabilityKernel.registry.hasCapability('capability_chat')).toBe(true);
    expect(capabilityKernel.registry.resolveCapability('capability_chat')?.meta.name).toBe('Multi-turn Chat Capability');
    expect(capabilityKernel.registry.listCapabilities().length).toBeGreaterThanOrEqual(7);
  });

  it('should publish AI infrastructure events through EventBus', () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.subscribe('AIInitialized', listener);
    bus.publish({
      id: 'evt_ai_init_1',
      type: 'AIInitialized',
      source: 'AIPlatformIntegrationTest',
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
