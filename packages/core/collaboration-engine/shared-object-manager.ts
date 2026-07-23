/**
 * OpenLearn Teaching Collaboration Engine - Shared Object Subsystem
 * Cross-group object sharing via sync, copy, mirror, or reference modes.
 */

import { SharedObjectData } from './types.js';

export class SharedObjectManager {
  private sharedObjects = new Map<string, SharedObjectData>();

  public createSharedObject(
    content: Record<string, unknown>,
    targetGroupIds: ReadonlyArray<string>,
    mode: 'sync' | 'copy' | 'mirror' | 'reference' = 'sync',
    sourceGroupId?: string
  ): SharedObjectData {
    const id = `shobj_${globalThis.crypto.randomUUID()}`;
    const sharedObj: SharedObjectData = Object.freeze({
      id,
      sourceGroupId,
      targetGroupIds: Object.freeze([...targetGroupIds]),
      mode,
      content: Object.freeze({ ...content }),
      version: 1,
    });

    this.sharedObjects.set(id, sharedObj);
    return sharedObj;
  }

  public updateSharedObject(id: string, partialContent: Record<string, unknown>): SharedObjectData | undefined {
    const existing = this.sharedObjects.get(id);
    if (!existing) return undefined;

    const updated: SharedObjectData = Object.freeze({
      ...existing,
      content: Object.freeze({ ...existing.content, ...partialContent }),
      version: existing.version + 1,
    });

    this.sharedObjects.set(id, updated);
    return updated;
  }

  public getSharedObject(id: string): SharedObjectData | undefined {
    return this.sharedObjects.get(id);
  }

  public listSharedObjects(targetGroupId?: string): ReadonlyArray<SharedObjectData> {
    const list = Array.from(this.sharedObjects.values());
    if (targetGroupId) {
      return Object.freeze(list.filter((o) => o.targetGroupIds.includes(targetGroupId)));
    }
    return Object.freeze(list);
  }
}
