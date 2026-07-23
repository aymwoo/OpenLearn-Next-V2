/**
 * OpenLearn Master Service Registry Kernel
 * Master orchestrator unifying Platform Registry, Lifecycle Manager, Event Bus, Inspector, and Dependency Resolver.
 */

import { PlatformServiceRegistry } from './platform-service-registry.js';
import { ServiceLifecycleManager } from './lifecycle/service-lifecycle-manager.js';
import { ServiceEventBus } from './event/service-event-bus.js';
import { ServiceInspector } from './inspector/service-inspector.js';
import { DependencyResolver } from './resolver/dependency-resolver.js';
import { ServiceInspectionInfo } from './types/index.js';

export class ServiceRegistryKernel {
  public readonly registry: PlatformServiceRegistry;
  public readonly lifecycleManager: ServiceLifecycleManager;
  public readonly eventBus: ServiceEventBus;

  constructor() {
    this.lifecycleManager = new ServiceLifecycleManager();
    this.eventBus = new ServiceEventBus();
    this.registry = new PlatformServiceRegistry(this.lifecycleManager, this.eventBus);
  }

  public inspect(): ReadonlyArray<ServiceInspectionInfo> {
    return ServiceInspector.inspect(this.registry.listDescriptors(), this.lifecycleManager);
  }

  public resolveDependencies(): void {
    DependencyResolver.resolveOrder(this.registry.listDescriptors());
  }

  public dispose(): void {
    this.registry.clear();
    this.lifecycleManager.clear();
    this.eventBus.clear();
  }
}
