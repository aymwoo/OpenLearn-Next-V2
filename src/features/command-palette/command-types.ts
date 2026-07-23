/**
 * OpenLearn Command Palette - Data Types & Contracts (Sprint P2-05)
 */

export type CommandCategory =
  | 'Lesson'
  | 'Whiteboard'
  | 'Plugin'
  | 'AI'
  | 'Workspace'
  | 'Analytics'
  | 'Resource';

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: CommandCategory;
  readonly keywords?: ReadonlyArray<string>;
  readonly permissions?: ReadonlyArray<string>;
  readonly shortcut?: string;
  readonly execute: (context?: Record<string, unknown>) => void | Promise<void>;
}

export interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly registry?: CommandRegistryFacade;
}

export interface CommandRegistryFacade {
  register: (command: CommandDescriptor) => void;
  unregister: (commandId: string) => boolean;
  search: (query: string, category?: CommandCategory) => ReadonlyArray<CommandDescriptor>;
  executeCommand: (commandId: string, context?: Record<string, unknown>) => Promise<void>;
  getRecents: () => ReadonlyArray<CommandDescriptor>;
  getFavorites: () => ReadonlyArray<CommandDescriptor>;
  toggleFavorite: (commandId: string) => void;
}
