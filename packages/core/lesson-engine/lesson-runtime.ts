/**
 * OpenLearn Lesson Flow Engine - Lesson Runtime
 * Master orchestration engine for Lessons, Flows, Stages, Timeline, Teacher Control, Student Sync, AI, and Replay.
 */

import {
  Lesson,
  Flow,
  Stage,
  Activity,
  LessonSnapshot,
  UserRef,
  StageAnalytics,
  StudentAction,
} from './types.js';
import { ActivityRegistry } from './activity-registry.js';
import { TeachingTimeline } from './teaching-timeline.js';
import { StageRuntime } from './stage-runtime.js';
import { TeachingContextManager } from './teaching-context.js';
import { WhiteboardStageAdapter } from './whiteboard-stage-adapter.js';
import { LessonReplayer } from './replayer.js';
import { LessonAIInterface } from './ai-interface.js';
import { EventBusPort, PlatformEvent } from '../event-bus/index.js';

export interface LessonEngineOptions {
  eventBus?: EventBusPort;
}

export class LessonRuntime {
  public readonly activityRegistry: ActivityRegistry;
  public readonly timeline: TeachingTimeline;
  public readonly stageRuntime: StageRuntime;
  public readonly contextManager: TeachingContextManager;
  public readonly whiteboardAdapter: WhiteboardStageAdapter;
  public readonly replayer: LessonReplayer;
  public readonly aiInterface: LessonAIInterface;

  private currentLesson: Lesson | null = null;
  private activeFlow: Flow | null = null;
  private eventBus?: EventBusPort;
  private snapshots: LessonSnapshot[] = [];
  private startTime = 0;
  private isLive = false;

  constructor(options?: LessonEngineOptions) {
    this.eventBus = options?.eventBus;
    this.activityRegistry = new ActivityRegistry();
    this.timeline = new TeachingTimeline();
    this.stageRuntime = new StageRuntime({ eventBus: this.eventBus });
    this.contextManager = new TeachingContextManager();
    this.whiteboardAdapter = new WhiteboardStageAdapter();
    this.replayer = new LessonReplayer();
    this.aiInterface = new LessonAIInterface();

    // Wire timeline change events to context and stage runtime
    this.timeline.subscribe(async (state) => {
      if (!this.currentLesson || !this.activeFlow) return;

      this.contextManager.setCurrentStage(state.currentStage);
      this.contextManager.setCurrentActivity(state.currentActivity);

      if (state.currentStage && state.currentStage.id !== this.stageRuntime.getCurrentStage()?.id) {
        await this.stageRuntime.enterStage(
          state.currentStage,
          this.currentLesson.id,
          this.activeFlow.id,
          state.currentStageIndex
        );
      }

      if (this.isLive) {
        this.publishEvent('StudentSynced', {
          lessonId: this.currentLesson.id,
          studentId: '*',
          stageId: state.currentStage?.id || '',
          activityId: state.currentActivity?.id,
          timestamp: Date.now(),
        });
      }
    });
  }

  // ── Lesson Lifecycle Operations ────────────────────────────────────────

  public async startLesson(lesson: Lesson, flowId?: string): Promise<void> {
    this.currentLesson = { ...lesson, status: 'active', updatedAt: Date.now() };
    const targetFlow = flowId
      ? lesson.flows.find((f) => f.id === flowId) || lesson.flows[0]
      : lesson.flows.find((f) => f.isCurrent) || lesson.flows[0];

    if (!targetFlow) {
      throw new Error(`[LessonRuntime] No flow found in lesson ${lesson.id}`);
    }

    this.activeFlow = targetFlow;
    this.currentLesson.activeFlowId = targetFlow.id;
    this.startTime = Date.now();
    this.isLive = true;

    this.timeline.loadFlow(targetFlow);
    this.timeline.startTimer();

    this.contextManager.setCurrentLesson(this.currentLesson);
    this.contextManager.setCurrentFlow(targetFlow);

    await this.publishEvent('LessonStarted', {
      lessonId: lesson.id,
      flowId: targetFlow.id,
      timestamp: this.startTime,
    });

    this.takeSnapshot();
  }

  public async pauseLesson(): Promise<void> {
    if (!this.currentLesson || this.currentLesson.status !== 'active') return;
    this.currentLesson.status = 'paused';
    this.currentLesson.updatedAt = Date.now();

    this.timeline.stopTimer();
    this.stageRuntime.pauseStage();

    await this.publishEvent('LessonPaused', {
      lessonId: this.currentLesson.id,
      elapsedSeconds: this.timeline.getState().totalElapsedSeconds,
      timestamp: Date.now(),
    });
  }

  public async resumeLesson(): Promise<void> {
    if (!this.currentLesson || this.currentLesson.status !== 'paused') return;
    this.currentLesson.status = 'active';
    this.currentLesson.updatedAt = Date.now();

    this.timeline.startTimer();
    this.stageRuntime.resumeStage();

    await this.publishEvent('LessonStarted', {
      lessonId: this.currentLesson.id,
      flowId: this.activeFlow?.id || '',
      timestamp: Date.now(),
    });
  }

  public async stopLesson(): Promise<StageAnalytics | null> {
    if (!this.currentLesson) return null;

    this.currentLesson.status = 'completed';
    this.currentLesson.updatedAt = Date.now();
    this.isLive = false;

    this.timeline.stopTimer();
    const analytics = await this.stageRuntime.exitStage(
      this.currentLesson.id,
      this.activeFlow?.id || ''
    );

    await this.publishEvent('LessonEnded', {
      lessonId: this.currentLesson.id,
      totalDurationSeconds: this.timeline.getState().totalElapsedSeconds,
      timestamp: Date.now(),
    });

    this.takeSnapshot();
    return analytics;
  }

  public takeSnapshot(): LessonSnapshot {
    if (!this.currentLesson || !this.activeFlow) {
      throw new Error('[LessonRuntime] Cannot take snapshot without active lesson.');
    }

    const state = this.timeline.getState();
    const snapshot: LessonSnapshot = {
      id: `snap_${globalThis.crypto.randomUUID()}`,
      lessonId: this.currentLesson.id,
      timestamp: Date.now(),
      lessonState: JSON.parse(JSON.stringify(this.currentLesson)),
      activeFlowId: this.activeFlow.id,
      activeStageId: state.currentStage?.id || '',
      activeActivityId: state.currentActivity?.id,
      elapsedSeconds: state.totalElapsedSeconds,
      whiteboardData: state.currentStage
        ? (this.whiteboardAdapter.getStageView(state.currentStage.id) as unknown as Record<string, unknown>)
        : undefined,
    };

    this.snapshots.push(snapshot);
    if (this.startTime > 0) {
      this.replayer.recordSnapshot(snapshot, this.startTime);
    }
    return snapshot;
  }

  public getSnapshots(): LessonSnapshot[] {
    return [...this.snapshots];
  }

  // ── Teacher Controls ───────────────────────────────────────────────────

  public nextStage(): boolean {
    return this.timeline.next();
  }

  public backStage(): boolean {
    return this.timeline.previous();
  }

  public lockStage(stageId: string, locked = true): boolean {
    if (!this.activeFlow) return false;
    const stg = this.activeFlow.stages.find((s) => s.id === stageId);
    if (stg) {
      stg.locked = locked;
      this.contextManager.setCurrentStage(this.timeline.getState().currentStage);
      return true;
    }
    return false;
  }

  public skipStage(stageId: string): boolean {
    if (!this.activeFlow || !this.currentLesson) return false;
    const stageIdx = this.activeFlow.stages.findIndex((s) => s.id === stageId);
    if (stageIdx >= 0) {
      const stg = this.activeFlow.stages[stageIdx];
      stg.completionStatus = 'skipped';
      this.publishEvent('ActivitySkipped', {
        lessonId: this.currentLesson.id,
        stageId,
        activityId: '*',
        timestamp: Date.now(),
      });
      return this.jumpStage(stageIdx + 1);
    }
    return false;
  }


  public jumpStage(stageTarget: string | number, activityTarget?: string | number): boolean {
    const success = this.timeline.jump(stageTarget, activityTarget);
    if (success && this.currentLesson) {
      const state = this.timeline.getState();
      this.publishEvent('TeacherJump', {
        lessonId: this.currentLesson.id,
        targetStageId: state.currentStage?.id || '',
        targetActivityId: state.currentActivity?.id,
        timestamp: Date.now(),
      });
    }
    return success;
  }

  public repeatStage(stageId: string): boolean {
    return this.jumpStage(stageId, 0);
  }

  public setPresentationMode(enabled: boolean): void {
    this.contextManager.setPresentationMode(enabled);
  }

  // ── Flow Model Operations ──────────────────────────────────────────────

  public addFlow(flow: Flow): void {
    if (!this.currentLesson) return;
    this.currentLesson.flows.push(flow);
    this.currentLesson.updatedAt = Date.now();
  }

  public removeFlow(flowId: string): boolean {
    if (!this.currentLesson) return false;
    const idx = this.currentLesson.flows.findIndex((f) => f.id === flowId);
    if (idx >= 0) {
      this.currentLesson.flows.splice(idx, 1);
      this.currentLesson.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  public copyFlow(flowId: string, newName?: string): Flow | null {
    if (!this.currentLesson) return null;
    const target = this.currentLesson.flows.find((f) => f.id === flowId);
    if (!target) return null;

    const cloned: Flow = {
      ...JSON.parse(JSON.stringify(target)),
      id: `flw_${globalThis.crypto.randomUUID()}`,
      name: newName || `${target.name} (副本)`,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.currentLesson.flows.push(cloned);
    return cloned;
  }

  public addStageToFlow(flowId: string, stage: Stage): boolean {
    if (!this.currentLesson) return false;
    const flow = this.currentLesson.flows.find((f) => f.id === flowId);
    if (!flow) return false;
    flow.stages.push(stage);
    flow.updatedAt = Date.now();
    if (this.activeFlow?.id === flowId) {
      this.timeline.loadFlow(flow);
    }
    return true;
  }

  public removeStageFromFlow(flowId: string, stageId: string): boolean {
    if (!this.currentLesson) return false;
    const flow = this.currentLesson.flows.find((f) => f.id === flowId);
    if (!flow) return false;
    const idx = flow.stages.findIndex((s) => s.id === stageId);
    if (idx >= 0) {
      flow.stages.splice(idx, 1);
      flow.updatedAt = Date.now();
      if (this.activeFlow?.id === flowId) {
        this.timeline.loadFlow(flow);
      }
      return true;
    }
    return false;
  }

  public copyStageInFlow(flowId: string, stageId: string): Stage | null {
    if (!this.currentLesson) return null;
    const flow = this.currentLesson.flows.find((f) => f.id === flowId);
    if (!flow) return null;
    const idx = flow.stages.findIndex((s) => s.id === stageId);
    if (idx < 0) return null;

    const source = flow.stages[idx];
    const cloned: Stage = {
      ...JSON.parse(JSON.stringify(source)),
      id: `stg_${globalThis.crypto.randomUUID()}`,
      title: `${source.title} (副本)`,
      completionStatus: 'pending',
    };

    flow.stages.splice(idx + 1, 0, cloned);
    flow.updatedAt = Date.now();
    if (this.activeFlow?.id === flowId) {
      this.timeline.loadFlow(flow);
    }
    return cloned;
  }

  public reorderStagesInFlow(flowId: string, fromIndex: number, toIndex: number): boolean {
    if (!this.currentLesson) return false;
    const flow = this.currentLesson.flows.find((f) => f.id === flowId);
    if (!flow || fromIndex < 0 || fromIndex >= flow.stages.length || toIndex < 0 || toIndex >= flow.stages.length) {
      return false;
    }

    const [moved] = flow.stages.splice(fromIndex, 1);
    flow.stages.splice(toIndex, 0, moved);
    flow.updatedAt = Date.now();
    if (this.activeFlow?.id === flowId) {
      this.timeline.loadFlow(flow);
    }
    return true;
  }

  // ── Helper Getters & Event Emitters ────────────────────────────────────

  public getCurrentLesson(): Lesson | null {
    return this.currentLesson;
  }

  public getActiveFlow(): Flow | null {
    return this.activeFlow;
  }

  private async publishEvent(eventType: string, payload: unknown): Promise<void> {
    const event: PlatformEvent = {
      id: globalThis.crypto.randomUUID(),
      type: eventType,
      source: 'lesson.runtime',
      payload,
      timestamp: Date.now(),
    };

    if (this.eventBus) {
      await this.eventBus.publish(event);
    }

    if (this.startTime > 0) {
      this.replayer.recordEvent(event, this.startTime);
    }
  }
}
