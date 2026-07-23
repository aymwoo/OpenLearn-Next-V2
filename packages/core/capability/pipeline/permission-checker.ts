/**
 * OpenLearn Capability Invocation Framework - Permission Checker
 * Role-based access control checking for Teacher, Student, Plugin, AI, Observer roles.
 */

import { CapabilityDescriptor, CapabilityRole } from '../types/index.js';

export class PermissionChecker {
  public static validatePermission(descriptor: CapabilityDescriptor, actorRole: CapabilityRole): boolean {
    if (!descriptor.permission || descriptor.permission.length === 0) {
      return true;
    }
    if (actorRole === 'System') {
      return true;
    }
    return descriptor.permission.includes(actorRole);
  }
}
