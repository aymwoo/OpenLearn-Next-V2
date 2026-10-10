/**
 * OpenLearn Platform Service Registry - Service Inspector
 * Dev tool providing real-time inspection of active services, dependency graphs, and lifecycle states.
 */

import { ServiceDescriptor, ServiceInspectionInfo } from '../types/index.js';
import { ServiceLifecycleManager } from '../lifecycle/service-lifecycle-manager.js';

export class ServiceInspector {
  public static inspect(
    descriptors: ReadonlyArray<ServiceDescriptor>,
    lifecycleManager: ServiceLifecycleManager,
  ): ReadonlyArray<ServiceInspectionInfo> {
    const list: ServiceInspectionInfo[] = descriptors.map((desc) => ({
      id: desc.id,
      // strict: ServiceDescriptor 可选元数据缺省时用合法 fallback（仅诊断展示，不影响注册表行为）
      namespace: desc.namespace ?? '',
      serviceType: desc.serviceType ?? desc.id,
      version: desc.version ?? '0.0.0',
      scope: desc.scope ?? 'Singleton',
      lifecycleState: lifecycleManager.getLifecycleState(desc.id),
      dependencies: desc.dependencies ?? [],
    }));

    return Object.freeze(list);
  }
}
