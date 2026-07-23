import type { TeachingLifecycleStage, TeachingObject } from '../types.js';

export class TeachingLifecycleManager {
  private listeners = new Map<string, Array<(stage: TeachingLifecycleStage) => void>>();

  public transitionStage(obj: TeachingObject, nextStage: TeachingLifecycleStage): TeachingObject {
    if (obj.lifecycleStage === nextStage) return obj;

    const updatedObj: TeachingObject = {
      ...obj,
      lifecycleStage: nextStage,
      updatedAt: Date.now(),
    };

    const objListeners = this.listeners.get(obj.id);
    if (objListeners) {
      objListeners.forEach((fn) => fn(nextStage));
    }

    return updatedObj;
  }

  public onStageChange(objectId: string, listener: (stage: TeachingLifecycleStage) => void): () => void {
    if (!this.listeners.has(objectId)) {
      this.listeners.set(objectId, []);
    }
    this.listeners.get(objectId)!.push(listener);

    return () => {
      const arr = this.listeners.get(objectId);
      if (arr) {
        this.listeners.set(objectId, arr.filter((fn) => fn !== listener));
      }
    };
  }
}

export const teachingLifecycleManager = new TeachingLifecycleManager();
