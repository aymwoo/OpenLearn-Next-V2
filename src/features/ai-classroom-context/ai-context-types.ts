/**
 * OpenLearn AI Classroom Context - Data Types & Contracts (Sprint P5-01)
 * Unified read-only snapshot interface for AI Assistant runtime.
 */

export interface AILessonContext {
  readonly lessonId: string;
  readonly title: string;
  readonly stage: string;
}

export interface AITeacherContext {
  readonly teacherId: string;
  readonly name: string;
  readonly status: string;
}

export interface AIStudentContext {
  readonly studentId: string;
  readonly name: string;
  readonly online: boolean;
}

export interface AIGroupContext {
  readonly groupId: string;
  readonly name: string;
  readonly studentIds: ReadonlyArray<string>;
}

export interface AIResourceContext {
  readonly resourceId: string;
  readonly title: string;
  readonly type: string;
}

export interface AIWhiteboardContext {
  readonly elementCount: number;
  readonly activeTool: string;
}

export interface AIActivityContext {
  readonly activeQuizId?: string;
  readonly activityType?: string;
}

export interface AIWorkspaceContext {
  readonly activeRegions: ReadonlyArray<string>;
  readonly visibleWidgets: ReadonlyArray<string>;
}

export interface AIAnalyticsSummaryContext {
  readonly totalInteractions: number;
  readonly averageEngagementScore: number;
}

export interface AIPluginContext {
  readonly activePluginIds: ReadonlyArray<string>;
}

export interface AIPermissionContext {
  readonly allowedCapabilities: ReadonlyArray<string>;
}

export interface AIClassroomContextSnapshot {
  readonly classroomId: string;
  readonly timestamp: number;
  readonly lesson: AILessonContext;
  readonly teacher: AITeacherContext;
  readonly students: ReadonlyArray<AIStudentContext>;
  readonly groups: ReadonlyArray<AIGroupContext>;
  readonly resources: ReadonlyArray<AIResourceContext>;
  readonly whiteboard: AIWhiteboardContext;
  readonly activities: AIActivityContext;
  readonly workspace: AIWorkspaceContext;
  readonly analyticsSummary: AIAnalyticsSummaryContext;
  readonly plugins: AIPluginContext;
  readonly permissions: AIPermissionContext;
  readonly extensionData: Readonly<Record<string, unknown>>;
}

export interface IAIContextProvider {
  readonly id: string;
  readonly name: string;
  readonly provideContext: (classroomCtx?: unknown) => Record<string, unknown>;
}
