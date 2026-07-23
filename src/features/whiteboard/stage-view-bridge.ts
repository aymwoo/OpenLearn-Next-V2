/**
 * OpenLearn Lesson Flow Engine - Whiteboard Stage View Bridge
 * Connects Whiteboard canvas model to Lesson Engine Stages.
 * Replaces page management with Stage View management.
 */

import { useLessonEngineStore } from '../lesson-engine/lessonEngineStore.js';
import { StageCanvasView, CanvasElementData } from '../../packages/core/lesson-engine/whiteboard-stage-adapter.js';

export class WhiteboardStageBridge {
  /**
   * Get the Whiteboard Canvas View corresponding to the currently active Stage.
   */
  public getActiveStageCanvasView(): StageCanvasView | null {
    const store = useLessonEngineStore.getState();
    const stage = store.currentStage;
    if (!stage) return null;

    return store.runtime.whiteboardAdapter.getStageView(stage.id, stage.title);
  }

  /**
   * Update the Whiteboard elements for the currently active Stage.
   */
  public updateActiveStageElements(elements: CanvasElementData[]): void {
    const store = useLessonEngineStore.getState();
    const stage = store.currentStage;
    if (!stage) return;

    store.runtime.whiteboardAdapter.updateStageView(stage.id, { elements });
  }

  /**
   * Share an element from current Stage to other Stages in the active Flow.
   */
  public shareElementToOtherStages(element: CanvasElementData, targetStageIds?: string[]): void {
    const store = useLessonEngineStore.getState();
    const activeFlow = store.activeFlow;
    if (!activeFlow) return;

    const targets = targetStageIds || activeFlow.stages.map((s) => s.id);
    store.runtime.whiteboardAdapter.shareObjectAcrossStages(element, targets);
  }
}

export const whiteboardStageBridge = new WhiteboardStageBridge();
