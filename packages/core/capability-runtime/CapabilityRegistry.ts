/**
 * CapabilityRegistry — registration & lookup for platform capabilities (PI-009).
 *
 * It is the source of truth for capability metadata within the runtime. Each
 * registration binds a {@link CapabilityDescriptor} to its
 * {@link CapabilityProvider} as a {@link PlatformCapability}. Duplicate ids are
 * rejected (use `replace` to overwrite). Capabilities may be grouped by
 * `contract` for multiple/priority resolution.
 */

import { PlatformCapability } from './PlatformCapability.js';
import { CapabilityDescriptor } from './CapabilityDescriptor.js';
import { CapabilityProvider } from './CapabilityProvider.js';
import { CapabilityError } from './CapabilityError.js';

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, PlatformCapability>();
  private readonly contractIndex = new Map<string, string[]>();

  /** Register a capability. Throws on duplicate id. */
  public register(descriptor: CapabilityDescriptor, provider: CapabilityProvider): PlatformCapability {
    if (this.capabilities.has(descriptor.id)) {
      throw new CapabilityError(
        `Capability '${descriptor.id}' is already registered.`,
        'DUPLICATE_CAPABILITY',
        descriptor.id,
      );
    }
    const capability = new PlatformCapability(descriptor, provider);
    this.capabilities.set(descriptor.id, capability);
    this.indexContract(descriptor);
    return capability;
  }

  /** Remove a capability. Returns true if something was removed. */
  public unregister(capabilityId: string): boolean {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) return false;
    if (capability.descriptor.contract) {
      const list = this.contractIndex.get(capability.descriptor.contract);
      if (list) {
        const next = list.filter((id) => id !== capabilityId);
        if (next.length) this.contractIndex.set(capability.descriptor.contract!, next);
        else this.contractIndex.delete(capability.descriptor.contract);
      }
    }
    return this.capabilities.delete(capabilityId);
  }

  /** Replace an existing capability. Throws if the id is not currently registered. */
  public replace(descriptor: CapabilityDescriptor, provider: CapabilityProvider): PlatformCapability {
    if (!this.capabilities.has(descriptor.id)) {
      throw new CapabilityError(
        `Cannot replace unregistered capability '${descriptor.id}'.`,
        'MISSING_CAPABILITY',
        descriptor.id,
      );
    }
    this.unregister(descriptor.id);
    return this.register(descriptor, provider);
  }

  public exists(capabilityId: string): boolean {
    return this.capabilities.has(capabilityId);
  }

  public find(capabilityId: string): PlatformCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  public list(): ReadonlyArray<PlatformCapability> {
    return Object.freeze([...this.capabilities.values()]);
  }

  /** All capability ids that share the given contract. */
  public listByContract(contract: string): ReadonlyArray<PlatformCapability> {
    const ids = this.contractIndex.get(contract) ?? [];
    return Object.freeze(ids.map((id) => this.capabilities.get(id)!).filter(Boolean));
  }

  public getContractIds(): ReadonlyArray<string> {
    return Object.freeze([...this.contractIndex.keys()]);
  }

  public clear(): void {
    this.capabilities.clear();
    this.contractIndex.clear();
  }

  private indexContract(descriptor: CapabilityDescriptor): void {
    if (!descriptor.contract) return;
    const list = this.contractIndex.get(descriptor.contract) ?? [];
    if (!list.includes(descriptor.id)) list.push(descriptor.id);
    this.contractIndex.set(descriptor.contract, list);
  }
}
