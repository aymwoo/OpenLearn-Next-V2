/**
 * Rendering Engine — Barrel Export
 * 
 * High-Performance, Viewport-Culled, Plugin-Friendly Whiteboard Rendering Engine.
 */

export * from './types.js';
export * from './registry/renderer-registry.js';
export * from './virtualization/virtual-renderer.js';
export * from './pipeline/render-scheduler.js';
export * from './dirty/dirty-region-manager.js';
export * from './layers/layer-renderer.js';
export * from './cache/cache-manager.js';
export * from './image/image-manager.js';
export * from './text/text-engine.js';
export * from './hit-test/hit-test-engine.js';
export * from './animation/animation-manager.js';
export * from './perf/performance-monitor.js';
export * from './dpi/high-dpi-controller.js';
export * from './export/export-service.js';
export * from './theme/theme-manager.js';
export * from './debug/dev-tools-panel.js';
export * from './rendering-engine.js';
