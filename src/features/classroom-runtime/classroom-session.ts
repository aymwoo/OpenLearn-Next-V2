/**
 * OpenLearn Classroom Runtime - Classroom Session (Sprint P4-01)
 * Manages 9-stage unified classroom lifecycle and coordinates 6 underlying runtimes.
 */

import { ClassroomStage, ClassroomEvent, IClassroomContext } from './classroom-types.js';

export type ClassroomEventListener = (event: ClassroomEvent) => void;

export class ClassroomSession {
  private context: IClassroomContext;
  private listeners: ClassroomEventListener[] = [];

  constructor(classroomId: string) {
    this.context = {
      classroomId,
      stage: 'Create',
    };
    this.emitEvent('ClassroomCreated');
  }

  public getContext(): Readonly<IClassroomContext> {
    return this.context;
  }

  public getStage(): ClassroomStage {
    return this.context.stage;
  }

  public attachRuntimes(runtimes: {
    lessonSession?: unknown;
    whiteboardEngine?: unknown;
    aiRuntime?: unknown;
    pluginHost?: unknown;
    analyticsEngine?: unknown;
    resourceRegistry?: unknown;
  }): void {
    if (runtimes.lessonSession) this.context.lessonSession = runtimes.lessonSession;
    if (runtimes.whiteboardEngine) this.context.whiteboardEngine = runtimes.whiteboardEngine;
    if (runtimes.aiRuntime) this.context.aiRuntime = runtimes.aiRuntime;
    if (runtimes.pluginHost) this.context.pluginHost = runtimes.pluginHost;
    if (runtimes.analyticsEngine) this.context.analyticsEngine = runtimes.analyticsEngine;
    if (runtimes.resourceRegistry) this.context.resourceRegistry = runtimes.resourceRegistry;
  }

  // 9-Stage State Machine Transitions
  public prepare(): void {
    this.assertValidTransition(['Create'], 'Prepare');
    this.context.stage = 'Prepare';
    this.emitEvent('ClassroomPrepared');
  }

  public ready(): void {
    this.assertValidTransition(['Prepare'], 'Ready');
    this.context.stage = 'Ready';
    this.emitEvent('ClassroomReady');
  }

  public startTeaching(): void {
    this.assertValidTransition(['Ready', 'Resumed'], 'Teaching');
    this.context.stage = 'Teaching';
    this.emitEvent('ClassroomTeaching');
  }

  public pause(): void {
    this.assertValidTransition(['Teaching'], 'Paused');
    this.context.stage = 'Paused';
    this.emitEvent('ClassroomPaused');
  }

  public resume(): void {
    this.assertValidTransition(['Paused'], 'Resumed');
    this.context.stage = 'Resumed';
    this.emitEvent('ClassroomResumed');
    this.startTeaching();
  }

  public finish(): void {
    this.assertValidTransition(['Teaching', 'Paused'], 'Finished');
    this.context.stage = 'Finished';
    this.emitEvent('ClassroomFinished');
  }

  public archive(): void {
    this.assertValidTransition(['Finished'], 'Archived');
    this.context.stage = 'Archived';
    this.emitEvent('ClassroomArchived');
  }

  public dispose(): void {
    this.context.stage = 'Disposed';
    this.emitEvent('ClassroomDisposed');
    this.listeners = [];
  }

  public addEventListener(listener: ClassroomEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(
    type: ClassroomEvent['type'],
    payload?: Record<string, unknown>
  ): void {
    const event: ClassroomEvent = {
      id: `evt_cls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      classroomId: this.context.classroomId,
      timestamp: Date.now(),
      payload,
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private assertValidTransition(allowedFrom: ClassroomStage[], target: ClassroomStage): void {
    if (!allowedFrom.includes(this.context.stage)) {
      throw new Error(
        `ClassroomSession Error: Invalid state transition from '${this.context.stage}' to '${target}'. Allowed from: [${allowedFrom.join(
          ', '
        )}].`
      );
    }
  }
}
