/**
 * Global Frontend Event Map & Definitions
 *
 * Provides compile-time type safety, autocomplete, and contract boundaries for
 * in-process EventBus (Layer 1) and DOM CustomEvents (Layer 3).
 */

import type { ClassroomCountdownState } from '../services/classroom-sync-channel';
import type { StudentQuickActionItem } from '../features/student/types/quickActions';

/**
 * Registry of all typed in-process (FrontendEventBus) and DOM (CustomEvent) events.
 */
export interface FrontendEventMap {
  // ==========================================
  // Layer 1: In-Process Whiteboard Lifecycle
  // ==========================================
  'whiteboard.autosave.pending': { lessonId: string; timestamp?: number };
  'whiteboard.autosave.saving': { lessonId: string; timestamp?: number };
  'whiteboard.autosave.saved': { lessonId: string; version?: number; timestamp?: number };
  'whiteboard.autosave.error': { lessonId: string; error: string; timestamp?: number };
  'whiteboard.element_created': { elementId: string; type?: string; [key: string]: any };
  'whiteboard.element_updated': { elementId: string; [key: string]: any };
  'whiteboard.element_deleted': { elementId: string; [key: string]: any };
  'whiteboard.page_changed': { pageIndex: number };
  'whiteboard.page_added': { pageIndex: number };
  'whiteboard.page_deleted': { pageIndex: number };

  // ==========================================
  // Layer 1: Classroom & Rollcall Interaction
  // ==========================================
  'rollcall.picked': { studentId: string; studentName?: string; timestamp?: number; [key: string]: any };
  'rollcall.evaluated': { studentId: string; rating?: number; score?: number; [key: string]: any };
  'classroom.sync.status': { status: 'connected' | 'disconnected' | 'reconnecting'; error?: string };

  // ==========================================
  // Layer 3: Classroom Countdown (DOM CustomEvents)
  // ==========================================
  'openlearn:countdown:started': ClassroomCountdownState;
  'openlearn:countdown:updated': ClassroomCountdownState;
  'openlearn:countdown:paused': ClassroomCountdownState;
  'openlearn:countdown:resumed': ClassroomCountdownState;
  'openlearn:countdown:reset': ClassroomCountdownState;
  'openlearn:student:countdown_tick': {
    timeRemaining: number;
    totalDuration: number;
    label: string;
  };

  // ==========================================
  // Layer 3: Student Quick Actions (DOM CustomEvents)
  // ==========================================
  'openlearn:student_quick_actions:collapse': void;
  'openlearn:student_quick_actions:open': void;
  'openlearn:student_quick_actions:toggle_compact': void;
  'openlearn:student_quick_actions:compact_changed': {
    isCompact: boolean;
    isMobile: boolean;
    width: number;
    height: number;
  };
  'openlearn:student_quick_action:register': StudentQuickActionItem;
}

/**
 * Standard union of all known event keys
 */
export type FrontendEventType = keyof FrontendEventMap;

/**
 * Helper type to extract payload type for a given event key
 */
export type FrontendEventPayload<K extends FrontendEventType> = FrontendEventMap[K];
