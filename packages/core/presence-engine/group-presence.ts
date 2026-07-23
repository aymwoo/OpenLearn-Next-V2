/**
 * OpenLearn Presence Engine - Group Presence Subsystem
 * Aggregates group-level presence states, task progress, and discussion activity.
 */

import { GroupPresenceData } from './types.js';
import { PresenceStore } from './presence-store.js';

export class GroupPresenceManager {
  private groups = new Map<string, GroupPresenceData>();
  private store: PresenceStore;

  constructor(store: PresenceStore) {
    this.store = store;
  }

  /**
   * Register or update a group presence entity.
   */
  public registerGroup(group: GroupPresenceData): void {
    this.groups.set(group.groupId, Object.freeze(group));
  }

  /**
   * Update task progress for a group.
   */
  public updateGroupProgress(groupId: string, taskProgress: number): void {
    const existing = this.groups.get(groupId);
    if (!existing) return;

    const isCompleted = taskProgress >= 100;
    this.groups.set(
      groupId,
      Object.freeze({
        ...existing,
        taskProgress: Math.min(100, Math.max(0, taskProgress)),
        isCompleted,
      })
    );
  }

  /**
   * Recalculate online & active member counts for a group from PresenceStore.
   */
  public refreshGroupCounts(groupId: string): GroupPresenceData | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;

    let onlineCount = 0;
    let activeCount = 0;

    for (const memberId of group.members) {
      const presence = this.store.getPresence(memberId);
      if (presence && presence.connectionState === 'connected') {
        onlineCount += 1;
        if (presence.focus === 'Focused' || presence.status !== 'Idle') {
          activeCount += 1;
        }
      }
    }

    const updated = Object.freeze({
      ...group,
      onlineCount,
      activeCount,
    });

    this.groups.set(groupId, updated);
    return updated;
  }

  /**
   * Get presence data for a group.
   */
  public getGroupPresence(groupId: string): GroupPresenceData | undefined {
    return this.groups.get(groupId);
  }

  /**
   * List all group presences.
   */
  public listGroupPresences(): ReadonlyArray<GroupPresenceData> {
    return Object.freeze(Array.from(this.groups.values()));
  }
}
