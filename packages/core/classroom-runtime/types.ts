/**
 * OpenLearn Classroom Runtime - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type RuntimeLifecycleState =
  | 'Create'
  | 'Initialize'
  | 'Prepare'
  | 'Running'
  | 'Pause'
  | 'Resume'
  | 'Stop'
  | 'Dispose';

export type RuntimeRole = 'Teacher' | 'Assistant' | 'Student' | 'Observer' | 'Plugin' | 'AI';

export type RuntimePermission =
  | 'lesson:control'
  | 'stage:navigate'
  | 'whiteboard:draw'
  | 'quiz:submit'
  | 'plugin:execute'
  | 'ai:invoke'
  | 'session:manage';

export interface UserParticipant {
  readonly id: string;
  readonly name: string;
  readonly role: RuntimeRole;
  readonly avatar?: string;
  readonly isOnline: boolean;
  readonly joinedAt: number;
}

export type ResourceType = 'image' | 'video' | 'audio' | 'pdf' | 'plugin' | 'ai';

export interface RuntimeResource {
  readonly id: string;
  readonly type: ResourceType;
  readonly url: string;
  readonly sizeBytes?: number;
  readonly status: 'pending' | 'loaded' | 'error';
  readonly cachedAt: number;
}

// ── State Tree Definition ──────────────────────────────────────────────────

export interface RuntimeStateTree {
  readonly runtime: {
    readonly id: string;
    readonly lifecycle: RuntimeLifecycleState;
    readonly startTime: number;
    readonly elapsedTime: number;
  };
  readonly lesson: {
    readonly activeLessonId?: string;
    readonly title?: string;
    readonly subject?: string;
    readonly status?: string;
  };
  readonly stage: {
    readonly activeStageId?: string;
    readonly index: number;
    readonly title?: string;
    readonly completionStatus?: string;
  };
  readonly activity: {
    readonly activeActivityId?: string;
    readonly type?: string;
    readonly status?: string;
  };
  readonly whiteboard: {
    readonly activeStageViewId?: string;
    readonly objectCount: number;
    readonly isLocked: boolean;
  };
  readonly teachingObjects: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly title: string;
  }>;
  readonly students: ReadonlyArray<UserParticipant>;
  readonly plugin: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }>;
  readonly ai: {
    readonly isGenerating: boolean;
    readonly lastPrompt?: string;
    readonly lastResponse?: string;
  };
  readonly analytics: {
    readonly totalInteractions: number;
    readonly activeStudentCount: number;
    readonly averageScore: number;
  };
}

// ── Event Bus Channels & Payloads ──────────────────────────────────────────

export interface RuntimeEventMap {
  SessionCreated: { readonly sessionId: string; readonly teacherId: string; readonly timestamp: number };
  StudentJoined: { readonly student: UserParticipant; readonly timestamp: number };
  StudentLeft: { readonly studentId: string; readonly timestamp: number };
  LessonStarted: { readonly lessonId: string; readonly timestamp: number };
  StageChanged: { readonly fromStageId?: string; readonly toStageId: string; readonly index: number; readonly timestamp: number };
  ObjectUpdated: { readonly objectId: string; readonly action: 'create' | 'update' | 'delete'; readonly timestamp: number };
  QuizSubmitted: { readonly studentId: string; readonly score: number; readonly timestamp: number };
  PluginLoaded: { readonly pluginId: string; readonly name: string; readonly timestamp: number };
  AIFinished: { readonly prompt: string; readonly response: string; readonly timestamp: number };
  NetworkDisconnected: { readonly actorId: string; readonly timestamp: number };
  RuntimePaused: { readonly elapsedTime: number; readonly timestamp: number };
  LifecycleChanged: { readonly from: RuntimeLifecycleState; readonly to: RuntimeLifecycleState; readonly timestamp: number };
}

export type RuntimeEventType = keyof RuntimeEventMap;

export interface RuntimeEventEnvelope<K extends RuntimeEventType = RuntimeEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: RuntimeEventMap[K];
  readonly source: string;
  readonly timestamp: number;
}

export type RuntimeEventSubscriber<K extends RuntimeEventType> = (
  event: RuntimeEventEnvelope<K>
) => void | Promise<void>;

// ── Service Interfaces ─────────────────────────────────────────────────────

export interface IRuntimeService {
  readonly serviceId: string;
  readonly name: string;
  initialize(context: RuntimeContextData): Promise<void>;
  dispose(): Promise<void>;
}

export interface ILessonService extends IRuntimeService {
  startLesson(lessonId: string): Promise<void>;
  pauseLesson(): Promise<void>;
  jumpStage(stageIndex: number): Promise<void>;
}

export interface IWhiteboardService extends IRuntimeService {
  setActiveStageView(stageId: string): Promise<void>;
  addObject(objectData: Record<string, unknown>): Promise<string>;
}

export interface IStudentService extends IRuntimeService {
  getOnlineStudents(): Promise<ReadonlyArray<UserParticipant>>;
  broadcastToStudents(message: Record<string, unknown>): Promise<void>;
}

export interface IPluginService extends IRuntimeService {
  loadPlugin(pluginId: string): Promise<void>;
  unloadPlugin(pluginId: string): Promise<void>;
}

export interface IAISystemService extends IRuntimeService {
  generateResponse(prompt: string): Promise<string>;
}

export interface IAnalyticsService extends IRuntimeService {
  recordInteraction(studentId: string, type: string, payload: Record<string, unknown>): Promise<void>;
  getSummary(): Promise<Record<string, unknown>>;
}

export interface IStorageService extends IRuntimeService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ISyncService extends IRuntimeService {
  syncState(state: RuntimeStateTree): Promise<void>;
}

// ── Module Interface ───────────────────────────────────────────────────────

export interface IRuntimeModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  initialize(context: RuntimeContextData): Promise<void>;
  start(context: RuntimeContextData): Promise<void>;
  stop(context: RuntimeContextData): Promise<void>;
  dispose(): Promise<void>;
}

// ── Scheduler Priority & Tasks ─────────────────────────────────────────────

export enum TaskPriority {
  Immediate = 0,
  High = 1,
  Normal = 2,
  Low = 3,
  Idle = 4,
}

export interface ScheduledTask<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly priority: TaskPriority;
  readonly taskFn: () => Promise<T>;
  readonly delayMs?: number;
  readonly maxRetries?: number;
  readonly createdAt: number;
}

// ── Runtime Hooks ──────────────────────────────────────────────────────────

export type RuntimeHookName =
  | 'beforeLessonStart'
  | 'afterLessonStart'
  | 'beforeStageChange'
  | 'afterStageChange'
  | 'beforePluginLoad'
  | 'afterPluginLoad'
  | 'beforeStudentJoin'
  | 'afterStudentJoin';

export type RuntimeHookCallback<T = Record<string, unknown>> = (
  payload: T,
  context: RuntimeContextData
) => void | Promise<void>;

// ── Context Interface ──────────────────────────────────────────────────────

export interface RuntimeContextData {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly courseId?: string;
  readonly lessonId?: string;
  readonly teacher?: UserParticipant;
  readonly currentUser?: UserParticipant;
  readonly role: RuntimeRole;
  readonly permissions: ReadonlyArray<RuntimePermission>;
  readonly lifecycleState: RuntimeLifecycleState;
}

// ── Snapshot & Recovery ────────────────────────────────────────────────────

export interface RuntimeSnapshot {
  readonly snapshotId: string;
  readonly timestamp: number;
  readonly stateTree: RuntimeStateTree;
  readonly activeServices: ReadonlyArray<string>;
  readonly loadedModules: ReadonlyArray<string>;
  readonly resources: ReadonlyArray<RuntimeResource>;
}
