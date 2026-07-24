import { describe, it, expect, vi } from 'vitest';
import { PluginCapabilityGateway } from '../plugin-capability-gateway.js';
import { CapabilityRegistry } from '../../ai-capability/registry/capability-registry.js';
import type { IAICapability } from '../../ai-capability/types/index.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.ts';

describe('PluginCapabilityGateway (P7-B4 EU-01)', () => {
  const createMockCapability = (id: string, name: string): IAICapability => ({
    meta: {
      id,
      name,
      type: 'chat',
      description: 'Test capability',
      version: '1.0.0',
    },
  });

  it('should discover and list registered capabilities', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(createMockCapability('cap_chat', 'Chat Capability'));

    const gateway = new PluginCapabilityGateway(registry);
    expect(gateway.hasCapability('cap_chat')).toBe(true);
    expect(gateway.hasCapability('cap_unknown')).toBe(false);

    const caps = gateway.listCapabilities();
    expect(caps.length).toBe(1);
    expect(caps[0].id).toBe('cap_chat');
    expect(caps[0].name).toBe('Chat Capability');
  });

  it('should resolve capability and execute methods dynamically', async () => {
    const registry = new CapabilityRegistry();
    const mockCap = {
      meta: {
        id: 'cap_exec',
        name: 'Execution Cap',
        type: 'tool',
        description: 'Test execution capability',
        version: '1.0.0',
      },
      ping: vi.fn().mockResolvedValue('pong'),
    };
    registry.registerCapability(mockCap as unknown as IAICapability);

    const gateway = new PluginCapabilityGateway(registry);
    const res = await gateway.executeCapability<string>('cap_exec', 'ping');
    expect(res).toBe('pong');
    expect(mockCap.ping).toHaveBeenCalled();
  });

  it('should report health and metadata correctly', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(createMockCapability('cap_demo', 'Demo'));

    const gateway = new PluginCapabilityGateway(registry);
    const health = gateway.health();
    expect(health.isHealthy).toBe(true);
    expect(health.details?.registeredCapabilitiesCount).toBe(1);

    const meta = gateway.metadata();
    expect(meta.id).toBe('srv_plugin_capability_gateway');
  });

  it('should register srv_plugin_capability_gateway in PluginCompositionModule', () => {
    const registry = new CapabilityRegistry();
    const gateway = new PluginCapabilityGateway(registry);
    const module = new PluginCompositionModule();

    const refs = new Map<string, unknown>();
    refs.set('capabilityGateway', gateway);

    expect(() => {
      module.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });
});
