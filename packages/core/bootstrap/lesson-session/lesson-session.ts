/**
 * OpenLearn Platform Kernel - Lesson Session Object (Sprint A2)
 * Primary runtime object managed by Platform Kernel.
 */

import {
  LessonSessionState,
  LessonSessionContext,
  LessonSessionDescriptor,
} from './lesson-session-types.js';

export class LessonSession {
  private _state: LessonSessionState = 'Created';
  private _context: LessonSessionContext;
  private _startTime?: number;
  private _endTime?: number;

  constructor(context: LessonSessionContext) {
    this._context = context;
    this._state = 'Created';
  }

  public get sessionId(): string {
    return this._context.sessionId;
  }

  public get lessonId(): string {
    return this._context.lessonId;
  }

  public get state(): LessonSessionState {
    return this._state;
  }

  public get context(): LessonSessionContext {
    return this._context;
  }

  public descriptor(): LessonSessionDescriptor {
    return {
      sessionId: this.sessionId,
      lessonId: this.lessonId,
      teacherId: this._context.teacherId,
      courseId: this._context.courseId,
      state: this._state,
      startTime: this._startTime,
      endTime: this._endTime,
    };
  }

  public prepare(): void {
    this.assertState(['Created']);
    this._state = 'Preparing';
  }

  public start(): void {
    this.assertState(['Created', 'Preparing']);
    this._state = 'Running';
    this._startTime = Date.now();
  }

  public pause(): void {
    this.assertState(['Running']);
    this._state = 'Paused';
  }

  public resume(): void {
    this.assertState(['Paused']);
    this._state = 'Running';
  }

  public complete(): void {
    this.assertState(['Running', 'Paused']);
    this._state = 'Completed';
    this._endTime = Date.now();
  }

  public archive(): void {
    this.assertState(['Completed']);
    this._state = 'Archived';
  }

  public dispose(): void {
    this._state = 'Disposed';
  }

  public attachAIContext(aiContext: unknown): void {
    (this._context as any).aiContextRef = aiContext;
  }

  public attachWhiteboard(whiteboardRef: unknown): void {
    (this._context as any).whiteboardRef = whiteboardRef;
  }

  public attachPluginContext(pluginContext: unknown): void {
    (this._context as any).pluginContextRef = pluginContext;
  }

  public attachAnalyticsContext(analyticsContext: unknown): void {
    (this._context as any).analyticsContextRef = analyticsContext;
  }

  private assertState(allowedStates: LessonSessionState[]): void {
    if (this._state === 'Disposed') {
      throw new Error(`LessonSession error: Session '${this.sessionId}' has been disposed.`);
    }
    if (!allowedStates.includes(this._state)) {
      throw new Error(
        `Invalid state transition for LessonSession '${this.sessionId}'. Current: '${this._state}', Allowed: [${allowedStates.join(', ')}]`
      );
    }
  }
}
