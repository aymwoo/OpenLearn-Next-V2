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
    // Note: Fallback mock objects are provided for isolated unit-testing of PlatformCompositionRoot
    const realPluginHost = options?.infrastructureRefs?.get('pluginHost') ?? { name: 'PluginHostService', isReady: true, pluginsCount: 0 };
    const realContributionRegistry = options?.infrastructureRefs?.get('contributionRegistry') ?? { name: 'ContributionRegistry', slotsCount: 0 };
    const realRuntimeComposition = options?.infrastructureRefs?.get('runtimeComposition') ?? { name: 'PluginRuntimeComposition', isStarted: true };
    const realLifecycleManager = options?.infrastructureRefs?.get('lifecycleManager') ?? { name: 'PluginLifecycleManager', version: '2.5.0' };
    const realCapabilityGateway = options?.infrastructureRefs?.get('capabilityGateway') ?? { name: 'PluginCapabilityGateway', version: '2.5.0' };
    const realExtensionRegistry = options?.infrastructureRefs?.get('extensionRegistry') ?? { name: 'UnifiedExtensionRegistry', version: '2.5.0' };
    const realDistributionManager = options?.infrastructureRefs?.get('distributionManager') ?? { name: 'PluginDistributionManager', version: '2.5.0' };

    serviceRegistry.register({
      id: 'srv_plugin_host',
      lifetime: 'Singleton',
      description: 'OpenLearn Plugin Host Service Engine',
      instance: realPluginHost,
    });

    serviceRegistry.register({
      id: 'srv_plugin_contribution_registry',
      lifetime: 'Singleton',
      description: 'Plugin UI & Slot Contribution Registry',
      instance: realContributionRegistry,
    });

    serviceRegistry.register({
      id: 'srv_plugin_runtime_composition',
      lifetime: 'Singleton',
      description: 'OpenLearn Plugin Runtime Composition Facade',
      instance: realRuntimeComposition,
    });

    serviceRegistry.register({
      id: 'srv_plugin_lifecycle_manager',
      lifetime: 'Singleton',
      description: 'OpenLearn Unified Plugin Lifecycle Manager',
      instance: realLifecycleManager,
    });

    serviceRegistry.register({
      id: 'srv_plugin_capability_gateway',
      lifetime: 'Singleton',
      description: 'OpenLearn Unified Plugin Capability Gateway',
      instance: realCapabilityGateway,
    });

    serviceRegistry.register({
      id: 'srv_unified_extension_registry',
      lifetime: 'Singleton',
      description: 'OpenLearn Unified Extension Registry Foundation',
      instance: realExtensionRegistry,
    });

    serviceRegistry.register({
      id: 'srv_plugin_distribution_manager',
      lifetime: 'Singleton',
      description: 'OpenLearn Plugin Distribution Manager Foundation',
      instance: realDistributionManager,
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
