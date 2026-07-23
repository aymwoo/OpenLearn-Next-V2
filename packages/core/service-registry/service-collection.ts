/**
 * OpenLearn Platform Service Registry - ServiceCollection (PI-007)
 * Collection container for managing service descriptors.
 */

import { ServiceDescriptor } from './types/index.js';

export class ServiceCollection {
  private descriptors = new Map<string, ServiceDescriptor>();

  public add<T>(descriptor: ServiceDescriptor<T>): void {
    if (!descriptor.id) {
      throw new Error('ServiceCollection error: ServiceDescriptor must contain a valid ID.');
    }
    this.descriptors.set(descriptor.id, descriptor as ServiceDescriptor);
  }

  public remove(serviceId: string): boolean {
    return this.descriptors.delete(serviceId);
  }

  public get<T = unknown>(serviceId: string): ServiceDescriptor<T> | undefined {
    return this.descriptors.get(serviceId) as ServiceDescriptor<T> | undefined;
  }

  public has(serviceId: string): boolean {
    return this.descriptors.has(serviceId);
  }

  public list(): ReadonlyArray<ServiceDescriptor> {
    return Object.freeze(Array.from(this.descriptors.values()));
  }

  public clear(): void {
    this.descriptors.clear();
  }
}
