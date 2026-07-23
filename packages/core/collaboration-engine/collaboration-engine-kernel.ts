/**
 * OpenLearn Teaching Collaboration Engine Kernel
 * Master orchestrator connecting Participants, Permissions, Modes, Groups, Workspaces, Patrol, Broadcast, Sync, and Conflicts.
 */

import { ParticipantManager } from './participant-manager.js';
import { PermissionMatrixManager } from './permission-matrix.js';
import { CollaborationModeManager } from './mode-manager.js';
import { GroupWorkspaceStore } from './group-workspace.js';
import { GroupManager } from './group-manager.js';
import { TeacherPatrolManager } from './teacher-patrol.js';
import { BroadcastCollectManager } from './broadcast-collect.js';
import { SharedObjectManager } from './shared-object-manager.js';
import { ConflictResolver } from './conflict-resolver.js';
import { SynchronizationEngine } from './sync-engine.js';
import { CollaborationAnalyticsHook } from './analytics-hook.js';
import { CollaborationEventBus } from './collaboration-event-bus.js';
import { CollaborationPermission, CollaborationMode } from './types.js';

export class CollaborationEngineKernel {
  public readonly participantManager: ParticipantManager;
  public readonly permissionMatrix: PermissionMatrixManager;
  public readonly modeManager: CollaborationModeManager;
  public readonly workspaceStore: GroupWorkspaceStore;
  public readonly groupManager: GroupManager;
  public readonly teacherPatrol: TeacherPatrolManager;
  public readonly broadcastCollect: BroadcastCollectManager;
  public readonly sharedObjectManager: SharedObjectManager;
  public readonly conflictResolver: ConflictResolver;
  public readonly syncEngine: SynchronizationEngine;
  public readonly analyticsHook: CollaborationAnalyticsHook;
  public readonly eventBus: CollaborationEventBus;

  private registeredProviders = new Map<string, unknown>();
  private registeredWorkspaces = new Map<string, unknown>();
  private registeredGroupTypes = new Map<string, unknown>();

  constructor() {
    this.eventBus = new CollaborationEventBus();
    this.participantManager = new ParticipantManager();
    this.permissionMatrix = new PermissionMatrixManager();
    this.modeManager = new CollaborationModeManager(this.permissionMatrix);
    this.workspaceStore = new GroupWorkspaceStore();
    this.groupManager = new GroupManager(this.workspaceStore);
    this.teacherPatrol = new TeacherPatrolManager(this.workspaceStore);
    this.broadcastCollect = new BroadcastCollectManager(this.workspaceStore);
    this.sharedObjectManager = new SharedObjectManager();
    this.conflictResolver = new ConflictResolver();
    this.syncEngine = new SynchronizationEngine();
    this.analyticsHook = new CollaborationAnalyticsHook();
  }

  // ── SDK Extension API ──────────────────────────────────────────────────

  public registerCollaborationProvider(providerId: string, provider: unknown): void {
    this.registeredProviders.set(providerId, provider);
  }

  public registerPermission(role: import('./types.js').ParticipantRole, permission: CollaborationPermission): void {
    this.permissionMatrix.grantPermission(role, permission);
  }

  public registerWorkspace(typeId: string, workspaceTemplate: unknown): void {
    this.registeredWorkspaces.set(typeId, workspaceTemplate);
  }

  public registerGroupType(groupType: string, config: unknown): void {
    this.registeredGroupTypes.set(groupType, config);
  }

  // ── Teacher Controls Shortcuts ─────────────────────────────────────────

  public lockStudent(studentId: string): void {
    const student = this.participantManager.getParticipant(studentId);
    if (student) {
      this.permissionMatrix.revokePermission('Student', 'Whiteboard Edit');
      this.permissionMatrix.revokePermission('Student', 'Create Object');
    }
  }

  public unlockStudent(studentId: string): void {
    const student = this.participantManager.getParticipant(studentId);
    if (student) {
      this.permissionMatrix.grantPermission('Student', 'Whiteboard Edit');
      this.permissionMatrix.grantPermission('Student', 'Create Object');
    }
  }

  public freezeWhiteboard(): void {
    this.modeManager.setMode('Teacher Review');
  }

  public recoverWhiteboard(previousMode: CollaborationMode = 'Teacher + Student'): void {
    this.modeManager.setMode(previousMode);
  }

  public dispose(): void {
    this.eventBus.clear();
    this.participantManager.clear();
    this.workspaceStore.clear();
    this.groupManager.dissolveAll();
    this.analyticsHook.reset();
  }
}
