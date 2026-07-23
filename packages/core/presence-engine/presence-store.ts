/**
 * OpenLearn Presence Engine - Presence Store Subsystem
 * High-performance in-memory Store indexing 1000+ presence entities with diff computing.
 */

import { PresenceEntity, PresenceDiff } from './types.js';

export class PresenceStore {
  private entities = new Map<string, PresenceEntity>();

  /**
   * Set or overwrite a presence entity.
   */
  public setPresence(entity: PresenceEntity): void {
    this.entities.set(entity.id, Object.freeze(entity));
  }

  /**
   * Update a presence entity with partial changes and calculate an incremental diff.
   */
  public updatePresence(id: string, partial: Partial<PresenceEntity>): PresenceDiff | null {
    const existing = this.entities.get(id);
    if (!existing) return null;

    const updated: PresenceEntity = Object.freeze({
      ...existing,
      ...partial,
      lastActive: partial.lastActive ?? Date.now(),
      metadata: partial.metadata ? { ...existing.metadata, ...partial.metadata } : existing.metadata,
    });

    this.entities.set(id, updated);

    return {
      entityId: id,
      changes: partial,
      timestamp: Date.now(),
    };
  }

  /**
   * Retrieve a presence entity by ID.
   */
  public getPresence(id: string): PresenceEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * Query presence entities matching a predicate function.
   */
  public queryPresence(predicate: (entity: PresenceEntity) => boolean): ReadonlyArray<PresenceEntity> {
    const results: PresenceEntity[] = [];
    for (const entity of this.entities.values()) {
      if (predicate(entity)) {
        results.push(entity);
      }
    }
    return Object.freeze(results);
  }

  /**
   * Remove a presence entity from the store.
   */
  public removePresence(id: string): boolean {
    return this.entities.delete(id);
  }

  /**
   * List all stored presence entities.
   */
  public listAll(): ReadonlyArray<PresenceEntity> {
    return Object.freeze(Array.from(this.entities.values()));
  }

  /**
   * Clear all stored presence entities.
   */
  public clear(): void {
    this.entities.clear();
  }
}
