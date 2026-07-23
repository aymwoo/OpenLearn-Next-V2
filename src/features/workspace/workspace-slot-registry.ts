/**
 * OpenLearn Classroom Workspace Shell - Slot Registry (Sprint P1-01)
 * Central registry for managing Workspace slot providers.
 */

import { WorkspaceSlotType, WorkspaceSlotProvider } from './workspace-types.js';

export class WorkspaceSlotRegistry {
  private providers = new Map<string, WorkspaceSlotProvider>();

  public register(provider: WorkspaceSlotProvider): void {
    if (!provider || !provider.id) {
      throw new Error('WorkspaceSlotRegistry Error: WorkspaceSlotProvider must have a valid ID.');
    }
    this.providers.set(provider.id, provider);
  }

  public unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  public getProviders(slot: WorkspaceSlotType): ReadonlyArray<WorkspaceSlotProvider> {
    const matched = Array.from(this.providers.values()).filter((p) => p.slot === slot);
    matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return Object.freeze(matched);
  }

  public listAll(): ReadonlyArray<WorkspaceSlotProvider> {
    return Object.freeze(Array.from(this.providers.values()));
  }

  public clear(): void {
    this.providers.clear();
  }
}
