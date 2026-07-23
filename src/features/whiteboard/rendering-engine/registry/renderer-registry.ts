import type { IRenderer } from '../types.js';

/**
 * Renderer Registry
 * 
 * Central registry for object renderers.
 * Enables core developers and third-party plugins to register custom renderers
 * or override existing ones without mutating Whiteboard Core.
 */
export class RendererRegistry {
  private renderers = new Map<string, IRenderer<any>>();

  /**
   * Register a new Object Renderer
   */
  public registerRenderer<T = Record<string, unknown>>(renderer: IRenderer<T>): void {
    if (this.renderers.has(renderer.type)) {
      console.warn(`[RendererRegistry] Overwriting existing renderer for type: "${renderer.type}"`);
    }
    this.renderers.set(renderer.type, renderer);
  }

  /**
   * Unregister an Object Renderer
   */
  public unregisterRenderer(type: string): boolean {
    return this.renderers.delete(type);
  }

  /**
   * Override an existing Object Renderer (Plugin API)
   */
  public overrideRenderer<T = Record<string, unknown>>(type: string, renderer: IRenderer<T>): void {
    this.renderers.set(type, renderer);
  }

  /**
   * Get Renderer for a specific Object type
   */
  public getRenderer<T = Record<string, unknown>>(type: string): IRenderer<T> | undefined {
    return this.renderers.get(type);
  }

  /**
   * Check if a Renderer is registered
   */
  public hasRenderer(type: string): boolean {
    return this.renderers.has(type);
  }
}

export const rendererRegistry = new RendererRegistry();
