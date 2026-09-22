import React from 'react';

/**
 * Badge variant styles for student quick action items
 */
export type QuickActionBadgeVariant = 'rose' | 'amber' | 'emerald' | 'indigo' | 'blue' | 'slate';

/**
 * Action category classification
 */
export type QuickActionCategory = 'live' | 'assignment' | 'tool' | 'notification' | 'plugin' | 'custom';

/**
 * Interface representing a student quick action contributed by third-party plugins or built-in modules
 */
export interface StudentQuickActionItem {
  /**
   * Unique identifier for the quick action
   */
  id: string;

  /**
   * Primary title displayed on the action card
   */
  title: string;

  /**
   * Optional descriptive subtitle
   */
  description?: string;

  /**
   * Icon element or Lucide icon name (e.g. 'Sparkles', 'BookOpen', 'BrainCircuit')
   */
  icon?: string | React.ReactNode;

  /**
   * Optional badge text (e.g. 'NEW', 'AI', 'PRO') or numerical count
   */
  badge?: string | number;

  /**
   * Badge color style
   */
  badgeVariant?: QuickActionBadgeVariant;

  /**
   * Category grouping
   */
  category?: QuickActionCategory;

  /**
   * Higher priority actions appear first (default: 0)
   */
  priority?: number;

  /**
   * Click handler function
   */
  onClick?: (context?: any) => void;

  /**
   * CommandBus command type to execute when clicked (if using OS Command Bus)
   */
  commandType?: string;

  /**
   * CommandBus command payload
   */
  commandPayload?: any;

  /**
   * Whether the action is visible in compact mobile mode
   */
  visibleOnMobile?: boolean;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Optional custom JSX renderer for the entire card
   */
  customRenderer?: (action: StudentQuickActionItem, context: any) => React.ReactNode;
}

/**
 * Global Registry for Third-Party Plugins to contribute to Student Quick Actions
 */
export class StudentQuickActionsRegistry {
  private static instance: StudentQuickActionsRegistry;
  private actions = new Map<string, StudentQuickActionItem>();
  private listeners = new Set<(actions: StudentQuickActionItem[]) => void>();
  private compactModeListeners = new Set<(isCompact: boolean) => void>();
  private isCompact = false;

  public static getInstance(): StudentQuickActionsRegistry {
    if (!StudentQuickActionsRegistry.instance) {
      StudentQuickActionsRegistry.instance = new StudentQuickActionsRegistry();
    }
    return StudentQuickActionsRegistry.instance;
  }

  /**
   * Register a new quick action item from a third-party plugin
   */
  public registerAction(action: StudentQuickActionItem): () => void {
    this.actions.set(action.id, action);
    this.notifyActionChange();

    return () => {
      this.unregisterAction(action.id);
    };
  }

  /**
   * Unregister an existing quick action item
   */
  public unregisterAction(actionId: string): void {
    if (this.actions.delete(actionId)) {
      this.notifyActionChange();
    }
  }

  /**
   * Get all registered actions sorted by priority descending
   */
  public getActions(): StudentQuickActionItem[] {
    return Array.from(this.actions.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Subscribe to registry changes
   */
  public subscribe(listener: (actions: StudentQuickActionItem[]) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getActions());
    } catch (e) {
      console.warn('[StudentQuickActionsRegistry] Subscriber initial call failed:', e);
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Set compact mode state
   */
  public setCompactMode(compact: boolean): void {
    if (this.isCompact !== compact) {
      this.isCompact = compact;
      for (const listener of this.compactModeListeners) {
        try {
          listener(compact);
        } catch (e) {
          console.warn('[StudentQuickActionsRegistry] Compact listener error:', e);
        }
      }
    }
  }

  public getCompactMode(): boolean {
    return this.isCompact;
  }

  public onCompactModeChange(listener: (isCompact: boolean) => void): () => void {
    this.compactModeListeners.add(listener);
    return () => {
      this.compactModeListeners.delete(listener);
    };
  }

  /**
   * Collapse the Quick Actions floating menu programmatically
   */
  public collapseMenu(reason = 'programmatic'): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('openlearn:student_quick_actions:collapse', {
          detail: { reason },
        }),
      );
    }
  }

  /**
   * Open the Quick Actions floating menu programmatically
   */
  public openMenu(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openlearn:student_quick_actions:open'));
    }
  }

  private notifyActionChange(): void {
    const list = this.getActions();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (e) {
        console.warn('[StudentQuickActionsRegistry] Listener error:', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('openlearn:student_quick_actions:changed', {
          detail: { actions: list },
        }),
      );
    }
  }
}

export const studentQuickActionsRegistry = StudentQuickActionsRegistry.getInstance();
