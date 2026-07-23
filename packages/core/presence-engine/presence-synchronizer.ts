/**
 * OpenLearn Presence Engine - Presence Synchronizer Subsystem
 * Generates incremental diffs for high-efficiency network sync (1000+ presence entities).
 */

import { PresenceEntity, PresenceDiff } from './types.js';
import { PresenceStore } from './presence-store.js';

export class PresenceSynchronizer {
  private store: PresenceStore;

  constructor(store: PresenceStore) {
    this.store = store;
  }

  /**
   * Apply an incremental diff to update the target presence entity.
   */
  public applyDiff(diff: PresenceDiff): PresenceEntity | null {
    const updated = this.store.updatePresence(diff.entityId, diff.changes);
    if (updated) {
      return this.store.getPresence(diff.entityId) || null;
    }
    return null;
  }

  /**
   * Calculate incremental diff between two entity versions.
   */
  public computeDiff(prev: PresenceEntity, curr: PresenceEntity): PresenceDiff | null {
    const changes: Record<string, unknown> = {};
    let hasChange = false;

    if (prev.status !== curr.status) {
      changes.status = curr.status;
      hasChange = true;
    }
    if (prev.activity !== curr.activity) {
      changes.activity = curr.activity;
      hasChange = true;
    }
    if (prev.focus !== curr.focus) {
      changes.focus = curr.focus;
      hasChange = true;
    }
    if (prev.connectionState !== curr.connectionState) {
      changes.connectionState = curr.connectionState;
      hasChange = true;
    }
    if (prev.interactionSignal !== curr.interactionSignal) {
      changes.interactionSignal = curr.interactionSignal;
      hasChange = true;
    }

    if (!hasChange) return null;

    return {
      entityId: curr.id,
      changes: changes as Partial<PresenceEntity>,
      timestamp: Date.now(),
    };
  }
}
