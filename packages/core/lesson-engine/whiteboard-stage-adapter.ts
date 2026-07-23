/**
 * OpenLearn Lesson Flow Engine - Whiteboard Stage Adapter
 * Binds Whiteboard pages directly to Lesson Engine Stages.
 * Each Stage owns an independent Canvas slice with cross-stage object sharing.
 */

export interface CanvasElementData {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: unknown;
  style?: Record<string, unknown>;
  isShared?: boolean;
  sourceStageId?: string;
  sharedStageIds?: string[];
}

export interface StageCanvasView {
  stageId: string;
  stageTitle: string;
  elements: CanvasElementData[];
  backgroundColor?: string;
  viewport?: { x: number; y: number; zoom: number };
  updatedAt: number;
}

export class WhiteboardStageAdapter {
  private stageViews = new Map<string, StageCanvasView>();
  private sharedObjects = new Map<string, CanvasElementData>();

  /**
   * Get or initialize a canvas view for a specific Stage.
   */
  public getStageView(stageId: string, stageTitle = 'Stage View'): StageCanvasView {
    let view = this.stageViews.get(stageId);
    if (!view) {
      view = {
        stageId,
        stageTitle,
        elements: [],
        backgroundColor: '#ffffff',
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: Date.now(),
      };
      this.stageViews.set(stageId, view);
    }
    return this.resolveSharedElements(view);
  }

  /**
   * Update the canvas view for a stage.
   */
  public updateStageView(stageId: string, partialView: Partial<StageCanvasView>): StageCanvasView {
    const existing = this.getStageView(stageId);
    const updated: StageCanvasView = {
      ...existing,
      ...partialView,
      elements: partialView.elements ? [...partialView.elements] : existing.elements,
      updatedAt: Date.now(),
    };

    this.stageViews.set(stageId, updated);
    return updated;
  }

  /**
   * Share an element/object across multiple stages.
   */
  public shareObjectAcrossStages(element: CanvasElementData, targetStageIds: string[]): void {
    const sharedElement: CanvasElementData = {
      ...element,
      isShared: true,
      sharedStageIds: targetStageIds,
    };

    this.sharedObjects.set(element.id, sharedElement);

    for (const stageId of targetStageIds) {
      const view = this.getStageView(stageId);
      const exists = view.elements.some((e) => e.id === element.id);
      if (!exists) {
        view.elements.push(sharedElement);
        view.updatedAt = Date.now();
        this.stageViews.set(stageId, view);
      }
    }
  }

  /**
   * Remove a shared object from a specific stage or all stages.
   */
  public unshareObject(elementId: string, targetStageId?: string): void {
    if (targetStageId) {
      const view = this.stageViews.get(targetStageId);
      if (view) {
        view.elements = view.elements.filter((e) => e.id !== elementId);
        this.stageViews.set(targetStageId, view);
      }
    } else {
      this.sharedObjects.delete(elementId);
      for (const [sId, view] of this.stageViews.entries()) {
        view.elements = view.elements.filter((e) => e.id !== elementId);
        this.stageViews.set(sId, view);
      }
    }
  }

  /**
   * Copy canvas view from source stage to target stage.
   */
  public copyStageView(sourceStageId: string, targetStageId: string, targetTitle: string): StageCanvasView {
    const source = this.getStageView(sourceStageId);
    const targetElements = source.elements.map((el) => ({
      ...el,
      id: el.isShared ? el.id : `elem_${globalThis.crypto.randomUUID()}`,
      sourceStageId: targetStageId,
    }));

    const newView: StageCanvasView = {
      stageId: targetStageId,
      stageTitle: targetTitle,
      elements: targetElements,
      backgroundColor: source.backgroundColor,
      viewport: source.viewport ? { ...source.viewport } : undefined,
      updatedAt: Date.now(),
    };

    this.stageViews.set(targetStageId, newView);
    return newView;
  }

  /**
   * Clear canvas for a stage.
   */
  public clearStageView(stageId: string): void {
    const view = this.stageViews.get(stageId);
    if (view) {
      view.elements = view.elements.filter((e) => e.isShared);
      view.updatedAt = Date.now();
      this.stageViews.set(stageId, view);
    }
  }

  /**
   * Merge shared elements dynamically when returning stage view.
   */
  private resolveSharedElements(view: StageCanvasView): StageCanvasView {
    const elementsMap = new Map<string, CanvasElementData>();

    // Add elements specific to view
    for (const elem of view.elements) {
      elementsMap.set(elem.id, elem);
    }

    // Add shared elements targeting this stage
    for (const [id, sharedElem] of this.sharedObjects.entries()) {
      if (sharedElem.sharedStageIds?.includes(view.stageId)) {
        elementsMap.set(id, sharedElem);
      }
    }

    return {
      ...view,
      elements: Array.from(elementsMap.values()),
    };
  }
}
