/**
 * OpenLearn Classroom Runtime - State Manager
 * Maintains the single source of truth: unified immutable Classroom State Tree.
 */

import { RuntimeStateTree, RuntimeLifecycleState, UserParticipant } from './types.js';

type StateListener = (state: RuntimeStateTree) => void;

export class RuntimeStateManager {
  private currentState: RuntimeStateTree;
  private listeners = new Set<StateListener>();

  constructor(initialRuntimeId = `rt_${globalThis.crypto.randomUUID()}`) {
    this.currentState = {
      runtime: {
        id: initialRuntimeId,
        lifecycle: 'Create',
        startTime: Date.now(),
        elapsedTime: 0,
      },
      lesson: {},
      stage: { index: 0 },
      activity: {},
      whiteboard: { objectCount: 0, isLocked: false },
      teachingObjects: [],
      students: [],
      plugin: [],
      ai: { isGenerating: false },
      analytics: {
        totalInteractions: 0,
        activeStudentCount: 0,
        averageScore: 0,
      },
    };
  }

  /**
   * Get the current snapshot of the State Tree.
   */
  public getState(): RuntimeStateTree {
    return this.currentState;
  }

  /**
   * Mutate state using an explicit updater returning a new state tree.
   */
  public setState(nextState: RuntimeStateTree): void {
    this.currentState = Object.freeze(nextState);
    this.notify();
  }

  /**
   * Partial update helper for top-level state tree sections.
   */
  public updateState(partial: Partial<RuntimeStateTree>): void {
    this.currentState = Object.freeze({
      ...this.currentState,
      ...partial,
      runtime: partial.runtime ? { ...this.currentState.runtime, ...partial.runtime } : this.currentState.runtime,
      lesson: partial.lesson ? { ...this.currentState.lesson, ...partial.lesson } : this.currentState.lesson,
      stage: partial.stage ? { ...this.currentState.stage, ...partial.stage } : this.currentState.stage,
      activity: partial.activity ? { ...this.currentState.activity, ...partial.activity } : this.currentState.activity,
      whiteboard: partial.whiteboard ? { ...this.currentState.whiteboard, ...partial.whiteboard } : this.currentState.whiteboard,
      ai: partial.ai ? { ...this.currentState.ai, ...partial.ai } : this.currentState.ai,
      analytics: partial.analytics ? { ...this.currentState.analytics, ...partial.analytics } : this.currentState.analytics,
    });
    this.notify();
  }

  public setLifecycle(lifecycle: RuntimeLifecycleState): void {
    this.updateState({
      runtime: {
        ...this.currentState.runtime,
        lifecycle,
      },
    });
  }

  public addStudent(student: UserParticipant): void {
    const exists = this.currentState.students.some((s) => s.id === student.id);
    if (!exists) {
      this.updateState({
        students: Object.freeze([...this.currentState.students, student]),
      });
    }
  }

  public removeStudent(studentId: string): void {
    this.updateState({
      students: Object.freeze(this.currentState.students.filter((s) => s.id !== studentId)),
    });
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err: unknown) {
        console.error('[RuntimeStateManager] Listener error:', err);
      }
    }
  }
}
