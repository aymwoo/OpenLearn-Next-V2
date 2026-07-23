/**
 * OpenLearn Capability Governance - Lifecycle Engine
 * Manages SemVer lifecycle state transitions (Draft -> Experimental -> Preview -> Stable -> Deprecated -> Archived).
 */

import { CapabilityLifecycleStatus } from '../types/index.js';

export class LifecycleEngine {
  private static readonly ALLOWED_TRANSITIONS: Record<CapabilityLifecycleStatus, CapabilityLifecycleStatus[]> = {
    Draft: ['Experimental', 'Preview', 'Archived'],
    Experimental: ['Preview', 'Stable', 'Deprecated', 'Archived'],
    Preview: ['Stable', 'Deprecated', 'Archived'],
    Stable: ['Deprecated', 'Archived'],
    Deprecated: ['Archived'],
    Archived: [],
  };

  public static transition(
    currentStatus: CapabilityLifecycleStatus,
    targetStatus: CapabilityLifecycleStatus
  ): CapabilityLifecycleStatus {
    const allowed = this.ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new Error(`Invalid Lifecycle Transition: Cannot transition from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowed.join(', ')}]`);
    }
    return targetStatus;
  }
}
