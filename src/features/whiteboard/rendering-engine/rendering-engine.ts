import type { CanvasObject, CanvasPage, Viewport } from '../canvas-model/types.js';
import type { PerformanceStats, RenderContext } from './types.js';
import { rendererRegistry } from './registry/renderer-registry.js';
import { renderScheduler } from './pipeline/render-scheduler.js';
import { virtualRenderer } from './virtualization/virtual-renderer.js';
import { dirtyRegionManager } from './dirty/dirty-region-manager.js';
import { layerRenderer } from './layers/layer-renderer.js';
import { cacheManager } from './cache/cache-manager.js';
import { imageManager } from './image/image-manager.js';
import { textEngine } from './text/text-engine.js';
import { hitTestEngine } from './hit-test/hit-test-engine.js';
import { animationManager } from './animation/animation-manager.js';
import { performanceMonitor } from './perf/performance-monitor.js';
import { highDPIController } from './dpi/high-dpi-controller.js';
import { exportService } from './export/export-service.js';
import { themeManager } from './theme/theme-manager.js';
import { devToolsPanel } from './debug/dev-tools-panel.js';

export class RenderingEngine {
  readonly registry = rendererRegistry;
  readonly scheduler = renderScheduler;
  readonly virtualization = virtualRenderer;
  readonly dirtyRegion = dirtyRegionManager;
  readonly layers = layerRenderer;
  readonly cache = cacheManager;
  readonly images = imageManager;
  readonly text = textEngine;
  readonly hitTest = hitTestEngine;
  readonly animation = animationManager;
  readonly perf = performanceMonitor;
  readonly dpi = highDPIController;
  readonly export = exportService;
  readonly theme = themeManager;
  readonly devTools = devToolsPanel;

  /**
   * Main Render Pipeline Entry
   * Collect -> Sort Layer -> Sort Z -> Viewport Cull -> Render Queue -> Batch Draw -> Commit
   */
  public executeRenderPipeline(
    page: CanvasPage,
    viewport: Viewport,
    containerSize: { width: number; height: number },
    selectedIds: string[] = []
  ): { visibleObjects: CanvasObject[]; stats: PerformanceStats } {
    const startTime = performance.now();

    // 1. Group objects by Layer & ZIndex
    const layerGroups = this.layers.groupObjectsByLayer(page);

    // 2. Flatten sorted objects
    const sortedObjects: CanvasObject[] = [];
    layerGroups.forEach((g) => {
      sortedObjects.push(...g.objects);
    });

    // 3. Viewport Culling
    const { visible: visibleObjects } = this.virtualization.cullObjects(
      sortedObjects,
      viewport,
      containerSize
    );

    // 4. Record Performance Stats
    const renderTimeMs = performance.now() - startTime;
    this.perf.recordFrame(
      renderTimeMs,
      visibleObjects.length,
      visibleObjects.length,
      sortedObjects.length
    );

    return {
      visibleObjects,
      stats: this.perf.getStats(),
    };
  }

  /**
   * Create Render Context for Renderers
   */
  public createRenderContext(viewport: Viewport, selectedIds: string[] = []): RenderContext {
    return {
      viewport,
      theme: this.theme.getTokens(),
      dpr: this.dpi.getDPR(),
      isSelectionActive: selectedIds.length > 0,
      selectedIds,
    };
  }
}

export const renderingEngine = new RenderingEngine();
