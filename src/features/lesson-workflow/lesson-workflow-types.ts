/**
 * OpenLearn Teacher Lesson Workflow - Data Types & Contracts (Sprint P3-02)
 */

export type LessonWorkflowStage =
  | 'Prepare'
  | 'Start'
  | 'Teach'
  | 'Interact'
  | 'Assess'
  | 'Summarize'
  | 'Complete';

export interface LessonWorkflowState {
  lessonId: string;
  stage: LessonWorkflowStage;
  activeCoursewareId?: string;
  activeWhiteboardId?: string;
  aiAssistantActive: boolean;
  analyticsActive: boolean;
}
