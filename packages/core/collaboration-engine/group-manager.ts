/**
 * OpenLearn Teaching Collaboration Engine - Group Manager
 * Group creation, auto-grouping, random grouping, swapping members, merging, dissolving.
 */

import { GroupData } from './types.js';
import { GroupWorkspaceStore } from './group-workspace.js';

export class GroupManager {
  private groups = new Map<string, GroupData>();
  private workspaceStore: GroupWorkspaceStore;

  constructor(workspaceStore: GroupWorkspaceStore) {
    this.workspaceStore = workspaceStore;
  }

  public createGroup(name: string, memberIds: ReadonlyArray<string>, leaderId?: string): GroupData {
    const id = `grp_${globalThis.crypto.randomUUID()}`;
    const workspace = this.workspaceStore.createWorkspace(id);

    const group: GroupData = Object.freeze({
      id,
      name,
      memberIds: Object.freeze([...memberIds]),
      leaderId,
      workspaceId: workspace.workspaceId,
      createdAt: Date.now(),
    });

    this.groups.set(id, group);
    return group;
  }

  public autoGroup(studentIds: ReadonlyArray<string>, groupSize = 4): ReadonlyArray<GroupData> {
    this.dissolveAll();
    const created: GroupData[] = [];
    const count = Math.ceil(studentIds.length / groupSize);

    for (let i = 0; i < count; i++) {
      const chunk = studentIds.slice(i * groupSize, (i + 1) * groupSize);
      if (chunk.length > 0) {
        const group = this.createGroup(`第 ${i + 1} 小组`, chunk, chunk[0]);
        created.push(group);
      }
    }
    return Object.freeze(created);
  }

  public randomGroup(studentIds: ReadonlyArray<string>, numberOfGroups = 2): ReadonlyArray<GroupData> {
    this.dissolveAll();
    const shuffled = [...studentIds].sort(() => Math.random() - 0.5);
    const created: GroupData[] = [];

    for (let i = 0; i < numberOfGroups; i++) {
      created.push(this.createGroup(`小组 ${String.fromCharCode(65 + i)}`, [], undefined));
    }

    shuffled.forEach((studentId, idx) => {
      const targetGroup = created[idx % numberOfGroups];
      const updatedMembers = [...targetGroup.memberIds, studentId];
      const updatedGroup: GroupData = Object.freeze({
        ...targetGroup,
        memberIds: Object.freeze(updatedMembers),
        leaderId: targetGroup.leaderId || studentId,
      });
      created[idx % numberOfGroups] = updatedGroup;
      this.groups.set(targetGroup.id, updatedGroup);
    });

    return Object.freeze(created);
  }

  public swapMembers(groupId1: string, studentId1: string, groupId2: string, studentId2: string): boolean {
    const g1 = this.groups.get(groupId1);
    const g2 = this.groups.get(groupId2);
    if (!g1 || !g2) return false;

    const g1Members = g1.memberIds.filter((id) => id !== studentId1).concat(studentId2);
    const g2Members = g2.memberIds.filter((id) => id !== studentId2).concat(studentId1);

    this.groups.set(groupId1, Object.freeze({ ...g1, memberIds: Object.freeze(g1Members) }));
    this.groups.set(groupId2, Object.freeze({ ...g2, memberIds: Object.freeze(g2Members) }));
    return true;
  }

  public mergeGroups(groupId1: string, groupId2: string): GroupData | undefined {
    const g1 = this.groups.get(groupId1);
    const g2 = this.groups.get(groupId2);
    if (!g1 || !g2) return undefined;

    const mergedMembers = Array.from(new Set([...g1.memberIds, ...g2.memberIds]));
    const merged: GroupData = Object.freeze({
      ...g1,
      name: `${g1.name} & ${g2.name} (合并组)`,
      memberIds: Object.freeze(mergedMembers),
    });

    this.groups.set(groupId1, merged);
    this.dissolveGroup(groupId2);
    return merged;
  }

  public dissolveGroup(groupId: string): boolean {
    this.workspaceStore.deleteWorkspace(groupId);
    return this.groups.delete(groupId);
  }

  public dissolveAll(): void {
    for (const id of this.groups.keys()) {
      this.workspaceStore.deleteWorkspace(id);
    }
    this.groups.clear();
  }

  public getGroup(groupId: string): GroupData | undefined {
    return this.groups.get(groupId);
  }

  public listGroups(): ReadonlyArray<GroupData> {
    return Object.freeze(Array.from(this.groups.values()));
  }
}
