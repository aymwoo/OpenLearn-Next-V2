import type { CanvasLayer, CanvasObject, CanvasPage } from '../../canvas-model/types.js';

export interface RenderLayerGroup {
  layer: CanvasLayer;
  objects: CanvasObject[];
}

export class LayerRenderer {
  /**
   * Group and sort objects by layer zIndex and object zIndex
   */
  public groupObjectsByLayer(page: CanvasPage): RenderLayerGroup[] {
    const layerMap = new Map<string, { layer: CanvasLayer; objects: CanvasObject[] }>();

    page.layers.forEach((layer) => {
      layerMap.set(layer.id, { layer, objects: [] });
    });

    Object.values(page.objects).forEach((obj) => {
      const layerGroup = layerMap.get(obj.layerId);
      if (layerGroup) {
        layerGroup.objects.push(obj);
      } else {
        // Fallback to default layer
        const defaultGroup = layerMap.get('layer-default');
        if (defaultGroup) defaultGroup.objects.push(obj);
      }
    });

    const groups = Array.from(layerMap.values()).filter((g) => g.layer.visible);

    // Sort layers by zIndex
    groups.sort((a, b) => a.layer.zIndex - b.layer.zIndex);

    // Sort objects within each layer by zIndex
    groups.forEach((g) => {
      g.objects.sort((a, b) => a.zIndex - b.zIndex);
    });

    return groups;
  }
}

export const layerRenderer = new LayerRenderer();
