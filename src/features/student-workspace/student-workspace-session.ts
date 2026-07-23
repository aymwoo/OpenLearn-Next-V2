/**
 * OpenLearn Student Workspace — Session Persistence (Sprint P6-01)
 *
 * Persists the student workspace session (opened widgets, layout, current
 * lesson, selected resources, activity state, AI conversation) to localStorage
 * and restores it automatically. Follows the same localStorage convention as
 * the existing Workspace LayoutStore.
 */

export interface StudentWorkspaceSessionData {
  readonly studentId: string;
  /** Widget ids currently opened in the workspace. */
  openedWidgets: string[];
  /** Lightweight slot → widget arrangement. */
  layout: Record<string, unknown>;
  currentLessonId?: string;
  selectedResourceIds: string[];
  activityState: Record<string, unknown>;
  aiConversation: ReadonlyArray<{ readonly role: string; readonly content: string }>;
  updatedAt: number;
}

const SESSION_KEY_PREFIX = 'openlearn_student_workspace_';

function defaultData(studentId: string): StudentWorkspaceSessionData {
  return {
    studentId,
    openedWidgets: [],
    layout: {},
    selectedResourceIds: [],
    activityState: {},
    aiConversation: [],
    updatedAt: Date.now(),
  };
}

export class StudentWorkspaceSession {
  private readonly key: string;

  constructor(studentId: string) {
    this.key = `${SESSION_KEY_PREFIX}${studentId}`;
  }

  public load(): StudentWorkspaceSessionData | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StudentWorkspaceSessionData;
      if (parsed.studentId !== this.studentIdFromKey()) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public save(data: StudentWorkspaceSessionData): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.key, JSON.stringify({ ...data, updatedAt: Date.now() }));
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  /** Load existing session (or default) and merge a partial patch, then save. */
  public update(patch: Partial<StudentWorkspaceSessionData>): StudentWorkspaceSessionData {
    const current = this.load() ?? defaultData(this.studentIdFromKey());
    const next: StudentWorkspaceSessionData = { ...current, ...patch, updatedAt: Date.now() };
    this.save(next);
    return next;
  }

  public clear(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.key);
    } catch {
      // Ignore storage errors
    }
  }

  private studentIdFromKey(): string {
    return this.key.slice(SESSION_KEY_PREFIX.length);
  }
}
