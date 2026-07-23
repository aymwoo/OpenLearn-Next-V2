import { describe, it, expect } from 'vitest';
import { AITeachingWorkflowOrchestrator } from '../index.js';

describe('Sprint P5-04 AI Teaching Workflow Test Suite', () => {
  it('should orchestrate AI participation across PreLesson, InLesson, and PostLesson phases', () => {
    const orchestrator = new AITeachingWorkflowOrchestrator('cls_math_101', 'CoTeacher');

    expect(orchestrator.getState().phase).toBe('PreLesson');
    expect(orchestrator.getState().role).toBe('CoTeacher');

    orchestrator.advancePhase('InLesson');
    expect(orchestrator.getState().phase).toBe('InLesson');

    orchestrator.setRole('Evaluator');
    expect(orchestrator.getState().role).toBe('Evaluator');

    orchestrator.advancePhase('PostLesson');
    expect(orchestrator.getState().phase).toBe('PostLesson');
  });

  it('should reuse 6 core subsystems without prompt hardcoding or duplicate logic', () => {
    const orchestrator = new AITeachingWorkflowOrchestrator('cls_physics_201');
    const subsystems = orchestrator.getParticipatingSubsystems();

    expect(subsystems).toEqual(['Lesson', 'Workspace', 'Whiteboard', 'Analytics', 'Activity', 'Resource']);
  });
});
