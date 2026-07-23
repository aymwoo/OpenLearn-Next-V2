/**
 * OpenLearn Platform Service Registry - Service Lifecycle Manager
 * Manages service lifecycle state transitions (Registered -> Initialized -> Started -> Ready -> Stopped -> Disposed).
 */

import { ServiceLifecycleState } from '../types/index.js';

export class ServiceLifecycleManager {
  private states = new Map<string, ServiceLifecycleState>();

  public setLifecycleState(serviceId: string, state: ServiceLifecycleState): void {
    this.states.set(serviceId, state);
  }

  public getLifecycleState(serviceId: string): ServiceLifecycleState {
    return this.states.get(serviceId) || 'Registered';
  }

  public clear(): void {
    this.states.clear();
  }
}
