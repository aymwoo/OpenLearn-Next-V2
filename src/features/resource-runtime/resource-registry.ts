/**
 * OpenLearn Teaching Resource Runtime - Resource Registry (Sprint P3-01)
 * Central registry for resource providers, preview, open, toolbar, and context menu.
 */

import {
  ResourceType,
  ResourceAction,
  ResourceDescriptor,
  ResourceProvider,
} from './resource-types.js';

export class ResourceRegistry {
  private resources = new Map<string, ResourceDescriptor>();
  private providers = new Map<ResourceType, ResourceProvider>();

  public registerProvider(provider: ResourceProvider): void {
    if (!provider || !provider.id || !provider.type) {
      throw new Error('ResourceRegistry Error: ResourceProvider must have a valid ID and Type.');
    }
    this.providers.set(provider.type, provider);
  }

  public unregisterProvider(providerId: string): boolean {
    for (const [type, p] of this.providers.entries()) {
      if (p.id === providerId) {
        return this.providers.delete(type);
      }
    }
    return false;
  }

  public getProvider(type: ResourceType): ResourceProvider | undefined {
    return this.providers.get(type);
  }

  public registerResource(resource: ResourceDescriptor): void {
    if (!resource || !resource.id) {
      throw new Error('ResourceRegistry Error: ResourceDescriptor must have a valid ID.');
    }
    this.resources.set(resource.id, { ...resource });
  }

  public unregisterResource(resourceId: string): boolean {
    return this.resources.delete(resourceId);
  }

  public getResource(resourceId: string): ResourceDescriptor | undefined {
    return this.resources.get(resourceId);
  }

  public listResources(type?: ResourceType): ReadonlyArray<ResourceDescriptor> {
    const all = Array.from(this.resources.values());
    if (type) {
      return Object.freeze(all.filter((r) => r.type === type));
    }
    return Object.freeze(all);
  }

  public executeAction(resourceId: string, action: ResourceAction, params?: Record<string, unknown>): unknown {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      throw new Error(`ResourceRegistry Error: Resource '${resourceId}' not found.`);
    }

    const provider = this.providers.get(resource.type);

    switch (action) {
      case 'preview':
        return provider?.preview ? provider.preview(resource) : { previewUrl: resource.url };
      case 'open':
        return provider?.open ? provider.open(resource) : { openUrl: resource.url };
      case 'pin':
        resource.pinned = !resource.pinned;
        return { pinned: resource.pinned };
      case 'favorite':
        resource.favorited = !resource.favorited;
        return { favorited: resource.favorited };
      case 'annotate':
        return { annotate: true, resourceId, params };
      case 'share':
        return { shareUrl: resource.url ?? `resource://${resource.id}` };
      case 'fullscreen':
        return { fullscreen: true, resourceId };
      default:
        throw new Error(`ResourceRegistry Error: Unknown action '${action}'.`);
    }
  }

  public clear(): void {
    this.resources.clear();
    this.providers.clear();
  }
}
