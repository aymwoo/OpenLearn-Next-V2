/**
 * OpenLearn Quick Insert - Registry & Provider Manager (Sprint P2-07)
 */

import {
  QuickInsertItemDescriptor,
  QuickInsertCategory,
  QuickInsertProvider,
  QuickInsertRegistryFacade,
} from './quick-insert-types.js';

export class QuickInsertRegistry implements QuickInsertRegistryFacade {
  private items = new Map<string, QuickInsertItemDescriptor>();
  private providers = new Map<string, QuickInsertProvider>();
  private recents: string[] = [];
  private favorites = new Set<string>();

  public registerItem(item: QuickInsertItemDescriptor): void {
    if (!item || !item.id) {
      throw new Error('QuickInsertRegistry Error: QuickInsertItemDescriptor must have a valid ID.');
    }
    this.items.set(item.id, item);
  }

  public registerProvider(provider: QuickInsertProvider): void {
    if (!provider || !provider.id) {
      throw new Error('QuickInsertRegistry Error: QuickInsertProvider must have a valid ID.');
    }
    this.providers.set(provider.id, provider);
    const providedItems = provider.getItems();
    for (const item of providedItems) {
      this.registerItem(item);
    }
  }

  public unregisterItem(itemId: string): boolean {
    this.recents = this.recents.filter((id) => id !== itemId);
    this.favorites.delete(itemId);
    return this.items.delete(itemId);
  }

  public getItem(itemId: string): QuickInsertItemDescriptor | undefined {
    return this.items.get(itemId);
  }

  public search(query: string = '', category?: QuickInsertCategory): ReadonlyArray<QuickInsertItemDescriptor> {
    const rawQuery = query.startsWith('/') ? query.slice(1) : query;
    const q = rawQuery.trim().toLowerCase();
    const all = Array.from(this.items.values());

    return Object.freeze(
      all.filter((item) => {
        if (category && item.category !== category) return false;
        if (!q) return true;

        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q) ?? false;
        const matchKeywords = item.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false;

        return matchTitle || matchDesc || matchKeywords;
      })
    );
  }

  public async executeItem(itemId: string, context?: Record<string, unknown>): Promise<void> {
    const target = this.items.get(itemId);
    if (!target) {
      throw new Error(`QuickInsertRegistry Error: Item '${itemId}' not found.`);
    }

    // Record recents (keep max 10)
    this.recents = [itemId, ...this.recents.filter((id) => id !== itemId)].slice(0, 10);

    await target.execute(context);
  }

  public getRecents(): ReadonlyArray<QuickInsertItemDescriptor> {
    const matched = this.recents
      .map((id) => this.items.get(id))
      .filter((item): item is QuickInsertItemDescriptor => item !== undefined);
    return Object.freeze(matched);
  }

  public getFavorites(): ReadonlyArray<QuickInsertItemDescriptor> {
    const matched = Array.from(this.favorites)
      .map((id) => this.items.get(id))
      .filter((item): item is QuickInsertItemDescriptor => item !== undefined);
    return Object.freeze(matched);
  }

  public toggleFavorite(itemId: string): void {
    if (this.favorites.has(itemId)) {
      this.favorites.delete(itemId);
    } else if (this.items.has(itemId)) {
      this.favorites.add(itemId);
    }
  }

  public listAll(): ReadonlyArray<QuickInsertItemDescriptor> {
    return Object.freeze(Array.from(this.items.values()));
  }

  public clear(): void {
    this.items.clear();
    this.providers.clear();
    this.recents = [];
    this.favorites.clear();
  }
}
