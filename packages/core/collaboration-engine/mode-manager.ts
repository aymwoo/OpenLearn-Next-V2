/**
 * OpenLearn Teaching Collaboration Engine - Mode Manager
 * Controls active collaboration mode ensuring only one mode is active at a time.
 */

import { CollaborationMode } from './types.js';
import { PermissionMatrixManager } from './permission-matrix.js';

export class CollaborationModeManager {
  private activeMode: CollaborationMode = 'Teacher Presentation';
  private permissionMatrix: PermissionMatrixManager;
  private listeners = new Set<(mode: CollaborationMode) => void>();

  constructor(permissionMatrix: PermissionMatrixManager) {
    this.permissionMatrix = permissionMatrix;
    // Set initial mode permissions
    this.permissionMatrix.applyModePermissions(this.activeMode);
  }

  public getActiveMode(): CollaborationMode {
    return this.activeMode;
  }

  public setMode(nextMode: CollaborationMode): void {
    if (this.activeMode === nextMode) return;

    this.activeMode = nextMode;
    this.permissionMatrix.applyModePermissions(nextMode);
    this.notify();
  }

  public subscribe(listener: (mode: CollaborationMode) => void): () => void {
    this.listeners.add(listener);
    listener(this.activeMode);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.activeMode);
      } catch (err: unknown) {
        console.error('[CollaborationModeManager] Listener error:', err);
      }
    }
  }
}
