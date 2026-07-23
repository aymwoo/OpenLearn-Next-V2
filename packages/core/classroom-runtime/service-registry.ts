/**
 * OpenLearn Classroom Runtime - Service Registry Subsystem
 * Centralized service container for all classroom core services.
 */

import { IRuntimeService, RuntimeContextData } from './types.js';

export class RuntimeServiceRegistry {
  private services = new Map<string, IRuntimeService>();

  /**
   * Register a service instance into the central container.
   */
  public registerService<T extends IRuntimeService>(service: T): void {
    if (!service.serviceId) {
      throw new Error('[RuntimeServiceRegistry] Service must provide a non-empty serviceId.');
    }
    this.services.set(service.serviceId, service);
  }

  /**
   * Unregister a service by its ID.
   */
  public async unregisterService(serviceId: string): Promise<boolean> {
    const service = this.services.get(serviceId);
    if (service) {
      await service.dispose();
      return this.services.delete(serviceId);
    }
    return false;
  }

  /**
   * Retrieve a typed service instance.
   */
  public getService<T extends IRuntimeService>(serviceId: string): T | undefined {
    return this.services.get(serviceId) as T | undefined;
  }

  /**
   * List all registered service IDs.
   */
  public listServices(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.services.keys()));
  }

  /**
   * Initialize all registered services.
   */
  public async initializeAll(context: RuntimeContextData): Promise<void> {
    for (const service of this.services.values()) {
      await service.initialize(context);
    }
  }

  /**
   * Dispose all registered services.
   */
  public async disposeAll(): Promise<void> {
    for (const service of this.services.values()) {
      try {
        await service.dispose();
      } catch (err: unknown) {
        console.error(`[RuntimeServiceRegistry] Error disposing service ${service.serviceId}:`, err);
      }
    }
    this.services.clear();
  }
}
