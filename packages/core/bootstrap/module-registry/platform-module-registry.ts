/**
 * OpenLearn Platform Kernel - Platform Module Registry (Sprint A1)
 * Central discovery and registration catalog for platform-level modules.
 */

import {
  PlatformModuleDescriptor,
  ModuleStatus,
  ModuleHealth,
} from './module-registry-types.js';

export class PlatformModuleRegistry {
  private _modules = new Map<string, PlatformModuleDescriptor>();

  public register(descriptor: PlatformModuleDescriptor): void {
    if (!descriptor.id) {
      throw new Error('PlatformModuleRegistry error: Module descriptor is missing an ID.');
    }
    if (this._modules.has(descriptor.id)) {
      throw new Error(`PlatformModuleRegistry collision: Module '${descriptor.id}' is already registered.`);
    }
    this._modules.set(descriptor.id, Object.freeze({ ...descriptor }));
  }

  public unregister(id: string): boolean {
    return this._modules.delete(id);
  }

  public find(id: string): PlatformModuleDescriptor | undefined {
    return this._modules.get(id);
  }

  public exists(id: string): boolean {
    return this._modules.has(id);
  }

  public list(): ReadonlyArray<PlatformModuleDescriptor> {
    return Object.freeze(Array.from(this._modules.values()));
  }

  public updateStatus(id: string, status: ModuleStatus): void {
    const existing = this._modules.get(id);
    if (!existing) {
      throw new Error(`PlatformModuleRegistry update error: Module '${id}' not found.`);
    }
    const updated: PlatformModuleDescriptor = {
      ...existing,
      status,
    };
    this._modules.set(id, Object.freeze(updated));
  }

  public updateHealth(id: string, health: ModuleHealth): void {
    const existing = this._modules.get(id);
    if (!existing) {
      throw new Error(`PlatformModuleRegistry update error: Module '${id}' not found.`);
    }
    const updated: PlatformModuleDescriptor = {
      ...existing,
      health,
    };
    this._modules.set(id, Object.freeze(updated));
  }

  public clear(): void {
    this._modules.clear();
  }
}
