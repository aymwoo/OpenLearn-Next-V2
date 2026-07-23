/**
 * OpenLearn Classroom Runtime - Resource Manager Subsystem
 * Unified caching, tracking, and lifecycle management for media, documents, plugins, and AI assets.
 */

import { RuntimeResource, ResourceType } from './types.js';

export class RuntimeResourceManager {
  private resources = new Map<string, RuntimeResource>();

  /**
   * Register or update a resource in the manager.
   */
  public registerResource(
    url: string,
    type: ResourceType,
    sizeBytes?: number
  ): RuntimeResource {
    const existing = Array.from(this.resources.values()).find((r) => r.url === url);
    if (existing) return existing;

    const resource: RuntimeResource = {
      id: `res_${globalThis.crypto.randomUUID()}`,
      type,
      url,
      sizeBytes,
      status: 'loaded',
      cachedAt: Date.now(),
    };

    this.resources.set(resource.id, resource);
    return resource;
  }

  /**
   * Get a registered resource by ID.
   */
  public getResource(resourceId: string): RuntimeResource | undefined {
    return this.resources.get(resourceId);
  }

  /**
   * List resources filtered by type.
   */
  public listResources(type?: ResourceType): ReadonlyArray<RuntimeResource> {
    const list = Array.from(this.resources.values());
    if (type) {
      return Object.freeze(list.filter((r) => r.type === type));
    }
    return Object.freeze(list);
  }

  /**
   * Remove a resource and release its memory/cache reference.
   */
  public removeResource(resourceId: string): boolean {
    return this.resources.delete(resourceId);
  }

  /**
   * Clear all resources.
   */
  public clear(): void {
    this.resources.clear();
  }
}
