/**
 * OpenLearn AI Capability Layer - Capability Registry
 * Registers, resolves, and manages AI Capabilities (including custom plugin capabilities).
 */

import { IAICapability } from '../types/index.js';

export class CapabilityRegistry {
  private capabilities = new Map<string, IAICapability>();

  public registerCapability(capability: IAICapability): void {
    this.capabilities.set(capability.meta.id, capability);
  }

  public resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      throw new Error(`AI Capability not registered: ${capabilityId}`);
    }
    return cap as T;
  }

  public hasCapability(capabilityId: string): boolean {
    return this.capabilities.has(capabilityId);
  }

  public listCapabilities(): ReadonlyArray<IAICapability> {
    return Object.freeze(Array.from(this.capabilities.values()));
  }

  public clear(): void {
    this.capabilities.clear();
  }
}
