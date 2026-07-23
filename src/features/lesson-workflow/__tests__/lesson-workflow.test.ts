import { describe, it, expect } from 'vitest';
import { LessonWorkflowOrchestrator } from '../index.js';

describe('Sprint P3-02 Lesson Workflow Test Suite', () => {
  it('should orchestrate teacher lesson workflow stages cleanly', () => {
    const orchestrator = new LessonWorkflowOrchestrator('les_math_101', {
      lessonRuntime: { id: 'lr_1' },
      whiteboardEngine: { id: 'wb_1' },
    });

    expect(orchestrator.getState().stage).toBe('Prepare');

    orchestrator.setCourseware('cw_calculus_pdf');
    orchestrator.setWhiteboard('wb_stage_1');
    expect(orchestrator.getState().activeCoursewareId).toBe('cw_calculus_pdf');
    expect(orchestrator.getState().activeWhiteboardId).toBe('wb_stage_1');

    orchestrator.advanceStage('Teach');
    expect(orchestrator.getState().stage).toBe('Teach');

    orchestrator.advanceStage('Interact');
    expect(orchestrator.getState().stage).toBe('Interact');

    orchestrator.advanceStage('Complete');
    expect(orchestrator.getState().stage).toBe('Complete');
  });
});
