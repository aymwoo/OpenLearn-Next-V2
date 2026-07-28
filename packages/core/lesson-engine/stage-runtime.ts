/**
 * OpenLearn Lesson Flow Engine - Stage Runtime
 * Manages Stage lifecycle (enter, exit, pause, resume, autoFinish, timeout alerts) and Stage analytics.
 */

import { Stage, StageAnalytics, StudentAction, Activity, ActivityStatus } from './types.js';
import { EventBusPort } from '../event-bus/index.js';

export interface StageRuntimeOptions {
  eventBus?: EventBusPort;
  onTimeoutWarning?: (stageId: string, remainingSeconds: number) => void;
}

export class StageRuntime {
  private currentStage: Stage | null = null;
  private isPaused = false;
  private startTime = 0;
  private elapsedTime = 0;
  private studentActions: StudentAction[] = [];
  private eventBus?: EventBusPort;
  private onTimeoutWarning?: (stageId: string, remainingSeconds: number) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: StageRuntimeOptions) {
    this.eventBus = options?.eventBus;
    this.onTimeoutWarning = options?.onTimeoutWarning;
  }

  public async enterStage(stage: Stage, lessonId: string, flowId: string, stageIndex: number): Promise<void> {
    if (this.currentStage) {
      await this.exitStage(lessonId, flowId);
    }

    this.currentStage = { ...stage, completionStatus: 'in_progress' };
    this.isPaused = false;
    this.startTime = Date.now();
    this.elapsedTime = 0;
    this.studentActions = [];

    // Initialize analytics if not present
    if (!this.currentStage.analytics) {
      this.currentStage.analytics = {
        completionRate: 0,
        participantCount: 0,
        elapsedTimeSeconds: 0,
        interactionCount: 0,
        quizScores: [],
        discussionHeat: 0,
      };
    }

    this.startTimer(lessonId);

    if (this.eventBus) {
      await this.eventBus.publish({
        id: globalThis.crypto.randomUUID(),
        type: 'stage.entered',
        source: 'stage.runtime',
        payload: { lessonId, flowId, stageId: stage.id, stageIndex, timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }
  }

  public async exitStage(lessonId: string, flowId: string): Promise<StageAnalytics | null> {
    if (!this.currentStage) return null;

    this.stopTimer();
    this.currentStage.completionStatus = 'completed';
    const analytics = this.calculateAnalytics();
    this.currentStage.analytics = analytics;

    if (this.eventBus) {
      await this.eventBus.publish({
        id: globalThis.crypto.randomUUID(),
        type: 'stage.finished',
        source: 'stage.runtime',
        payload: { lessonId, flowId, stageId: this.currentStage.id, analytics, timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }

    const completedAnalytics = { ...analytics };
    this.currentStage = null;
    return completedAnalytics;
  }

  public pauseStage(): void {
    if (!this.currentStage || this.isPaused) return;
    this.isPaused = true;
  }

  public resumeStage(): void {
    if (!this.currentStage || !this.isPaused) return;
    this.isPaused = false;
  }

  public autoFinishStage(lessonId: string, flowId: string): Promise<StageAnalytics | null> {
    return this.exitStage(lessonId, flowId);
  }

  public recordStudentAction(action: StudentAction): void {
    if (!this.currentStage) return;
    this.studentActions.push(action);
    this.updateAnalyticsLive();
  }

  public updateActivityStatus(activityId: string, status: ActivityStatus): void {
    if (!this.currentStage) return;
    const act = this.currentStage.activities.find((a) => a.id === activityId);
    if (act) {
      act.status = status;
    }
  }

  public getCurrentStage(): Stage | null {
    return this.currentStage;
  }

  public getElapsedTimeSeconds(): number {
    return this.elapsedTime;
  }

  public isStagePaused(): boolean {
    return this.isPaused;
  }

  private startTimer(lessonId: string): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (!this.isPaused && this.currentStage) {
        this.elapsedTime += 1;
        this.checkTimeout(lessonId);
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private checkTimeout(lessonId: string): void {
    if (!this.currentStage) return;
    const estSec = this.currentStage.estimatedDurationSeconds;
    if (estSec && estSec > 0) {
      const remaining = estSec - this.elapsedTime;
      if (remaining === 60 || remaining === 30) {
        if (this.onTimeoutWarning) {
          this.onTimeoutWarning(this.currentStage.id, remaining);
        }
      }
    }
  }

  private updateAnalyticsLive(): void {
    if (!this.currentStage || !this.currentStage.analytics) return;

    const uniqueStudents = new Set(this.studentActions.map((a) => a.studentId));
    this.currentStage.analytics.participantCount = uniqueStudents.size;
    this.currentStage.analytics.interactionCount = this.studentActions.length;
    this.currentStage.analytics.elapsedTimeSeconds = this.elapsedTime;

    // Discussion heat calculation based on action frequency
    const recentActions = this.studentActions.filter((a) => Date.now() - a.timestamp < 300000);
    this.currentStage.analytics.discussionHeat = Math.min(100, Math.round(recentActions.length * 10));
  }

  public calculateAnalytics(): StageAnalytics {
    const uniqueStudents = new Set(this.studentActions.map((a) => a.studentId));
    const quizSubmits = this.studentActions.filter((a) => a.actionType === 'quiz_submit');

    const quizScores = quizSubmits.map((q) => ({
      studentId: q.studentId,
      score: (q.payload.score as number) || 0,
      maxScore: (q.payload.maxScore as number) || 100,
    }));

    const completedActivities = this.currentStage?.activities.filter(
      (a) => a.status === 'completed'
    ).length || 0;
    const totalActivities = this.currentStage?.activities.length || 1;
    const completionRate = Math.round((completedActivities / totalActivities) * 100);

    return {
      completionRate,
      participantCount: uniqueStudents.size,
      elapsedTimeSeconds: this.elapsedTime,
      interactionCount: this.studentActions.length,
      quizScores,
      discussionHeat: Math.min(100, Math.round(this.studentActions.length * 8)),
    };
  }
}
