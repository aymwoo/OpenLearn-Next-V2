/**
 * OpenLearn AI Teaching Workflow - Orchestrator (Sprint P5-04)
 * Orchestrates AI participation across 6 core subsystems without duplicate logic or hardcoded prompts.
 */

import { AIParticipantRole, AITeachingWorkflowPhase, AIParticipationState } from './ai-workflow-types.js';

export class AITeachingWorkflowOrchestrator {
  private state: AIParticipationState;

  constructor(classroomId: string, initialRole: AIParticipantRole = 'Tutor') {
    this.state = {
      classroomId,
      role: initialRole,
      phase: 'PreLesson',
      subsystems: Object.freeze(['Lesson', 'Workspace', 'Whiteboard', 'Analytics', 'Activity', 'Resource']),
    };
  }

  public getState(): Readonly<AIParticipationState> {
    return this.state;
  }

  public setRole(role: AIParticipantRole): void {
    this.state.role = role;
  }

  public advancePhase(phase: AITeachingWorkflowPhase): void {
    this.state.phase = phase;
  }

  public getParticipatingSubsystems(): ReadonlyArray<string> {
    return this.state.subsystems;
  }
}
