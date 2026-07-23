/**
 * OpenLearn Platform Kernel - Platform Domain Registry (Sprint A2)
 * Central discovery and catalog for bounded business capabilities (domains).
 */

import { PlatformDomainDescriptor } from './domain-registry-types.js';

export class PlatformDomainRegistry {
  private _domains = new Map<string, PlatformDomainDescriptor>();

  public registerDomain(descriptor: PlatformDomainDescriptor): void {
    if (!descriptor.id) {
      throw new Error('PlatformDomainRegistry error: Domain descriptor is missing an ID.');
    }
    if (this._domains.has(descriptor.id)) {
      throw new Error(`PlatformDomainRegistry collision: Domain '${descriptor.id}' is already registered.`);
    }
    this._domains.set(descriptor.id, Object.freeze({ ...descriptor }));
  }

  public unregisterDomain(id: string): boolean {
    return this._domains.delete(id);
  }

  public findDomain(id: string): PlatformDomainDescriptor | undefined {
    return this._domains.get(id);
  }

  public exists(id: string): boolean {
    return this._domains.has(id);
  }

  public listDomains(): ReadonlyArray<PlatformDomainDescriptor> {
    return Object.freeze(Array.from(this._domains.values()));
  }

  public listModules(domainId: string): ReadonlyArray<string> {
    const domain = this._domains.get(domainId);
    if (!domain) {
      throw new Error(`PlatformDomainRegistry error: Domain '${domainId}' not found.`);
    }
    return Object.freeze([...domain.modules]);
  }

  public clear(): void {
    this._domains.clear();
  }
}
