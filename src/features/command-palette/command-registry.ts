/**
 * OpenLearn Command Palette - Command Registry (Sprint P2-05)
 * Central command registry managing search, recents, favorites, and execution.
 */

import { CommandDescriptor, CommandCategory, CommandRegistryFacade } from './command-types.js';

export class CommandRegistry implements CommandRegistryFacade {
  private commands = new Map<string, CommandDescriptor>();
  private recents: string[] = [];
  private favorites = new Set<string>();

  public register(command: CommandDescriptor): void {
    if (!command || !command.id) {
      throw new Error('CommandRegistry Error: Command descriptor must have a valid ID.');
    }
    this.commands.set(command.id, command);
  }

  public unregister(commandId: string): boolean {
    this.recents = this.recents.filter((id) => id !== commandId);
    this.favorites.delete(commandId);
    return this.commands.delete(commandId);
  }

  public getCommand(commandId: string): CommandDescriptor | undefined {
    return this.commands.get(commandId);
  }

  public search(query: string = '', category?: CommandCategory): ReadonlyArray<CommandDescriptor> {
    const q = query.trim().toLowerCase();
    const all = Array.from(this.commands.values());

    return Object.freeze(
      all.filter((cmd) => {
        if (category && cmd.category !== category) return false;
        if (!q) return true;

        const matchTitle = cmd.title.toLowerCase().includes(q);
        const matchDesc = cmd.description?.toLowerCase().includes(q) ?? false;
        const matchKeywords = cmd.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false;

        return matchTitle || matchDesc || matchKeywords;
      })
    );
  }

  public async executeCommand(commandId: string, context?: Record<string, unknown>): Promise<void> {
    const target = this.commands.get(commandId);
    if (!target) {
      throw new Error(`CommandRegistry Error: Command '${commandId}' not found.`);
    }

    // Record recents (keep max 10)
    this.recents = [commandId, ...this.recents.filter((id) => id !== commandId)].slice(0, 10);

    await target.execute(context);
  }

  public getRecents(): ReadonlyArray<CommandDescriptor> {
    const matched = this.recents
      .map((id) => this.commands.get(id))
      .filter((cmd): cmd is CommandDescriptor => cmd !== undefined);
    return Object.freeze(matched);
  }

  public getFavorites(): ReadonlyArray<CommandDescriptor> {
    const matched = Array.from(this.favorites)
      .map((id) => this.commands.get(id))
      .filter((cmd): cmd is CommandDescriptor => cmd !== undefined);
    return Object.freeze(matched);
  }

  public toggleFavorite(commandId: string): void {
    if (this.favorites.has(commandId)) {
      this.favorites.delete(commandId);
    } else if (this.commands.has(commandId)) {
      this.favorites.add(commandId);
    }
  }

  public listAll(): ReadonlyArray<CommandDescriptor> {
    return Object.freeze(Array.from(this.commands.values()));
  }

  public clear(): void {
    this.commands.clear();
    this.recents = [];
    this.favorites.clear();
  }
}
