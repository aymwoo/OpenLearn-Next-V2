import { describe, it, expect, vi } from 'vitest';
import {
  PlatformCompositionRoot,
  WhiteboardCompositionModule,
} from '../bootstrap/composition/index.js';
import { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';
import { WhiteboardCapability } from '../ai-capability/capabilities/whiteboard-capability.js';
import { EventBus } from '../event-bus/index.js';

describe('Sprint A3 Step 2 Whiteboard Platform Integration Test Suite', () => {
  it('should compose Whiteboard Runtime via WhiteboardCompositionModule in PlatformCompositionRoot', () => {
    const root = PlatformCompositionRoot.create();
    const whiteboardModule = new WhiteboardCompositionModule();

    root.registerModule(whiteboardModule);
    const result = root.compose({ environment: 'development' });

    expect(root.state).toBe('Composed');
    expect(result.validation.isValid).toBe(true);
  });

  it('should verify registration of Whiteboard Capability in CapabilityRegistry', () => {
    const registry = new CapabilityRegistry();
    const whiteboardCap = new WhiteboardCapability();
    registry.registerCapability(whiteboardCap);

    expect(registry.hasCapability('capability_whiteboard')).toBe(true);
    expect(registry.resolveCapability('capability_whiteboard')?.meta.name).toBe('Whiteboard AI Capability');
  });


  it('should publish Whiteboard infrastructure events through EventBus', () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.subscribe('WhiteboardInitialized', listener);
    bus.publish({
      id: 'evt_wb_init_1',
      type: 'WhiteboardInitialized',
      source: 'WhiteboardPlatformIntegrationTest',
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
