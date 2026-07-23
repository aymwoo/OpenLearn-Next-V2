import { teachingObjectRegistry, TeachingObjectDescriptor } from '../registry/teaching-object-registry.js';
import { rendererRegistry } from '../../rendering-engine/registry/renderer-registry.js';
import { learningAnalyticsEngine } from '../analytics/learning-analytics.js';
import { teachingRuntimeManager } from '../runtime/teaching-runtime.js';

export class TeachingPluginSDK {
  public registerTeachingObject<T = Record<string, unknown>>(descriptor: TeachingObjectDescriptor<T>): void {
    teachingObjectRegistry.registerTeachingObject(descriptor);
  }

  public registerRenderer(type: string, renderer: any): void {
    rendererRegistry.registerRenderer({ type, render: renderer });
  }

  public registerRuntime(objectId: string): void {
    teachingRuntimeManager.run(objectId);
  }

  public registerAnalytics(objectId: string): void {
    learningAnalyticsEngine.startTrack(objectId);
  }
}

export const teachingPluginSDK = new TeachingPluginSDK();
