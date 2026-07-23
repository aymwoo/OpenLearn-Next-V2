/**
 * OpenLearn Capability Invocation Framework - Registry & Discovery
 * Supports dynamic capability registration, resolution, listing, and auto-discovery.
 */

import {
  CapabilityDescriptor,
  ICapabilityProviderHandler,
} from '../types/index.js';

export class CapabilityFrameworkRegistry {
  private handlers = new Map<string, ICapabilityProviderHandler>();

  public register(handler: ICapabilityProviderHandler): void {
    const desc = handler.descriptor;
    if (!desc || !desc.id) {
      throw new Error('Invalid CapabilityDescriptor: id is required');
    }
    this.handlers.set(desc.id, handler);
  }

  public resolve(capabilityId: string): ICapabilityProviderHandler {
    const handler = this.handlers.get(capabilityId);
    if (!handler) {
      throw new Error(`Capability not found in registry: ${capabilityId}`);
    }
    return handler;
  }

  public has(capabilityId: string): boolean {
    return this.handlers.has(capabilityId);
  }

  public list(category?: string): ReadonlyArray<CapabilityDescriptor> {
    const all = Array.from(this.handlers.values()).map((h) => h.descriptor);
    if (category) {
      return Object.freeze(all.filter((d) => d.category === category));
    }
    return Object.freeze(all);
  }

  public discover(tagFilter: string): ReadonlyArray<CapabilityDescriptor> {
    const all = Array.from(this.handlers.values()).map((h) => h.descriptor);
    return Object.freeze(all.filter((d) => d.tags.includes(tagFilter)));
  }

  public clear(): void {
    this.handlers.clear();
  }
}
