/**
 * OpenLearn Teaching Collaboration Engine - Broadcast & Collect Subsystem
 * Teacher broadcast to all groups & automated collection of group results for unified showcase.
 */

import { GroupWorkspaceStore } from './group-workspace.js';

export interface BroadcastSession {
  readonly id: string;
  readonly broadcastType: 'teacher' | 'group' | 'student' | 'object' | 'whiteboard';
  readonly sourceId: string;
  readonly targetGroupIds: ReadonlyArray<string>;
  readonly payload: Record<string, unknown>;
  readonly startedAt: number;
}

export interface CollectedGroupResult {
  readonly groupId: string;
  readonly canvasState: Record<string, unknown>;
  readonly teachingObjects: ReadonlyArray<Record<string, unknown>>;
  readonly pluginState: Record<string, unknown>;
  readonly collectedAt: number;
}

export class BroadcastCollectManager {
  private workspaceStore: GroupWorkspaceStore;
  private activeBroadcast: BroadcastSession | null = null;

  constructor(workspaceStore: GroupWorkspaceStore) {
    this.workspaceStore = workspaceStore;
  }

  public startBroadcast(
    broadcastType: 'teacher' | 'group' | 'student' | 'object' | 'whiteboard',
    sourceId: string,
    targetGroupIds: ReadonlyArray<string>,
    payload: Record<string, unknown>
  ): BroadcastSession {
    const session: BroadcastSession = Object.freeze({
      id: `brd_${globalThis.crypto.randomUUID()}`,
      broadcastType,
      sourceId,
      targetGroupIds: Object.freeze([...targetGroupIds]),
      payload: Object.freeze({ ...payload }),
      startedAt: Date.now(),
    });

    this.activeBroadcast = session;
    return session;
  }

  public stopBroadcast(): void {
    this.activeBroadcast = null;
  }

  public getActiveBroadcast(): BroadcastSession | null {
    return this.activeBroadcast;
  }

  /**
   * Collect work outputs across specified groups for teacher review.
   */
  public collectGroupResults(groupIds: ReadonlyArray<string>): ReadonlyArray<CollectedGroupResult> {
    const results: CollectedGroupResult[] = [];
    const now = Date.now();

    for (const gId of groupIds) {
      const wsp = this.workspaceStore.getWorkspace(gId);
      if (wsp) {
        results.push({
          groupId: gId,
          canvasState: wsp.canvasState,
          teachingObjects: wsp.teachingObjects,
          pluginState: wsp.pluginState,
          collectedAt: now,
        });
      }
    }
    return Object.freeze(results);
  }
}
