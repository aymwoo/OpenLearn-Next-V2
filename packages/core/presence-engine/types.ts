/**
 * OpenLearn Presence Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type EntityType =
  | 'teacher'
  | 'student'
  | 'assistant'
  | 'ai'
  | 'plugin'
  | 'whiteboard'
  | 'teaching_object'
  | 'lesson'
  | 'stage'
  | 'group';

export type EntityRole = 'teacher' | 'student' | 'assistant' | 'ai' | 'plugin' | 'system';

export type FocusState = 'Focused' | 'Distracted' | 'Inactive' | 'Minimized' | 'Background';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'offline';

export type InteractionSignal = 'Raise Hand' | 'Question' | 'Agree' | 'Disagree' | 'Need Help' | 'Finished' | 'None';

export type TeacherStatus =
  | 'Preparing'
  | 'Teaching'
  | 'Explaining'
  | 'Writing'
  | 'Observing'
  | 'Reviewing'
  | 'Answering'
  | 'Discussing'
  | 'Waiting'
  | 'Offline';

export type StudentStatus =
  | 'Online'
  | 'Offline'
  | 'Reconnecting'
  | 'Idle'
  | 'Listening'
  | 'Writing'
  | 'Coding'
  | 'Answering'
  | 'Discussing'
  | 'Watching'
  | 'Presenting'
  | 'Finished'
  | 'Need Help'
  | 'Away';

export type AIStatus =
  | 'Idle'
  | 'Thinking'
  | 'Generating'
  | 'Explaining'
  | 'Evaluating'
  | 'Waiting'
  | 'Unavailable';

export type PluginStatus = 'Loading' | 'Running' | 'Paused' | 'Error' | 'Finished';

export type WhiteboardStatus = 'Editing' | 'Presenting' | 'Locked' | 'ReadOnly' | 'Collaborating';

export type StageStatus = 'Waiting' | 'Running' | 'Completed' | 'Paused' | 'Skipped';

export type GroupStatus = 'Active' | 'Idle' | 'Discussing' | 'Finished';

export type EntityStatus =
  | TeacherStatus
  | StudentStatus
  | AIStatus
  | PluginStatus
  | WhiteboardStatus
  | StageStatus
  | GroupStatus
  | string;

export interface PresenceEntity<TStatus extends string = EntityStatus> {
  readonly id: string;
  readonly type: EntityType;
  readonly status: TStatus;
  readonly activity: string;
  readonly focus: FocusState;
  readonly role: EntityRole;
  readonly permission: ReadonlyArray<string>;
  readonly lastActive: number;
  readonly lastHeartbeat: number;
  readonly connectionState: ConnectionState;
  readonly interactionSignal?: InteractionSignal;
  readonly device?: {
    readonly type: string;
    readonly os?: string;
    readonly browser?: string;
  };
  readonly network?: {
    readonly latencyMs?: number;
    readonly quality?: 'good' | 'fair' | 'poor';
  };
  readonly location?: {
    readonly classroomId?: string;
    readonly seatNumber?: string;
  };
  readonly metadata: Record<string, unknown>;
}

export interface GroupPresenceData {
  readonly groupId: string;
  readonly name: string;
  readonly onlineCount: number;
  readonly activeCount: number;
  readonly discussionStatus: 'idle' | 'active' | 'paused';
  readonly taskProgress: number; // 0 to 100
  readonly isCompleted: boolean;
  readonly members: ReadonlyArray<string>;
}

export interface PresenceDashboardMetrics {
  readonly onlineCount: number;
  readonly activeCount: number;
  readonly focusCount: number;
  readonly handRaiseCount: number;
  readonly helpRequestCount: number;
  readonly taskCompletionRate: number;
  readonly aiWorkStatus: AIStatus;
  readonly activePluginCount: number;
  readonly timestamp: number;
}

export interface PresencePrivacyConfig {
  readonly permissionRequired: boolean;
  readonly anonymousMode: boolean;
  readonly disableCollection: boolean;
  readonly retentionDays: number;
}

export interface PresenceDiff {
  readonly entityId: string;
  readonly changes: Partial<PresenceEntity>;
  readonly timestamp: number;
}

export interface PresenceTimelineFrame {
  readonly timestamp: number;
  readonly entityId: string;
  readonly previousStatus: string;
  readonly currentStatus: string;
  readonly activity: string;
}

// ── Presence Event Map ─────────────────────────────────────────────────────

export interface PresenceEventMap {
  PresenceChanged: { readonly entityId: string; readonly previous: PresenceEntity; readonly current: PresenceEntity };
  StudentOnline: { readonly studentId: string; readonly timestamp: number };
  StudentOffline: { readonly studentId: string; readonly timestamp: number };
  TeacherChanged: { readonly teacherId: string; readonly newStatus: TeacherStatus; readonly timestamp: number };
  PluginRunning: { readonly pluginId: string; readonly status: PluginStatus; readonly timestamp: number };
  FocusChanged: { readonly entityId: string; readonly focus: FocusState; readonly timestamp: number };
  HelpRequested: { readonly studentId: string; readonly message?: string; readonly timestamp: number };
  HandRaised: { readonly studentId: string; readonly signal: InteractionSignal; readonly timestamp: number };
  HeartbeatTimeout: { readonly entityId: string; readonly lastHeartbeat: number; readonly timestamp: number };
}

export type PresenceEventType = keyof PresenceEventMap;

export interface PresenceEventEnvelope<K extends PresenceEventType = PresenceEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: PresenceEventMap[K];
  readonly source: string;
  readonly timestamp: number;
}

export type PresenceEventSubscriber<K extends PresenceEventType> = (
  event: PresenceEventEnvelope<K>
) => void | Promise<void>;

// ── Plugin SDK Presence Definition ────────────────────────────────────────

export interface CustomPresenceDefinition {
  readonly type: EntityType | string;
  readonly name: string;
  readonly defaultStatus: string;
  readonly rolesAllowed: ReadonlyArray<EntityRole>;
  readonly providerFn?: (entityId: string) => Promise<Partial<PresenceEntity>>;
}
