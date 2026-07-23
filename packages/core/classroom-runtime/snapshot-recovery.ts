/**
 * OpenLearn Classroom Runtime - Snapshot & Crash Recovery Subsystem
 * Persists runtime snapshots, recovers state upon crash, and handles fault tolerance.
 */

import { RuntimeSnapshot, RuntimeStateTree, RuntimeResource } from './types.js';

export class RuntimeSnapshotManager {
  private snapshots = new Map<string, RuntimeSnapshot>();
  private lastAutoSnapshot?: RuntimeSnapshot;

  /**
   * Take a full snapshot of current runtime state tree, services, modules, and resources.
   */
  public takeSnapshot(
    stateTree: RuntimeStateTree,
    activeServices: ReadonlyArray<string>,
    loadedModules: ReadonlyArray<string>,
    resources: ReadonlyArray<RuntimeResource>
  ): RuntimeSnapshot {
    const snapshot: RuntimeSnapshot = {
      snapshotId: `snap_${globalThis.crypto.randomUUID()}`,
      timestamp: Date.now(),
      stateTree: JSON.parse(JSON.stringify(stateTree)),
      activeServices: [...activeServices],
      loadedModules: [...loadedModules],
      resources: [...resources],
    };

    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.lastAutoSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Get latest snapshot for crash recovery.
   */
  public getLatestSnapshot(): RuntimeSnapshot | undefined {
    return this.lastAutoSnapshot;
  }

  /**
   * Get snapshot by ID.
   */
  public getSnapshot(snapshotId: string): RuntimeSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Clear snapshots.
   */
  public clear(): void {
    this.snapshots.clear();
    this.lastAutoSnapshot = undefined;
  }
}
