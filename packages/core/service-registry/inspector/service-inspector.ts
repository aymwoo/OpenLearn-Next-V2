/**
 * OpenLearn Platform Service Registry - Service Inspector
 * Dev tool providing real-time inspection of active services, dependency graphs, and lifecycle states.
 */

import { ServiceDescriptor, ServiceInspectionInfo } from '../types/index.js';
import { ServiceLifecycleManager } from '../lifecycle/service-lifecycle-manager.js';

export class ServiceInspector {
  public static inspect(
    descriptors: ReadonlyArray<ServiceDescriptor>,
    lifecycleManager: ServiceLifecycleManager
  ): ReadonlyArray<ServiceInspectionInfo> {
    const list: ServiceInspectionInfo[] = descriptors.map((desc) => ({
      id: desc.id,
      namespace: desc.namespace,
      serviceType: desc.serviceType,
      version: desc.version,
      scope: desc.scope,
      lifecycleState: lifecycleManager.getLifecycleState(desc.id),
      dependencies: desc.dependencies,
    }));

    return Object.freeze(list);
  }
}
