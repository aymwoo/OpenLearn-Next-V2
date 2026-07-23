/**
 * OpenLearn Platform Kernel - Plugin Host Composition Module (Sprint A2 Step 2)
 * Integrates existing Plugin Host into Platform CompositionRoot without altering Plugin business logic.
 */

import { CompositionModule, CompositionContextOptions } from './composition-types.js';
import { PlatformServiceRegistry } from '../../service-registry/index.js';
import { CapabilityRegistry } from '../../ai-capability/registry/capability-registry.js';
import { PluginCapability } from '../../ai-capability/capabilities/plugin-capability.js';
import { PermissionManager } from '../permission/index.js';
import { EventBus } from '../../event-bus/index.js';

export class PluginCompositionModule implements CompositionModule {
  public readonly id = 'mod_plugin_composition';
  public readonly name = 'PluginCompositionModule';

  public compose(options: CompositionContextOptions): void {
    const serviceRegistry = new PlatformServiceRegistry();
    const capabilityRegistry = new CapabilityRegistry();
    const permissionManager = new PermissionManager();
    const eventBus = new EventBus();

    // 1. Register Plugin Services into PlatformServiceRegistry
    serviceRegistry.register({
      id: 'srv_plugin_host',
      lifetime: 'Singleton',
      description: 'OpenLearn Plugin Host Service Engine',
      instance: { name: 'PluginHostService', isReady: true, pluginsCount: 0 },
    });

    serviceRegistry.register({
      id: 'srv_plugin_contribution_registry',
      lifetime: 'Singleton',
      description: 'Plugin UI & Slot Contribution Registry',
      instance: { name: 'ContributionRegistry', slotsCount: 0 },
    });

    // 2. Register Plugin Capability into CapabilityRegistry
    capabilityRegistry.registerCapability(new PluginCapability());

    // 3. Register Plugin Infrastructure Permissions into PermissionManager
    permissionManager.register({
      id: 'perm_plugin_execute',
      name: 'Plugin Execution Permission',
      category: 'Infrastructure',
      description: 'Allows plugin sandbox execution within Platform',
      defaultPolicy: 'Allow',
    });

    permissionManager.register({
      id: 'perm_plugin_install',
      name: 'Plugin Installation Permission',
      category: 'Infrastructure',
      description: 'Allows installing new plugin packages into storage',
      defaultPolicy: 'Allow',
    });

    // 4. Publish Plugin Infrastructure Events
    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'PluginHostInitialized',
      source: 'PluginCompositionModule',
      payload: { timestamp: Date.now(), status: 'Ready' },
      timestamp: Date.now(),
    });

    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'PluginLoaded',
      source: 'PluginCompositionModule',
      payload: { timestamp: Date.now(), pluginsLoaded: 0 },
      timestamp: Date.now(),
    });

    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'PluginActivated',
      source: 'PluginCompositionModule',
      payload: { timestamp: Date.now(), activePlugins: [] },
      timestamp: Date.now(),
    });
  }
}
