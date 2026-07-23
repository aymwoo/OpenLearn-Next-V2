/**
 * OpenLearn Teacher Lesson Workflow - Orchestrator (Sprint P3-02)
 * Orchestrates existing capabilities across Lesson, Workspace, Whiteboard, AI, Plugin, and Analytics.
 */

import { LessonWorkflowStage, LessonWorkflowState } from './lesson-workflow-types.js';

export class LessonWorkflowOrchestrator {
  private state: LessonWorkflowState;
  private runtimes: Record<string, unknown>;

  constructor(lessonId: string, runtimes: Record<string, unknown> = {}) {
    this.state = {
      lessonId,
      stage: 'Prepare',
      aiAssistantActive: true,
      analyticsActive: true,
    };
    this.runtimes = runtimes;
  }

  public getState(): Readonly<LessonWorkflowState> {
    return this.state;
  }

  public advanceStage(targetStage: LessonWorkflowStage): void {
    this.state.stage = targetStage;
  }

  public setCourseware(coursewareId: string): void {
    this.state.activeCoursewareId = coursewareId;
  }

  public setWhiteboard(whiteboardId: string): void {
    this.state.activeWhiteboardId = whiteboardId;
  }

  public getRuntime(key: string): unknown {
    return this.runtimes[key];
  }
}
