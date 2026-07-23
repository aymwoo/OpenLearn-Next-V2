/**
 * OpenLearn Lesson Flow Engine - Teaching Timeline
 * Drives classroom stage and activity progression, sequencing, and timeline synchronization.
 */

import { Flow, Stage, Activity } from './types.js';

export interface TimelineState {
  currentStageIndex: number;
  currentActivityIndex: number;
  currentStage?: Stage;
  currentActivity?: Activity;
  stageElapsedSeconds: number;
  totalElapsedSeconds: number;
  isPreview: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

export type TimelineChangeListener = (state: TimelineState) => void;

export class TeachingTimeline {
  private flow: Flow | null = null;
  private stageIndex = 0;
  private activityIndex = 0;
  private stageElapsedSeconds = 0;
  private totalElapsedSeconds = 0;
  private isPreviewMode = false;
  private listeners = new Set<TimelineChangeListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(flow?: Flow) {
    if (flow) {
      this.loadFlow(flow);
    }
  }

  public loadFlow(flow: Flow): void {
    this.flow = flow;
    this.stageIndex = 0;
    this.activityIndex = 0;
    this.stageElapsedSeconds = 0;
    this.notify();
  }

  public getFlow(): Flow | null {
    return this.flow;
  }

  public subscribe(listener: TimelineChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): TimelineState {
    if (!this.flow || this.flow.stages.length === 0) {
      return {
        currentStageIndex: -1,
        currentActivityIndex: -1,
        stageElapsedSeconds: 0,
        totalElapsedSeconds: this.totalElapsedSeconds,
        isPreview: this.isPreviewMode,
        canNext: false,
        canPrevious: false,
      };
    }

    const currentStage = this.flow.stages[this.stageIndex];
    const currentActivity = currentStage?.activities?.[this.activityIndex];

    const isLastStage = this.stageIndex >= this.flow.stages.length - 1;
    const isLastActivity = currentStage?.activities
      ? this.activityIndex >= currentStage.activities.length - 1
      : true;

    const canNext = !isLastStage || !isLastActivity;
    const canPrevious = this.stageIndex > 0 || this.activityIndex > 0;

    return {
      currentStageIndex: this.stageIndex,
      currentActivityIndex: this.activityIndex,
      currentStage,
      currentActivity,
      stageElapsedSeconds: this.stageElapsedSeconds,
      totalElapsedSeconds: this.totalElapsedSeconds,
      isPreview: this.isPreviewMode,
      canNext,
      canPrevious,
    };
  }

  public startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.stageElapsedSeconds += 1;
      this.totalElapsedSeconds += 1;
      this.notify();
    }, 1000);
  }

  public stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public resetTimer(): void {
    this.stageElapsedSeconds = 0;
    this.notify();
  }

  public next(): boolean {
    if (!this.flow || this.flow.stages.length === 0) return false;

    const currentStage = this.flow.stages[this.stageIndex];
    const hasMoreActivitiesInStage =
      currentStage?.activities && this.activityIndex < currentStage.activities.length - 1;

    if (hasMoreActivitiesInStage) {
      this.activityIndex += 1;
    } else if (this.stageIndex < this.flow.stages.length - 1) {
      this.stageIndex += 1;
      this.activityIndex = 0;
      this.stageElapsedSeconds = 0;
    } else {
      return false; // Reached end of timeline
    }

    this.notify();
    return true;
  }

  public previous(): boolean {
    if (!this.flow || this.flow.stages.length === 0) return false;

    if (this.activityIndex > 0) {
      this.activityIndex -= 1;
    } else if (this.stageIndex > 0) {
      this.stageIndex -= 1;
      const prevStage = this.flow.stages[this.stageIndex];
      this.activityIndex = prevStage.activities && prevStage.activities.length > 0
        ? prevStage.activities.length - 1
        : 0;
      this.stageElapsedSeconds = 0;
    } else {
      return false; // Reached start of timeline
    }

    this.notify();
    return true;
  }

  public jump(stageTarget: number | string, activityTarget?: number | string): boolean {
    if (!this.flow || this.flow.stages.length === 0) return false;

    let targetStageIdx = -1;
    if (typeof stageTarget === 'number') {
      targetStageIdx = stageTarget;
    } else {
      targetStageIdx = this.flow.stages.findIndex((s) => s.id === stageTarget);
    }

    if (targetStageIdx < 0 || targetStageIdx >= this.flow.stages.length) {
      return false;
    }

    this.stageIndex = targetStageIdx;
    const targetStage = this.flow.stages[targetStageIdx];

    if (activityTarget !== undefined) {
      let targetActIdx = -1;
      if (typeof activityTarget === 'number') {
        targetActIdx = activityTarget;
      } else {
        targetActIdx = targetStage.activities.findIndex((a) => a.id === activityTarget);
      }
      if (targetActIdx >= 0 && targetActIdx < targetStage.activities.length) {
        this.activityIndex = targetActIdx;
      } else {
        this.activityIndex = 0;
      }
    } else {
      this.activityIndex = 0;
    }

    this.stageElapsedSeconds = 0;
    this.notify();
    return true;
  }

  public restart(): void {
    this.stageIndex = 0;
    this.activityIndex = 0;
    this.stageElapsedSeconds = 0;
    this.notify();
  }

  public setPreview(preview: boolean): void {
    this.isPreviewMode = preview;
    this.notify();
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[TeachingTimeline] Listener error:', err);
      }
    }
  }
}
