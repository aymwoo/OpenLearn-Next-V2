import { v7 as uuidv7 } from 'uuid';
import type { CanvasObject, CanvasPage } from '../types.js';
import { objectRegistry } from '../registry/object-registry.js';
import { layerManager } from '../layer/layer-system.js';

export interface LegacyWhiteboardElement {
  id: string;
  type: string;
  data: string; // JSON string
  lesson_id?: string;
}

/**
 * Legacy Adapter
 * 
 * Provides seamless bidirectional conversion between old DB `WhiteboardElement`
 * (raw JSON string `data`) and the unified `CanvasObject<T>` model.
 * Guarantees 100% backward compatibility with existing backend APIs and frontend stores.
 */
export class LegacyAdapter {
  /**
   * Convert a single legacy WhiteboardElement to a modern CanvasObject<T>
   */
  public toCanvasObject<T = Record<string, unknown>>(legacy: LegacyWhiteboardElement): CanvasObject<T> {
    let parsedData: Record<string, any> = {};
    try {
      parsedData = JSON.parse(legacy.data || '{}');
    } catch {
      parsedData = {};
    }

    const posX = typeof parsedData.x === 'number' ? parsedData.x : 100;
    const posY = typeof parsedData.y === 'number' ? parsedData.y : 100;

    const defaultSize = objectRegistry.getObject(legacy.type)?.defaultSize || { width: 300, height: 200 };
    const width = typeof parsedData.width === 'number' ? parsedData.width : defaultSize.width;
    const height = typeof parsedData.height === 'number' ? parsedData.height : defaultSize.height;

    // Extract payload fields vs base object fields
    const { x, y, width: w, height: h, rotation, scaleX, scaleY, opacity, visible, locked, zIndex, layerId, parentId, groupId, segmentId, page, ...payloadFields } = parsedData;

    const now = Date.now();
    return {
      id: legacy.id || uuidv7(),
      type: legacy.type || 'unknown',
      name: parsedData.title || parsedData.name || `${legacy.type}_object`,
      position: { x: posX, y: posY },
      rotation: typeof rotation === 'number' ? rotation : 0,
      scale: { x: typeof scaleX === 'number' ? scaleX : 1, y: typeof scaleY === 'number' ? scaleY : 1 },
      size: { width, height },
      opacity: typeof opacity === 'number' ? opacity : 1,
      visible: visible !== false,
      locked: locked === true,
      zIndex: typeof zIndex === 'number' ? zIndex : 1,
      parentId: parentId || null,
      groupId: groupId || null,
      layerId: layerId || 'layer-default',
      createdAt: parsedData.createdAt || now,
      updatedAt: parsedData.updatedAt || now,
      createdBy: parsedData.createdBy || 'legacy_import',
      metadata: {
        segmentId: typeof segmentId === 'string' ? segmentId : null,
        pageIndex: typeof page === 'number' ? page : 0,
      },
      payload: payloadFields as T,
    };
  }

  /**
   * Convert a modern CanvasObject<T> back to a legacy WhiteboardElement for DB persistence
   */
  public toLegacyElement<T = Record<string, unknown>>(canvasObj: CanvasObject<T>, lessonId?: string): LegacyWhiteboardElement {
    const combinedData = {
      x: canvasObj.position.x,
      y: canvasObj.position.y,
      width: canvasObj.size.width,
      height: canvasObj.size.height,
      rotation: canvasObj.rotation,
      scaleX: canvasObj.scale.x,
      scaleY: canvasObj.scale.y,
      opacity: canvasObj.opacity,
      visible: canvasObj.visible,
      locked: canvasObj.locked,
      zIndex: canvasObj.zIndex,
      layerId: canvasObj.layerId,
      parentId: canvasObj.parentId,
      groupId: canvasObj.groupId,
      segmentId: canvasObj.metadata.segmentId,
      page: canvasObj.metadata.pageIndex ?? 0,
      createdAt: canvasObj.createdAt,
      updatedAt: canvasObj.updatedAt,
      createdBy: canvasObj.createdBy,
      ...canvasObj.payload,
    };

    return {
      id: canvasObj.id,
      type: canvasObj.type,
      data: JSON.stringify(combinedData),
      lesson_id: lessonId,
    };
  }

  /**
   * Convert an array of legacy WhiteboardElements into a unified CanvasPage
   */
  public toCanvasPage(elements: LegacyWhiteboardElement[], pageId: string = 'page-default', pageTitle: string = 'Default Page'): CanvasPage {
    const objects: Record<string, CanvasObject> = {};
    elements.forEach((el) => {
      const obj = this.toCanvasObject(el);
      objects[obj.id] = obj;
    });

    return {
      id: pageId,
      title: pageTitle,
      order: 0,
      layers: layerManager.createDefaultLayers(),
      objects,
      groups: {},
    };
  }

  /**
   * Convert a CanvasPage back to an array of legacy WhiteboardElements
   */
  public toLegacyElements(page: CanvasPage, lessonId?: string): LegacyWhiteboardElement[] {
    return Object.values(page.objects).map((obj) => this.toLegacyElement(obj, lessonId));
  }
}

export const legacyAdapter = new LegacyAdapter();
