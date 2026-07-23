/**
 * OpenLearn Student Workspace — Context (Sprint P6-01)
 *
 * Wraps the shared Classroom Runtime Kernel with a Student role and exposes a
 * restricted Student View. It reuses the existing Classroom Runtime — it does
 * NOT duplicate state or create a parallel context. All permission checks,
 * event subscription and snapshot/recovery delegate to the shared kernel.
 */

import { ClassroomRuntimeKernel } from '../../../packages/core/classroom-runtime/kernel.js';
import type {
  RuntimePermission,
  RuntimeEventType,
  RuntimeEventMap,
} from '../../../packages/core/classroom-runtime/types.js';
import type { StudentView, StudentWorkspaceInit } from './student-workspace-types.js';

export type StudentEventCallback<K extends RuntimeEventType> = (
  payload: RuntimeEventMap[K]
) => void | Promise<void>;

export class StudentWorkspaceContext {
  private readonly kernel: ClassroomRuntimeKernel;
  private readonly init: StudentWorkspaceInit;

  constructor(init: StudentWorkspaceInit) {
    this.init = init;
    this.kernel = new ClassroomRuntimeKernel();
    this.kernel.setUser({
      id: init.student.id,
      name: init.student.name,
      role: 'Student',
      avatar: init.student.avatar,
      isOnline: true,
      joinedAt: Date.now(),
    });
  }

  /** Restricted student view derived from the shared classroom context. */
  public getView(): StudentView {
    const ctx = this.kernel.getContext();
    return {
      studentId: this.init.student.id,
      studentName: this.init.student.name,
      role: 'Student',
      lessonId: this.init.lessonId ?? ctx.lessonId,
      courseId: this.init.courseId ?? ctx.courseId,
      permissions: ctx.permissions,
    };
  }

  public get permissions(): ReadonlyArray<RuntimePermission> {
    return this.kernel.getContext().permissions;
  }

  public hasPermission(permission: RuntimePermission): boolean {
    return this.kernel.hasPermission(permission);
  }

  /**
   * Subscribe to a runtime classroom event. Returns an unsubscribe function.
   * Reuses the kernel event bus — no new event system is introduced.
   */
  public subscribe<K extends RuntimeEventType>(
    eventType: K,
    callback: StudentEventCallback<K>
  ): () => void {
    return this.kernel.eventBus.subscribe(eventType, (envelope) =>
      callback(envelope.payload as RuntimeEventMap[K])
    );
  }

  public takeSnapshot() {
    return this.kernel.takeSnapshot();
  }

  public restoreSnapshot(): boolean {
    return this.kernel.restoreLatestSnapshot();
  }

  /** Access to the underlying shared runtime kernel (advanced use only). */
  public get runtimeKernel(): ClassroomRuntimeKernel {
    return this.kernel;
  }

  public dispose(): Promise<void> {
    return this.kernel.dispose();
  }
}
