/**
 * OpenLearn Lesson Flow Engine - Domain Types
 */

export type LessonStatus = 'draft' | 'ready' | 'active' | 'paused' | 'completed';
export type StageCompletionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type ActivityStatus = 'idle' | 'active' | 'paused' | 'completed' | 'skipped';
export type UserRole = 'teacher' | 'student' | 'administrator' | 'assistant';

export interface UserRef {
  id: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export interface StudentAction {
  id: string;
  studentId: string;
  studentName: string;
  stageId: string;
  activityId?: string;
  actionType: 'answer' | 'quiz_submit' | 'discussion_post' | 'hand_raise' | 'interaction';
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface TeachingObject {
  id: string;
  type: string; // e.g., 'whiteboard_element', 'document', 'geogebra_model', 'code_snippet', 'quiz_card'
  title: string;
  content: unknown;
  metadata?: Record<string, unknown>;
  sharedAcrossStages?: string[]; // stage IDs where this object is shared
}

export interface ActivityConfig {
  autoAdvance?: boolean;
  timeoutSeconds?: number;
  allowStudentInteraction?: boolean;
  customProps?: Record<string, unknown>;
}

export interface Activity {
  id: string;
  type: string; // e.g. 'video', 'image', 'python', 'quiz', 'discussion', 'ai_question', 'web_browse', 'geogebra'
  title: string;
  config: ActivityConfig;
  status: ActivityStatus;
  teachingObjects: TeachingObject[];
  metadata?: Record<string, unknown>;
}

export interface StageAnalytics {
  completionRate: number; // 0 to 100
  participantCount: number;
  elapsedTimeSeconds: number;
  interactionCount: number;
  quizScores: Array<{ studentId: string; score: number; maxScore: number }>;
  discussionHeat: number; // 0 to 100 rating
}

export interface Stage {
  id: string;
  title: string;
  estimatedDurationSeconds: number;
  teachingGoals: string[];
  knowledgePoints: string[];
  completionStatus: StageCompletionStatus;
  assignee: 'teacher' | 'student' | 'group' | string;
  activities: Activity[];
  locked?: boolean;
  metadata?: Record<string, unknown>;
  analytics?: StageAnalytics;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  version: number;
  stages: Stage[];
  isCurrent?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Lesson {
  id: string;
  title: string;
  subject: string;
  grade: string;
  teacher: UserRef;
  durationMinutes: number;
  status: LessonStatus;
  flows: Flow[];
  activeFlowId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface LessonSnapshot {
  id: string;
  lessonId: string;
  timestamp: number;
  lessonState: Lesson;
  activeFlowId: string;
  activeStageId: string;
  activeActivityId?: string;
  elapsedSeconds: number;
  whiteboardData?: Record<string, unknown>;
}

export type LessonEventType =
  | 'LessonStarted'
  | 'LessonPaused'
  | 'LessonEnded'
  | 'StageEntered'
  | 'StageFinished'
  | 'ActivityStarted'
  | 'ActivityFinished'
  | 'ActivitySkipped'
  | 'TeacherJump'
  | 'StudentSynced';

export interface LessonEventPayloads {
  LessonStarted: { lessonId: string; flowId: string; timestamp: number };
  LessonPaused: { lessonId: string; elapsedSeconds: number; timestamp: number };
  LessonEnded: { lessonId: string; totalDurationSeconds: number; timestamp: number };
  StageEntered: { lessonId: string; flowId: string; stageId: string; stageIndex: number; timestamp: number };
  StageFinished: { lessonId: string; flowId: string; stageId: string; analytics: StageAnalytics; timestamp: number };
  ActivityStarted: { lessonId: string; stageId: string; activityId: string; timestamp: number };
  ActivityFinished: { lessonId: string; stageId: string; activityId: string; timestamp: number };
  ActivitySkipped: { lessonId: string; stageId: string; activityId: string; timestamp: number };
  TeacherJump: { lessonId: string; targetStageId: string; targetActivityId?: string; timestamp: number };
  StudentSynced: { lessonId: string; studentId: string; stageId: string; activityId?: string; timestamp: number };
}

export interface ActivityDefinition {
  type: string;
  name: string;
  description: string;
  category: 'media' | 'coding' | 'assessment' | 'collaboration' | 'simulation' | 'ai' | 'custom';
  icon?: string;
  defaultConfig?: ActivityConfig;
  onStart?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
  onPause?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
  onEnd?: (activity: Activity, context: TeachingContextData) => void | Promise<void>;
}

export interface TeachingContextData {
  currentLesson?: Lesson;
  currentFlow?: Flow;
  currentStage?: Stage;
  currentActivity?: Activity;
  teacher?: UserRef;
  currentUser?: UserRef;
  role: UserRole;
  isPresentationMode: boolean;
}
