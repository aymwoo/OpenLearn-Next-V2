/**
 * OpenLearn Classroom Runtime - Runtime Monitor & Dev Inspector
 * Inspects session, memory usage, event throughput, scheduler state, and active modules.
 */

import { RuntimeStateTree } from './types.js';

export interface RuntimeDiagnostics {
  readonly runtimeId: string;
  readonly lifecycleState: string;
  readonly activeServicesCount: number;
  readonly registeredModulesCount: number;
  readonly pendingSchedulerTasksCount: number;
  readonly activeStudentsCount: number;
  readonly totalInteractionsCount: number;
  readonly memoryUsageMB: number;
  readonly timestamp: number;
}

export class RuntimeMonitor {
  private eventCount = 0;

  public incrementEventCount(): void {
    this.eventCount += 1;
  }

  /**
   * Produce comprehensive diagnostic snapshot.
   */
  public getDiagnostics(
    stateTree: RuntimeStateTree,
    activeServicesCount: number,
    registeredModulesCount: number,
    pendingTasksCount: number
  ): RuntimeDiagnostics {
    const mem = process.memoryUsage ? process.memoryUsage().heapUsed / (1024 * 1024) : 0;

    return {
      runtimeId: stateTree.runtime.id,
      lifecycleState: stateTree.runtime.lifecycle,
      activeServicesCount,
      registeredModulesCount,
      pendingSchedulerTasksCount: pendingTasksCount,
      activeStudentsCount: stateTree.students.length,
      totalInteractionsCount: stateTree.analytics.totalInteractions,
      memoryUsageMB: Math.round(mem * 100) / 100,
      timestamp: Date.now(),
    };
  }
}
