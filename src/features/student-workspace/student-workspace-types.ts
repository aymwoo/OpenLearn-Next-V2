/**
 * OpenLearn Student Workspace — Shared Types (Sprint P6-01)
 *
 * Reuses the existing Classroom Runtime role/permission vocabulary. The Student
 * Workspace shares the same Workspace Shell and Classroom Runtime as the Teacher
 * Workspace; only permissions, layout and exposed capabilities differ.
 */

import type { RuntimePermission, RuntimeRole } from '../../../packages/core/classroom-runtime/types.js';

export type StudentWorkspaceLang = 'en' | 'zh';

export interface StudentUserIdentity {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string;
}

export interface StudentWorkspaceInit {
  readonly student: StudentUserIdentity;
  readonly lessonId?: string;
  readonly courseId?: string;
  readonly teacherId?: string;
  readonly teacherName?: string;
  readonly lang?: StudentWorkspaceLang;
  /** Automatically restore the persisted session on mount. */
  readonly autoRestore?: boolean;
  /** Optional frontend plugin host — enables plugin widget/extension support. */
  readonly pluginHost?: unknown;
}

/**
 * Restricted, read-only view of the classroom context exposed to a student.
 * It intentionally exposes only permitted information and never duplicates
 * runtime state — it is derived from the shared Classroom Runtime context.
 */
export interface StudentView {
  readonly studentId: string;
  readonly studentName: string;
  readonly role: RuntimeRole;
  readonly lessonId?: string;
  readonly courseId?: string;
  readonly permissions: ReadonlyArray<RuntimePermission>;
}
