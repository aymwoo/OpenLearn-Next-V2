import type { CanvasLayer, CanvasObject, CanvasPage, LayerType } from '../types.js';

export class LayerManager {
  /**
   * Create default set of layers for a new CanvasPage
   */
  public createDefaultLayers(): CanvasLayer[] {
    return [
      {
        id: 'layer-background',
        name: 'Background Layer',
        type: 'background',
        visible: true,
        locked: true,
        zIndex: 0,
        opacity: 1,
        objectIds: [],
      },
      {
        id: 'layer-default',
        name: 'Main Content Layer',
        type: 'default',
        visible: true,
        locked: false,
        zIndex: 1,
        opacity: 1,
        objectIds: [],
      },
      {
        id: 'layer-plugin',
        name: 'Plugin Widgets Layer',
        type: 'plugin',
        visible: true,
        locked: false,
        zIndex: 2,
        opacity: 1,
        objectIds: [],
      },
      {
        id: 'layer-ai',
        name: 'AI Agent Layer',
        type: 'ai',
        visible: true,
        locked: false,
        zIndex: 3,
        opacity: 1,
        objectIds: [],
      },
    ];
  }

  /**
   * Sort all objects in a page by Layer Z-Index and Object Z-Index
   */
  public getSortedObjects(page: CanvasPage): CanvasObject[] {
    const layerMap = new Map<string, CanvasLayer>();
    page.layers.forEach((layer) => layerMap.set(layer.id, layer));

    const objects = Object.values(page.objects).filter((obj) => {
      const layer = layerMap.get(obj.layerId);
      if (!layer) return true; // Default fallback visible
      return layer.visible && obj.visible;
    });

    return objects.sort((a, b) => {
      const layerA = layerMap.get(a.layerId);
      const layerB = layerMap.get(b.layerId);
      const layerZIndexA = layerA ? layerA.zIndex : 1;
      const layerZIndexB = layerB ? layerB.zIndex : 1;

      if (layerZIndexA !== layerZIndexB) {
        return layerZIndexA - layerZIndexB;
      }
      return a.zIndex - b.zIndex;
    });
  }

  /**
   * Toggle visibility of a layer
   */
  public setLayerVisibility(page: CanvasPage, layerId: string, visible: boolean): CanvasPage {
    return {
      ...page,
      layers: page.layers.map((l) => (l.id === layerId ? { ...l, visible } : l)),
    };
  }

  /**
   * Toggle lock state of a layer
   */
  public setLayerLock(page: CanvasPage, layerId: string, locked: boolean): CanvasPage {
    return {
      ...page,
      layers: page.layers.map((l) => (l.id === layerId ? { ...l, locked } : l)),
    };
  }
}

export const layerManager = new LayerManager();
