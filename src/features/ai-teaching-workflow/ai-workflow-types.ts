/**
 * OpenLearn AI Teaching Workflow - Data Types & Contracts (Sprint P5-04)
 */

export type AIParticipantRole = 'Tutor' | 'CoTeacher' | 'Evaluator' | 'Observer';

export type AITeachingWorkflowPhase = 'PreLesson' | 'InLesson' | 'PostLesson';

export interface AIParticipationState {
  classroomId: string;
  role: AIParticipantRole;
  phase: AITeachingWorkflowPhase;
  subsystems: ReadonlyArray<string>;
}
