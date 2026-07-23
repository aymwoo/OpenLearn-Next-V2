/**
 * OpenLearn Teaching Collaboration Engine - Permission Matrix
 * Dynamic role-permission matrix supporting runtime permission toggles per mode or role.
 */

import { ParticipantRole, CollaborationPermission, CollaborationMode } from './types.js';

export class PermissionMatrixManager {
  private matrix = new Map<ParticipantRole, Set<CollaborationPermission>>([
    [
      'Teacher',
      new Set<CollaborationPermission>([
        'Whiteboard Edit',
        'Whiteboard View',
        'Comment',
        'Annotation',
        'Run Code',
        'Submit Quiz',
        'Create Object',
        'Delete Object',
        'Broadcast',
        'Group Switch',
        'Teacher Review',
        'AI Operation',
      ]),
    ],
    [
      'Teaching Assistant',
      new Set<CollaborationPermission>([
        'Whiteboard Edit',
        'Whiteboard View',
        'Comment',
        'Annotation',
        'Run Code',
        'Create Object',
        'Broadcast',
        'Teacher Review',
        'AI Operation',
      ]),
    ],
    [
      'Student',
      new Set<CollaborationPermission>([
        'Whiteboard View',
        'Whiteboard Edit',
        'Comment',
        'Run Code',
        'Submit Quiz',
        'Create Object',
      ]),
    ],
    [
      'Observer',
      new Set<CollaborationPermission>(['Whiteboard View']),
    ],
    [
      'AI Tutor',
      new Set<CollaborationPermission>([
        'Whiteboard View',
        'Comment',
        'Annotation',
        'AI Operation',
      ]),
    ],
    [
      'AI Assistant',
      new Set<CollaborationPermission>([
        'Whiteboard View',
        'Comment',
        'Annotation',
        'AI Operation',
      ]),
    ],
    [
      'Plugin',
      new Set<CollaborationPermission>([
        'Whiteboard Edit',
        'Whiteboard View',
        'Create Object',
        'Run Code',
      ]),
    ],
  ]);

  public hasPermission(role: ParticipantRole, permission: CollaborationPermission): boolean {
    const perms = this.matrix.get(role);
    if (!perms) return false;
    return perms.has(permission);
  }

  public grantPermission(role: ParticipantRole, permission: CollaborationPermission): void {
    if (!this.matrix.has(role)) {
      this.matrix.set(role, new Set());
    }
    this.matrix.get(role)!.add(permission);
  }

  public revokePermission(role: ParticipantRole, permission: CollaborationPermission): void {
    const perms = this.matrix.get(role);
    if (perms) {
      perms.delete(permission);
    }
  }

  public getRolePermissions(role: ParticipantRole): ReadonlyArray<CollaborationPermission> {
    const perms = this.matrix.get(role);
    if (!perms) return Object.freeze([]);
    return Object.freeze(Array.from(perms));
  }

  /**
   * Adjust permissions dynamically based on active Collaboration Mode.
   */
  public applyModePermissions(mode: CollaborationMode): void {
    if (mode === 'Teacher Presentation') {
      this.revokePermission('Student', 'Whiteboard Edit');
      this.revokePermission('Student', 'Create Object');
      this.grantPermission('Student', 'Whiteboard View');
    } else if (mode === 'Teacher + Student' || mode === 'Small Group' || mode === 'Whole Class') {
      this.grantPermission('Student', 'Whiteboard Edit');
      this.grantPermission('Student', 'Create Object');
      this.grantPermission('Student', 'Run Code');
    } else if (mode === 'Teacher Review') {
      this.revokePermission('Student', 'Whiteboard Edit');
      this.grantPermission('Student', 'Whiteboard View');
    }
  }
}
