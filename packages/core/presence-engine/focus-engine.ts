/**
 * OpenLearn Presence Engine - Focus Engine Subsystem
 * Tracks entity focus models (Focused, Distracted, Inactive, Minimized, Background).
 * Capability-only engine respecting privacy settings.
 */

import { FocusState } from './types.js';
import { PresenceStore } from './presence-store.js';
import { PresenceEventBus } from './presence-event-bus.js';

export class FocusEngine {
  private store: PresenceStore;
  private eventBus: PresenceEventBus;

  constructor(store: PresenceStore, eventBus: PresenceEventBus) {
    this.store = store;
    this.eventBus = eventBus;
  }

  /**
   * Update focus state for an entity.
   */
  public reportFocusChange(entityId: string, focus: FocusState): void {
    const existing = this.store.getPresence(entityId);
    if (!existing) return;

    if (existing.focus !== focus) {
      this.store.updatePresence(entityId, { focus });
      this.eventBus.publish('FocusChanged', {
        entityId,
        focus,
        timestamp: Date.now(),
      });
    }
  }
}
