/**
 * OpenLearn Teaching Collaboration Engine - Conflict Resolver Subsystem
 * Object locking, optimistic updates, version tracking, merging, rollback, and CRDT interface reservation.
 */

import { ObjectLock } from './types.js';

export interface CrdtMergeAdapter<T = unknown> {
  merge(localState: T, remoteState: T): T;
}

export class ConflictResolver {
  private locks = new Map<string, ObjectLock>();

  /**
   * Acquire a lock on a shared object for co-editing.
   */
  public acquireLock(objectId: string, userId: string, ttlMs = 5000): boolean {
    const existing = this.locks.get(objectId);
    const now = Date.now();

    if (existing && existing.expiresAt > now && existing.lockedBy !== userId) {
      return false; // Lock held by another user
    }

    const lock: ObjectLock = Object.freeze({
      objectId,
      lockedBy: userId,
      lockedAt: now,
      expiresAt: now + ttlMs,
    });

    this.locks.set(objectId, lock);
    return true;
  }

  /**
   * Release lock.
   */
  public releaseLock(objectId: string, userId: string): boolean {
    const existing = this.locks.get(objectId);
    if (existing && (existing.lockedBy === userId || existing.expiresAt <= Date.now())) {
      this.locks.delete(objectId);
      return true;
    }
    return false;
  }

  /**
   * Check if object is currently locked by a user.
   */
  public isLocked(objectId: string): boolean {
    const existing = this.locks.get(objectId);
    if (!existing) return false;
    if (existing.expiresAt <= Date.now()) {
      this.locks.delete(objectId);
      return false;
    }
    return true;
  }

  /**
   * Optimistic update merge helper.
   */
  public resolveOptimistic<T extends { version: number }>(local: T, incoming: T): { state: T; rolledBack: boolean } {
    if (incoming.version > local.version) {
      return { state: incoming, rolledBack: false };
    }
    return { state: local, rolledBack: true };
  }
}
