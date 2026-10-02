/**
 * OpenLearn Lesson Flow Engine - State Machine
 * Formally governs Lesson lifecycle transitions:
 * idle -> draft / ready / active <-> paused -> completed -> idle
 */

import { LessonStatus } from './types.js';

export const VALID_LESSON_TRANSITIONS: Record<LessonStatus, readonly LessonStatus[]> = {
  idle: ['draft', 'ready', 'active'],
  draft: ['ready', 'active', 'idle'],
  ready: ['active', 'idle'],
  active: ['paused', 'completed'],
  paused: ['active', 'completed'],
  completed: ['idle'],
};

export class InvalidLessonStateTransitionError extends Error {
  constructor(
    public readonly lessonId: string,
    public readonly fromStatus: LessonStatus,
    public readonly toStatus: LessonStatus,
    public readonly allowedTransitions: readonly LessonStatus[],
  ) {
    super(
      `[LessonEngine] Invalid state transition for lesson "${lessonId}": cannot transition from "${fromStatus}" to "${toStatus}". Allowed transitions: [${allowedTransitions.join(', ')}]`,
    );
    this.name = 'InvalidLessonStateTransitionError';
  }
}

export type StateTransitionListener = (
  fromStatus: LessonStatus,
  toStatus: LessonStatus,
  lessonId: string,
) => void;

export class LessonStateMachine {
  private _status: LessonStatus;
  private _lessonId: string;
  private _listeners: Set<StateTransitionListener> = new Set();

  constructor(initialStatus: LessonStatus = 'idle', lessonId = '') {
    this._status = initialStatus;
    this._lessonId = lessonId;
  }

  public get status(): LessonStatus {
    return this._status;
  }

  public get lessonId(): string {
    return this._lessonId;
  }

  public setLessonId(lessonId: string): void {
    this._lessonId = lessonId;
  }

  public canTransitionTo(target: LessonStatus): boolean {
    const allowed = VALID_LESSON_TRANSITIONS[this._status] || [];
    return allowed.includes(target);
  }

  public transitionTo(target: LessonStatus): LessonStatus {
    if (this._status === target) {
      // 相同状态无需重复跃迁，但如果是 active -> active 则属于重复启动
      if (target === 'active') {
        throw new InvalidLessonStateTransitionError(
          this._lessonId,
          this._status,
          target,
          VALID_LESSON_TRANSITIONS[this._status],
        );
      }
      return this._status;
    }

    if (!this.canTransitionTo(target)) {
      throw new InvalidLessonStateTransitionError(
        this._lessonId,
        this._status,
        target,
        VALID_LESSON_TRANSITIONS[this._status] || [],
      );
    }

    const previous = this._status;
    this._status = target;

    for (const listener of this._listeners) {
      try {
        listener(previous, target, this._lessonId);
      } catch (err) {
        console.error('[LessonStateMachine] Listener callback failed:', err);
      }
    }

    return this._status;
  }

  public onTransition(listener: StateTransitionListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  public reset(lessonId = ''): void {
    this._status = 'idle';
    this._lessonId = lessonId;
  }
}
