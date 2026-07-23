import type { CanvasObject } from '../canvas-model/types.js';

export type TeachingCategory =
  | 'content'
  | 'programming'
  | 'interactive'
  | 'learning'
  | 'ai'
  | 'plugin';

export interface TeachingCapabilities {
  editable: boolean;
  runnable: boolean;
  answerable: boolean;
  scorable: boolean;
  collaborative: boolean;
  presentable: boolean;
  replayable: boolean;
  evaluatable: boolean;
  aiEditable: boolean;
  pluginExtendable: boolean;
}

export interface TeachingMetadata {
  title?: string;
  description?: string;
  author?: string;
  subject?: string;
  grade?: string;
  chapter?: string;
  knowledgePoint?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'olympiad';
  teachingGoal?: string;
  keywords?: string[];
  tags?: string[];
  language?: string;
  permission?: 'public' | 'teacher_only' | 'student_writable';
  pluginSource?: string;
  aiGenerated?: boolean;
  version?: string;
}

export type TeachingRole = 'teacher' | 'student' | 'observer';

export type PresentationMode =
  | 'present'
  | 'hide'
  | 'focus'
  | 'highlight'
  | 'lock_student'
  | 'teacher_only'
  | 'student_only';

export type TeachingLifecycleStage =
  | 'Create'
  | 'Initialize'
  | 'Mount'
  | 'Activate'
  | 'Update'
  | 'Deactivate'
  | 'Destroy';

export type TeachingRuntimeStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'finished';

/**
 * Teaching Object — High-Level Extension of CanvasObject<T>
 */
export interface TeachingObject<T = Record<string, unknown>> extends CanvasObject<T> {
  category: TeachingCategory;
  capabilities: TeachingCapabilities;
  teachingMetadata: TeachingMetadata;
  lifecycleStage: TeachingLifecycleStage;
  runtimeStatus: TeachingRuntimeStatus;
}

export interface AssessmentResult {
  objectId: string;
  studentId: string;
  score: number;
  maxScore: number;
  feedback?: string;
  submittedAt: number;
  isPassed: boolean;
  analytics?: Record<string, unknown>;
}

export interface LearningAnalyticsRecord {
  objectId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  participantCount: number;
  submissionCount: number;
  completionRate: number; // 0.0 - 1.0
  errorRate: number; // 0.0 - 1.0
  aiAnalysisSummary?: string;
}
