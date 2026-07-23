/**
 * OpenLearn Platform Service Registry - ServiceResolver (PI-007)
 */

import { ServiceDescriptor } from './types/index.js';
import { ServiceScope } from './service-scope.js';

export class ServiceResolver {
  public static resolve<T = unknown>(
    desc: ServiceDescriptor<T>,
    singletonInstances: Map<string, unknown>,
    scope?: ServiceScope
  ): T {
    const serviceId = desc.id;

    // 1. Direct instance registered
    if (desc.instance !== undefined) {
      return desc.instance;
    }

    // 2. Singleton lifetime instance lookup
    const lifetime = desc.lifetime || (desc.singleton ? 'Singleton' : 'Transient');
    if (lifetime === 'Singleton') {
      if (singletonInstances.has(serviceId)) {
        return singletonInstances.get(serviceId) as T;
      }
    }

    // 3. Scoped lifetime lookup
    if (lifetime === 'Scoped' && scope) {
      if (scope.has(serviceId)) {
        return scope.get<T>(serviceId)!;
      }
    }

    // 4. Factory invocation
    if (desc.factory) {
      const instance = desc.factory(scope);
      if (lifetime === 'Singleton') {
        singletonInstances.set(serviceId, instance);
      } else if (lifetime === 'Scoped' && scope) {
        scope.set(serviceId, instance);
      }
      return instance;
    }

    // 5. Implementation constructor
    if (desc.implementation) {
      const instance = new desc.implementation();
      if (lifetime === 'Singleton') {
        singletonInstances.set(serviceId, instance);
      } else if (lifetime === 'Scoped' && scope) {
        scope.set(serviceId, instance);
      }
      return instance;
    }

    throw new Error(`Service '${serviceId}' has no registered instance, factory, or implementation constructor.`);
  }
}
