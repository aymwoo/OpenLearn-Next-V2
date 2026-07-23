import type { TeachingObject, TeachingRuntimeStatus } from '../types.js';

export class TeachingRuntimeManager {
  private statusMap = new Map<string, TeachingRuntimeStatus>();

  public run(objectId: string): TeachingRuntimeStatus {
    this.statusMap.set(objectId, 'running');
    return 'running';
  }

  public pause(objectId: string): TeachingRuntimeStatus {
    this.statusMap.set(objectId, 'paused');
    return 'paused';
  }

  public resume(objectId: string): TeachingRuntimeStatus {
    this.statusMap.set(objectId, 'running');
    return 'running';
  }

  public stop(objectId: string): TeachingRuntimeStatus {
    this.statusMap.set(objectId, 'stopped');
    return 'stopped';
  }

  public reset(objectId: string): TeachingRuntimeStatus {
    this.statusMap.set(objectId, 'idle');
    return 'idle';
  }

  public getStatus(objectId: string): TeachingRuntimeStatus {
    return this.statusMap.get(objectId) || 'idle';
  }
}

export const teachingRuntimeManager = new TeachingRuntimeManager();
