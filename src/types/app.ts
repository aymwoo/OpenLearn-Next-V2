/**
 * Shared type definitions for the OpenLearnV2 application.
 *
 * Consolidates all type aliases previously scattered across App.tsx and appStore.ts.
 * Import from this file instead of redefining types locally.
 */

// ── Core entities ──────────────────────────────────────────────────────────

export type Lesson = {
  id: string;
  title: string;
  content: string;
  timeline?: string;
  created_at?: number;
  enrollment_count?: number;
};

export type WhiteboardElement = {
  id: string;
  type: string;
  data: string;
};

export type PluginType = {
  id: string;
  name: string;
  status: string;
  created_at: number;
  manifest: string;
  execution_mode?: string;
};

export type VFSNode = {
  id: string;
  parent_id: string | null;
  type: 'file' | 'dir';
  name: string;
  content?: string;
};

export type ProcessType = {
  id: string;
  name: string;
  status: string;
  created_at: number;
  updated_at: number;
};

// ── Class & student ────────────────────────────────────────────────────────

export type ClassType = {
  id: string;
  name: string;
  description: string;
  class_passcode?: string | null;
  created_at: number;
};

export type StudentType = {
  id: string;
  name: string;
  email: string;
  password?: string;
  locked_lesson_id?: string | null;
  private_notes?: string | null;
  created_at: number;
};

// ── Assignments & submissions ──────────────────────────────────────────────

export type AssignmentType = {
  id: string;
  class_id: string;
  title: string;
  description: string;
  content: string;
  created_at: number;
};

export type SubmissionType = {
  assignment_id: string;
  student_id: string;
  student_name?: string;
  content: string;
  score: number | null;
  feedback: string | null;
  status: string;
};

// ── Schedules & attendance ─────────────────────────────────────────────────

export type ScheduleType = {
  id: string;
  class_id: string;
  lesson_id: string;
  lesson_title: string;
  scheduled_date: string;
  created_at: number;
};

export type AttendanceType = {
  schedule_id: string;
  student_id: string;
  student_name: string;
  status: string;
  recorded_at: number;
};

// ── Progress ───────────────────────────────────────────────────────────────

export type StudentProgressType = {
  student_id: string;
  lesson_id: string;
  lesson_title: string;
  completed: number;
  progress_percent: number;
  assigned_at: number;
};

// ── AI ─────────────────────────────────────────────────────────────────────

export type AIProvider = {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  model_name: string;
  created_at: number;
  updated_at: number;
};

// ── Session ────────────────────────────────────────────────────────────────

export interface SessionType {
  role: 'teacher' | 'student';
  userId?: string;
  username?: string;
  subRole?: 'administrator' | 'teacher';
  name: string;
  studentId?: string;
  email?: string;
}

// ── Toast ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}
