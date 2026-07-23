/**
 * OpenLearn Platform Service Registry Engine
 * Core registry supporting register, resolve, exists, replace, and dispose.
 */

import { ServiceDescriptor } from './types/index.js';
import { ServiceLifecycleManager } from './lifecycle/service-lifecycle-manager.js';
import { ServiceEventBus } from './event/service-event-bus.js';

export class PlatformServiceRegistry {
  private descriptors = new Map<string, ServiceDescriptor>();
  private instances = new Map<string, unknown>();
  private lifecycleManager: ServiceLifecycleManager;
  private eventBus: ServiceEventBus;

  constructor(lifecycleManager: ServiceLifecycleManager, eventBus: ServiceEventBus) {
    this.lifecycleManager = lifecycleManager;
    this.eventBus = eventBus;
  }

  public register<T>(descriptor: ServiceDescriptor<T>, instance?: T): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`Service Registration Collision: Service '${descriptor.id}' is already registered.`);
    }

    this.descriptors.set(descriptor.id, descriptor as ServiceDescriptor);
    if (instance !== undefined) {
      this.instances.set(descriptor.id, instance);
    }

    this.lifecycleManager.setLifecycleState(descriptor.id, 'Registered');
    this.eventBus.publish('ServiceRegistered', { serviceId: descriptor.id, namespace: descriptor.namespace });

    // Transition to Ready
    this.lifecycleManager.setLifecycleState(descriptor.id, 'Ready');
    this.eventBus.publish('ServiceReady', { serviceId: descriptor.id });
  }

  public resolve<T = unknown>(serviceId: string): T {
    const desc = this.descriptors.get(serviceId);
    if (!desc) {
      throw new Error(`Service Not Found in Platform Service Registry: '${serviceId}'`);
    }

    if (this.instances.has(serviceId)) {
      return this.instances.get(serviceId) as T;
    }

    // Lazy instantiation if implementation provided
    if (desc.implementation) {
      const instance = new desc.implementation();
      this.instances.set(serviceId, instance);
      return instance as T;
    }

    throw new Error(`Service '${serviceId}' has no active instance or implementation constructor.`);
  }

  public exists(serviceId: string): boolean {
    return this.descriptors.has(serviceId);
  }

  public replace<T>(serviceId: string, newInstance: T): void {
    if (!this.descriptors.has(serviceId)) {
      throw new Error(`Cannot replace unregistered service: '${serviceId}'`);
    }
    this.instances.set(serviceId, newInstance);
  }

  public dispose(serviceId: string): void {
    if (this.descriptors.has(serviceId)) {
      this.lifecycleManager.setLifecycleState(serviceId, 'Stopped');
      this.eventBus.publish('ServiceStopped', { serviceId });

      this.instances.delete(serviceId);
      this.descriptors.delete(serviceId);

      this.lifecycleManager.setLifecycleState(serviceId, 'Disposed');
      this.eventBus.publish('ServiceDisposed', { serviceId });
    }
  }

  public listDescriptors(): ReadonlyArray<ServiceDescriptor> {
    return Object.freeze(Array.from(this.descriptors.values()));
  }

  public clear(): void {
    const ids = Array.from(this.descriptors.keys());
    for (const id of ids) {
      this.dispose(id);
    }
  }
}
