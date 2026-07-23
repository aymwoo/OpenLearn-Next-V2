/**
 * OpenLearn Classroom Runtime - Permission Subsystem
 * Unified role and permission checking for Teacher, Assistant, Student, Observer, Plugin, AI.
 */

import { RuntimeRole, RuntimePermission } from './types.js';

export class RuntimePermissionManager {
  private rolePermissions = new Map<RuntimeRole, Set<RuntimePermission>>([
    [
      'Teacher',
      new Set<RuntimePermission>([
        'lesson:control',
        'stage:navigate',
        'whiteboard:draw',
        'quiz:submit',
        'plugin:execute',
        'ai:invoke',
        'session:manage',
      ]),
    ],
    [
      'Assistant',
      new Set<RuntimePermission>([
        'stage:navigate',
        'whiteboard:draw',
        'quiz:submit',
        'plugin:execute',
        'ai:invoke',
      ]),
    ],
    [
      'Student',
      new Set<RuntimePermission>([
        'whiteboard:draw', // drawing / editing on the whiteboard
        'quiz:submit', // activity & assessment submission
        'ai:invoke', // AI learning assistant access
        'plugin:execute', // student-facing plugin usage
      ]),
    ],
    [
      'Observer',
      new Set<RuntimePermission>([]),
    ],
    [
      'Plugin',
      new Set<RuntimePermission>(['whiteboard:draw', 'plugin:execute', 'ai:invoke']),
    ],
    [
      'AI',
      new Set<RuntimePermission>(['stage:navigate', 'whiteboard:draw', 'ai:invoke']),
    ],
  ]);

  /**
   * Check if a role possesses the specified permission.
   */
  public hasPermission(role: RuntimeRole, permission: RuntimePermission): boolean {
    const permissions = this.rolePermissions.get(role);
    if (!permissions) return false;
    return permissions.has(permission);
  }

  /**
   * Grant a permission to a role dynamically.
   */
  public grantPermission(role: RuntimeRole, permission: RuntimePermission): void {
    if (!this.rolePermissions.has(role)) {
      this.rolePermissions.set(role, new Set());
    }
    this.rolePermissions.get(role)!.add(permission);
  }

  /**
   * Revoke a permission from a role dynamically.
   */
  public revokePermission(role: RuntimeRole, permission: RuntimePermission): void {
    const permissions = this.rolePermissions.get(role);
    if (permissions) {
      permissions.delete(permission);
    }
  }

  /**
   * Get all permissions assigned to a role.
   */
  public getRolePermissions(role: RuntimeRole): ReadonlyArray<RuntimePermission> {
    const permissions = this.rolePermissions.get(role);
    if (!permissions) return Object.freeze([]);
    return Object.freeze(Array.from(permissions));
  }
}
