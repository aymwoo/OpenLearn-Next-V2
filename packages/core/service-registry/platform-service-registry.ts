/**
 * OpenLearn Platform Service Registry Engine (PI-007)
 * Central infrastructure for registering, resolving, querying, and managing platform services.
 * Strictly maintains metadata & registered instances without auto-wiring DI.
 */

import {
  ServiceDescriptor,
  ServiceValidationResult,
  ServiceValidationError,
  ServiceRegistration,
} from './types/index.js';
import { ServiceLifecycleManager } from './lifecycle/service-lifecycle-manager.js';
import { ServiceEventBus } from './event/service-event-bus.js';
import { ServiceCollection } from './service-collection.js';
import { ServiceResolver } from './service-resolver.js';
import { ServiceScope } from './service-scope.js';

export class PlatformServiceRegistry {
  private collection = new ServiceCollection();
  private singletonInstances = new Map<string, unknown>();
  private registrations = new Map<string, ServiceRegistration>();
  private lifecycleManager?: ServiceLifecycleManager;
  private eventBus?: ServiceEventBus;

  constructor(lifecycleManager?: ServiceLifecycleManager, eventBus?: ServiceEventBus) {
    this.lifecycleManager = lifecycleManager;
    this.eventBus = eventBus;
  }

  public register<T>(descriptor: ServiceDescriptor<T>, instance?: T): void {
    if (!descriptor || !descriptor.id) {
      this.logError('Resolution Failed', 'Service descriptor must contain a valid ID.');
      throw new Error('Service Registration Error: Invalid service identifier.');
    }

    if (this.collection.has(descriptor.id)) {
      this.logError('Service Registration Failed', `Service '${descriptor.id}' collision.`);
      throw new Error(`Service Registration Collision: Service '${descriptor.id}' is already registered.`);
    }

    const desc: ServiceDescriptor<T> = {
      ...descriptor,
      instance: instance !== undefined ? instance : descriptor.instance,
    };

    this.collection.add(desc);
    if (desc.instance !== undefined) {
      this.singletonInstances.set(desc.id, desc.instance);
    }

    this.registrations.set(desc.id, {
      descriptor: desc,
      registeredAt: Date.now(),
    });

    if (this.lifecycleManager) {
      this.lifecycleManager.setLifecycleState(desc.id, 'Registered');
      this.lifecycleManager.setLifecycleState(desc.id, 'Ready');
    }
    if (this.eventBus) {
      this.eventBus.publish('ServiceRegistered', { serviceId: desc.id, namespace: desc.namespace });
      this.eventBus.publish('ServiceReady', { serviceId: desc.id });
    }

    this.logInfo(`Service Registered: '${desc.id}' [${desc.lifetime || 'Singleton'}]`);
  }

  public unregister(serviceId: string): boolean {
    if (!this.collection.has(serviceId)) {
      return false;
    }
    this.singletonInstances.delete(serviceId);
    this.registrations.delete(serviceId);
    this.collection.remove(serviceId);

    if (this.lifecycleManager) {
      this.lifecycleManager.setLifecycleState(serviceId, 'Disposed');
    }
    if (this.eventBus) {
      this.eventBus.publish('ServiceRemoved', { serviceId });
    }

    this.logInfo(`Service Removed: '${serviceId}'`);
    return true;
  }

  public replace<T>(serviceId: string, newInstance: T): void {
    const existing = this.collection.get<T>(serviceId);
    if (!existing) {
      this.logError('Resolution Failed', `Cannot replace unregistered service '${serviceId}'`);
      throw new Error(`Cannot replace unregistered service: '${serviceId}'`);
    }

    const updated: ServiceDescriptor<T> = {
      ...existing,
      instance: newInstance,
    };

    this.collection.add(updated);
    this.singletonInstances.set(serviceId, newInstance);

    if (this.eventBus) {
      this.eventBus.publish('ServiceReplaced', { serviceId });
    }

    this.logInfo(`Service Replaced: '${serviceId}'`);
  }

  public has(serviceId: string): boolean {
    return this.collection.has(serviceId);
  }

  public resolve<T = unknown>(serviceId: string, scope?: ServiceScope): T {
    const desc = this.collection.get<T>(serviceId);
    if (!desc) {
      this.logError('Resolution Failed', `Service '${serviceId}' not found.`);
      throw new Error(`Service Not Found in Platform Service Registry: '${serviceId}'`);
    }

    try {
      const instance = ServiceResolver.resolve<T>(desc, this.singletonInstances, scope);
      this.logInfo(`Service Resolved: '${serviceId}'`);
      return instance;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError('Resolution Failed', `Failed to resolve '${serviceId}': ${msg}`);
      throw err;
    }
  }

  public tryResolve<T = unknown>(serviceId: string, scope?: ServiceScope): T | undefined {
    try {
      return this.resolve<T>(serviceId, scope);
    } catch {
      return undefined;
    }
  }

  public resolveAll(): ReadonlyArray<unknown> {
    const results: unknown[] = [];
    for (const desc of this.collection.list()) {
      const instance = this.tryResolve(desc.id);
      if (instance !== undefined) {
        results.push(instance);
      }
    }
    return Object.freeze(results);
  }

  public exists(serviceId: string): boolean {
    return this.collection.has(serviceId);
  }

  public list(): ReadonlyArray<ServiceDescriptor> {
    return this.collection.list();
  }

  public validate(): ServiceValidationResult {
    const errors: ServiceValidationError[] = [];
    const warnings: string[] = [];

    for (const desc of this.collection.list()) {
      if (!desc.id || desc.id.trim() === '') {
        errors.push({
          code: 'INVALID_SERVICE_ID',
          message: 'Service identifier cannot be empty.',
        });
      }
      if (desc.instance === undefined && !desc.factory && !desc.implementation) {
        errors.push({
          code: 'MISSING_IMPLEMENTATION',
          message: `Service '${desc.id}' has no instance, factory, or implementation class.`,
          serviceId: desc.id,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }

  public clear(): void {
    for (const desc of this.collection.list()) {
      this.unregister(desc.id);
    }
    this.collection.clear();
    this.singletonInstances.clear();
    this.registrations.clear();
  }

  public dispose(serviceId: string): void {
    this.unregister(serviceId);
  }

  public listDescriptors(): ReadonlyArray<ServiceDescriptor> {
    return this.list();
  }

  private logInfo(message: string): void {
    console.log(`[PlatformServiceRegistry] ${message}`);
  }

  private logError(action: string, error: string): void {
    console.error(`[PlatformServiceRegistry] ${action}: ${error}`);
  }
}
