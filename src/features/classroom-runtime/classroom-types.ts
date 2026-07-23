/**
 * OpenLearn Classroom Runtime - Data Types & Contracts (Sprint P4-01)
 */

export type ClassroomStage =
  | 'Create'
  | 'Prepare'
  | 'Ready'
  | 'Teaching'
  | 'Paused'
  | 'Resumed'
  | 'Finished'
  | 'Archived'
  | 'Disposed';

export interface ClassroomEvent {
  readonly id: string;
  readonly type:
    | 'ClassroomCreated'
    | 'ClassroomPrepared'
    | 'ClassroomReady'
    | 'ClassroomTeaching'
    | 'ClassroomPaused'
    | 'ClassroomResumed'
    | 'ClassroomFinished'
    | 'ClassroomArchived'
    | 'ClassroomDisposed';
  readonly classroomId: string;
  readonly timestamp: number;
  readonly payload?: Record<string, unknown>;
}

export interface IClassroomContext {
  readonly classroomId: string;
  stage: ClassroomStage;
  lessonSession?: unknown;
  whiteboardEngine?: unknown;
  aiRuntime?: unknown;
  pluginHost?: unknown;
  analyticsEngine?: unknown;
  resourceRegistry?: unknown;
}

export interface ClassroomServiceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly execute: (context: IClassroomContext, params?: Record<string, unknown>) => unknown;
}

export interface ClassroomActionExtension {
  readonly id: string;
  readonly name: string;
  readonly handler: (context: IClassroomContext, params?: Record<string, unknown>) => unknown;
}
