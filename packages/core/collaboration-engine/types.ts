/**
 * OpenLearn Teaching Collaboration Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type ParticipantRole =
  | 'Teacher'
  | 'Teaching Assistant'
  | 'Student'
  | 'Observer'
  | 'AI Tutor'
  | 'AI Assistant'
  | 'Plugin';

export type CollaborationPermission =
  | 'Whiteboard Edit'
  | 'Whiteboard View'
  | 'Comment'
  | 'Annotation'
  | 'Run Code'
  | 'Submit Quiz'
  | 'Create Object'
  | 'Delete Object'
  | 'Broadcast'
  | 'Group Switch'
  | 'Teacher Review'
  | 'AI Operation';

export type CollaborationMode =
  | 'Teacher Presentation'
  | 'Teacher + Student'
  | 'Student Independent'
  | 'Small Group'
  | 'Whole Class'
  | 'Teacher Review'
  | 'AI Assisted';

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly role: ParticipantRole;
  readonly isOnline: boolean;
  readonly currentGroupId?: string;
  readonly lastActive: number;
  readonly lastHeartbeat: number;
  readonly metadata: Record<string, unknown>;
}

export interface GroupWorkspaceData {
  readonly workspaceId: string;
  readonly groupId: string;
  readonly canvasState: Record<string, unknown>;
  readonly teachingObjects: ReadonlyArray<Record<string, unknown>>;
  readonly timelinePosition: number;
  readonly pluginState: Record<string, unknown>;
  readonly aiContext: Record<string, unknown>;
}

export interface GroupData {
  readonly id: string;
  readonly name: string;
  readonly memberIds: ReadonlyArray<string>;
  readonly leaderId?: string;
  readonly workspaceId: string;
  readonly createdAt: number;
}

export interface SharedObjectData {
  readonly id: string;
  readonly sourceGroupId?: string;
  readonly targetGroupIds: ReadonlyArray<string>;
  readonly mode: 'sync' | 'copy' | 'mirror' | 'reference';
  readonly content: Record<string, unknown>;
  readonly version: number;
}

export interface ObjectLock {
  readonly objectId: string;
  readonly lockedBy: string;
  readonly lockedAt: number;
  readonly expiresAt: number;
}

export type SyncType =
  | 'object_sync'
  | 'selection_sync'
  | 'viewport_sync'
  | 'pointer_sync'
  | 'stage_sync'
  | 'lesson_sync';

export interface SyncMessage<T = unknown> {
  readonly id: string;
  readonly type: SyncType;
  readonly payload: T;
  readonly senderId: string;
  readonly timestamp: number;
}

export interface CollaborationAnalyticsData {
  participationCount: number;
  editCount: number;
  discussionCount: number;
  teacherPatrolCount: number;
  groupSwitchCount: number;
  broadcastCount: number;
}

// ── Collaboration Event Map ────────────────────────────────────────────────

export interface CollaborationEventMap {
  ParticipantJoined: { readonly participant: Participant; readonly timestamp: number };
  ParticipantLeft: { readonly participantId: string; readonly timestamp: number };
  PermissionChanged: { readonly role: ParticipantRole; readonly permissions: ReadonlyArray<CollaborationPermission>; readonly timestamp: number };
  GroupCreated: { readonly group: GroupData; readonly timestamp: number };
  GroupChanged: { readonly groupId: string; readonly action: string; readonly timestamp: number };
  TeacherPatrol: { readonly teacherId: string; readonly targetGroupId: string; readonly action: 'enter' | 'leave' | 'annotate' | 'takeover'; readonly timestamp: number };
  BroadcastStarted: { readonly broadcastType: string; readonly sourceId: string; readonly targetGroupIds: ReadonlyArray<string>; readonly timestamp: number };
  BroadcastFinished: { readonly broadcastId: string; readonly timestamp: number };
  WorkspaceMerged: { readonly sourceWorkspaceId: string; readonly targetWorkspaceId: string; readonly timestamp: number };
  ResultCollected: { readonly groupResults: ReadonlyArray<Record<string, unknown>>; readonly timestamp: number };
}

export type CollaborationEventType = keyof CollaborationEventMap;

export interface CollaborationEventEnvelope<K extends CollaborationEventType = CollaborationEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: CollaborationEventMap[K];
  readonly source: string;
  readonly timestamp: number;
}

export type CollaborationEventSubscriber<K extends CollaborationEventType> = (
  event: CollaborationEventEnvelope<K>
) => void | Promise<void>;
