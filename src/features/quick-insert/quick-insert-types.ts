/**
 * OpenLearn Quick Insert - Data Types & Contracts (Sprint P2-07)
 */

export type QuickInsertCategory =
  | 'Media'
  | 'Shape'
  | 'Tool'
  | 'AI'
  | 'Widget'
  | 'Plugin';

export interface QuickInsertItemDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: QuickInsertCategory;
  readonly keywords?: ReadonlyArray<string>;
  readonly shortcut?: string;
  readonly execute: (context?: Record<string, unknown>) => void | Promise<void>;
}

export interface QuickInsertProvider {
  readonly id: string;
  readonly getItems: () => ReadonlyArray<QuickInsertItemDescriptor>;
}

export interface QuickInsertMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly registry?: QuickInsertRegistryFacade;
  readonly initialQuery?: string;
}

export interface QuickInsertRegistryFacade {
  registerItem: (item: QuickInsertItemDescriptor) => void;
  registerProvider: (provider: QuickInsertProvider) => void;
  unregisterItem: (itemId: string) => boolean;
  search: (query: string, category?: QuickInsertCategory) => ReadonlyArray<QuickInsertItemDescriptor>;
  executeItem: (itemId: string, context?: Record<string, unknown>) => Promise<void>;
  getRecents: () => ReadonlyArray<QuickInsertItemDescriptor>;
  getFavorites: () => ReadonlyArray<QuickInsertItemDescriptor>;
  toggleFavorite: (itemId: string) => void;
}
