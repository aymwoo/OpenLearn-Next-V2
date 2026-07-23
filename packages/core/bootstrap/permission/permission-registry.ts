/**
 * OpenLearn Platform Kernel - Permission Registry (PI-012)
 * Registry for infrastructure permission descriptors.
 */

import { PermissionDescriptor } from './permission-types.js';

export class PermissionRegistry {
  private descriptors = new Map<string, PermissionDescriptor>();

  public register(descriptor: PermissionDescriptor): void {
    if (!descriptor || !descriptor.id) {
      throw new Error('PermissionRegistry Error: PermissionDescriptor must have a valid ID.');
    }
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`PermissionRegistry Collision: Permission '${descriptor.id}' is already registered.`);
    }
    this.descriptors.set(descriptor.id, Object.freeze({ ...descriptor }));
  }

  public unregister(permissionId: string): boolean {
    return this.descriptors.delete(permissionId);
  }

  public get(permissionId: string): PermissionDescriptor | undefined {
    return this.descriptors.get(permissionId);
  }

  public exists(permissionId: string): boolean {
    return this.descriptors.has(permissionId);
  }

  public list(): ReadonlyArray<PermissionDescriptor> {
    return Object.freeze(Array.from(this.descriptors.values()));
  }

  public clear(): void {
    this.descriptors.clear();
  }
}
