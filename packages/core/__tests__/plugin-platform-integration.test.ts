import { describe, it, expect, vi } from 'vitest';
import {
  PlatformCompositionRoot,
  PluginCompositionModule,
} from '../bootstrap/composition/index.js';
import { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';
import { PluginCapability } from '../ai-capability/capabilities/plugin-capability.js';
import { PermissionManager } from '../bootstrap/permission/index.js';
import { EventBus } from '../event-bus/index.js';

describe('Sprint A2 Step 2 Plugin Platform Integration Test Suite', () => {
  it('should compose Plugin Host via PluginCompositionModule in PlatformCompositionRoot', () => {
    const root = PlatformCompositionRoot.create();
    const pluginModule = new PluginCompositionModule();

    root.registerModule(pluginModule);
    const result = root.compose({ environment: 'development' });

    expect(root.state).toBe('Composed');
    expect(result.validation.isValid).toBe(true);
  });

  it('should verify registration of Plugin Capability in CapabilityRegistry', () => {
    const registry = new CapabilityRegistry();
    const pluginCap = new PluginCapability();
    registry.registerCapability(pluginCap);

    expect(registry.hasCapability('capability_plugin')).toBe(true);
    expect(registry.resolveCapability('capability_plugin')?.meta.name).toBe('Plugin AI Invocation Capability');
  });


  it('should register and enforce plugin infrastructure permissions via PermissionManager', async () => {
    const permissionManager = new PermissionManager();
    permissionManager.register({
      id: 'perm_plugin_execute',
      name: 'Plugin Execution Permission',
      category: 'Infrastructure',
      defaultPolicy: 'Allow',
    });

    const checkContext = await permissionManager.check('plugin_sandbox', 'worker_thread', 'perm_plugin_execute');
    expect(checkContext.result?.allowed).toBe(true);
  });

  it('should publish Plugin infrastructure events through EventBus', () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.subscribe('PluginHostInitialized', listener);
    bus.publish({
      id: 'evt_plugin_init_1',
      type: 'PluginHostInitialized',
      source: 'PluginPlatformIntegrationTest',
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
