/**
 * OpenLearn Teaching Collaboration Engine - Group Workspace Subsystem
 * Manages isolated workspace state per group (Canvas, Objects, Timeline, Plugin Runtime, AI Context).
 */

import { GroupWorkspaceData } from './types.js';

export class GroupWorkspaceStore {
  private workspaces = new Map<string, GroupWorkspaceData>();

  public createWorkspace(groupId: string): GroupWorkspaceData {
    const workspaceId = `wsp_${groupId}_${globalThis.crypto.randomUUID()}`;
    const workspace: GroupWorkspaceData = {
      workspaceId,
      groupId,
      canvasState: {},
      teachingObjects: [],
      timelinePosition: 0,
      pluginState: {},
      aiContext: {},
    };

    this.workspaces.set(groupId, Object.freeze(workspace));
    return workspace;
  }

  public getWorkspace(groupId: string): GroupWorkspaceData | undefined {
    return this.workspaces.get(groupId);
  }

  public updateWorkspace(groupId: string, partial: Partial<GroupWorkspaceData>): GroupWorkspaceData | undefined {
    const existing = this.workspaces.get(groupId);
    if (!existing) return undefined;

    const updated: GroupWorkspaceData = Object.freeze({
      ...existing,
      ...partial,
      canvasState: partial.canvasState ? { ...existing.canvasState, ...partial.canvasState } : existing.canvasState,
      pluginState: partial.pluginState ? { ...existing.pluginState, ...partial.pluginState } : existing.pluginState,
      aiContext: partial.aiContext ? { ...existing.aiContext, ...partial.aiContext } : existing.aiContext,
    });

    this.workspaces.set(groupId, updated);
    return updated;
  }

  public deleteWorkspace(groupId: string): boolean {
    return this.workspaces.delete(groupId);
  }

  public clear(): void {
    this.workspaces.clear();
  }
}
