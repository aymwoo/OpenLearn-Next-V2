/**
 * OpenLearn Platform Kernel - Lesson Session Types (Sprint A2)
 */

export type LessonSessionState =
  | 'Created'
  | 'Preparing'
  | 'Running'
  | 'Paused'
  | 'Resuming'
  | 'Completed'
  | 'Archived'
  | 'Disposed';

export interface LessonSessionContext {
  readonly sessionId: string;
  readonly lessonId: string;
  readonly teacherId: string;
  readonly studentIds: ReadonlyArray<string>;
  readonly courseId?: string;
  readonly whiteboardRef?: unknown;
  readonly aiContextRef?: unknown;
  readonly pluginContextRef?: unknown;
  readonly analyticsContextRef?: unknown;
  readonly platformContext?: unknown;
}

export interface LessonSessionDescriptor {
  readonly sessionId: string;
  readonly lessonId: string;
  readonly teacherId: string;
  readonly courseId?: string;
  readonly state: LessonSessionState;
  readonly startTime?: number;
  readonly endTime?: number;
}
