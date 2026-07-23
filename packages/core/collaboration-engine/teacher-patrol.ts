/**
 * OpenLearn Teaching Collaboration Engine - Teacher Patrol Subsystem
 * Enables teachers to inspect, annotate, demonstrate, and take over any group workspace in real time.
 */

import { GroupWorkspaceStore } from './group-workspace.js';

export interface PatrolStatus {
  readonly teacherId: string;
  readonly activeGroupId?: string;
  readonly isTakingOver: boolean;
  readonly inspectedAt: number;
}

export class TeacherPatrolManager {
  private workspaceStore: GroupWorkspaceStore;
  private currentPatrols = new Map<string, PatrolStatus>();

  constructor(workspaceStore: GroupWorkspaceStore) {
    this.workspaceStore = workspaceStore;
  }

  public enterGroup(teacherId: string, groupId: string): PatrolStatus {
    const status: PatrolStatus = Object.freeze({
      teacherId,
      activeGroupId: groupId,
      isTakingOver: false,
      inspectedAt: Date.now(),
    });
    this.currentPatrols.set(teacherId, status);
    return status;
  }

  public takeOverGroup(teacherId: string, groupId: string): PatrolStatus {
    const status: PatrolStatus = Object.freeze({
      teacherId,
      activeGroupId: groupId,
      isTakingOver: true,
      inspectedAt: Date.now(),
    });
    this.currentPatrols.set(teacherId, status);
    return status;
  }

  public annotateGroup(groupId: string, annotationData: Record<string, unknown>): boolean {
    const wsp = this.workspaceStore.getWorkspace(groupId);
    if (!wsp) return false;

    const existingObjects = [...wsp.teachingObjects, annotationData];
    this.workspaceStore.updateWorkspace(groupId, {
      teachingObjects: Object.freeze(existingObjects),
    });
    return true;
  }

  public leaveGroup(teacherId: string): void {
    this.currentPatrols.delete(teacherId);
  }

  public getPatrolStatus(teacherId: string): PatrolStatus | undefined {
    return this.currentPatrols.get(teacherId);
  }
}
