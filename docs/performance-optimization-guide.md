# OpenLearn Whiteboard Performance Optimization Guide

> **Target Capacity**: 10,000+ Canvas Objects @ 60 FPS  
> **Status**: Approved & Integrated

---

## 1. Performance Strategies

### 1. Viewport Culling (`VirtualRenderer`)
Only canvas objects within the current camera viewport bounds are processed for rendering:

```ts
const { visible } = virtualRenderer.cullObjects(objects, viewport, containerSize);
```

### 2. Time-Sliced Scheduling (`RenderScheduler`)
Large batches of object renders are split across 12ms frame slices via `requestAnimationFrame` to guarantee zero UI frame drops.

### 3. Partial Invalidation (`DirtyRegionManager`)
Modifications to individual objects only invalidate the affected bounding box area (`DirtyRegion`) rather than triggering a full canvas redraw.

### 4. Layout & Measure Caching (`CacheManager` & `TextEngine`)
Text metrics and image loads are cached in memory to avoid repetitive DOM context calls.

---

## 2. Real-Time Performance Monitoring

Enable the DevTools debug panel in development mode:

```ts
import { renderingEngine } from '../features/whiteboard/rendering-engine';

// View real-time stats
const stats = renderingEngine.perf.getStats();
console.log(`FPS: ${stats.fps}, Render Time: ${stats.renderTimeMs}ms, Culled: ${stats.totalCount - stats.visibleCount}`);
```
