/**
 * OpenLearn Platform Kernel - Unified Extension Registry (P7-B5 EU-01)
 * Single management layer for all platform extension points (widgets, commands, AI actions, activities, etc.).
 * Coordinates existing extension implementations without replacing or executing them.
 */

import type {
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

export interface ExtensionItemMetadata {
  readonly id: string;
  readonly category: string;
  readonly name?: string;
  readonly version?: string;
  readonly providerId?: string;
  readonly description?: string;
  readonly impl?: unknown;
}

export interface IUnifiedExtensionRegistry {
  registerExtension(
    category: string,
    id: string,
    impl: unknown,
    meta?: Partial<ExtensionItemMetadata>,
  ): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

export class UnifiedExtensionRegistry implements IUnifiedExtensionRegistry {
  public readonly id = 'srv_unified_extension_registry';
  public readonly name = 'UnifiedExtensionRegistry';
  public readonly version = '0.2.3';

  private readonly _extensions = new Map<string, Map<string, ExtensionItemMetadata>>();

  public registerExtension(
    category: string,
    id: string,
    impl: unknown,
    meta?: Partial<ExtensionItemMetadata>,
  ): void {
    if (!category || !id) {
      throw new Error('Extension category and ID must be non-empty strings');
    }

    let categoryMap = this._extensions.get(category);
    if (!categoryMap) {
      categoryMap = new Map<string, ExtensionItemMetadata>();
      this._extensions.set(category, categoryMap);
    }

    if (categoryMap.has(id)) {
      throw new Error(
        `Duplicate extension registration for category "${category}" and ID "${id}"`,
      );
    }

    const metadata: ExtensionItemMetadata = {
      id,
      category,
      name: meta?.name ?? id,
      version: meta?.version ?? '1.0.0',
      providerId: meta?.providerId ?? 'system',
      description: meta?.description ?? '',
      impl,
    };

    categoryMap.set(id, metadata);
  }

  public hasExtension(category: string, id: string): boolean {
    const categoryMap = this._extensions.get(category);
    return Boolean(categoryMap?.has(id));
  }

  public getExtension<T = unknown>(category: string, id: string): T | undefined {
    const categoryMap = this._extensions.get(category);
    const item = categoryMap?.get(id);
    return item ? (item.impl as T) : undefined;
  }

  public listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata> {
    if (category) {
      const categoryMap = this._extensions.get(category);
      return categoryMap ? Array.from(categoryMap.values()) : [];
    }

    const result: ExtensionItemMetadata[] = [];
    for (const categoryMap of this._extensions.values()) {
      result.push(...categoryMap.values());
    }
    return result;
  }

  public listCategories(): ReadonlyArray<string> {
    return Array.from(this._extensions.keys());
  }

  public syncContributionRegistry(contributionRegistry: {
    listAll(): Array<{ slot: string; pluginId: string; configs: Array<{ id: string; name?: string; label?: string; description?: string }> }>;
  }): void {
    const entries = contributionRegistry.listAll();
    for (const entry of entries) {
      for (const item of entry.configs) {
        if (!this.hasExtension(entry.slot, item.id)) {
          this.registerExtension(entry.slot, item.id, item, {
            providerId: entry.pluginId,
            name: item.name ?? item.label ?? item.id,
            description: item.description ?? '',
          });
        }
      }
    }
  }

  public syncActivityRegistry(activityRegistry: {
    listProviders(): ReadonlyArray<{ descriptor: { id: string; name: string; provider: string; description?: string } }>;
  }): void {
    const providers = activityRegistry.listProviders();
    for (const p of providers) {
      if (!this.hasExtension('activity', p.descriptor.id)) {
        this.registerExtension('activity', p.descriptor.id, p, {
          providerId: p.descriptor.provider,
          name: p.descriptor.name,
          description: p.descriptor.description ?? '',
        });
      }
    }
  }

  public health(): IntegrationHealthStatus {
    const totalCount = this.listExtensions().length;
    const categoriesCount = this._extensions.size;

    return {
      isHealthy: true,
      details: {
        totalExtensions: totalCount,
        totalCategories: categoriesCount,
        categories: this.listCategories(),
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Unified Extension Registry for OpenLearn V2',
    };
  }
}
