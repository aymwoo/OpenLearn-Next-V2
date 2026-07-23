import React from 'react';
import type { CanvasObject } from '../types.js';

export interface ObjectRendererProps<T = Record<string, unknown>> {
  object: CanvasObject<T>;
  isSelected?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  userRole?: string;
  onUpdate?: (id: string, patch: Partial<CanvasObject<T>>) => void;
  onDelete?: (id: string) => void;
}

export type ObjectRenderer<T = Record<string, unknown>> = React.ComponentType<ObjectRendererProps<T>>;

/**
 * Renderer Registry
 * 
 * Decouples object rendering from monolithic if/else or switch/case statements.
 * Allows plugins or new object definitions to register custom React / Konva renderers.
 */
export class RendererRegistry {
  private renderers = new Map<string, ObjectRenderer<any>>();

  /**
   * Register a Renderer Component for a given Object Type
   */
  public registerRenderer<T = Record<string, unknown>>(
    type: string,
    renderer: ObjectRenderer<T>
  ): void {
    if (this.renderers.has(type)) {
      console.warn(`[RendererRegistry] Overwriting renderer for type: "${type}"`);
    }
    this.renderers.set(type, renderer);
  }

  /**
   * Unregister a Renderer Component
   */
  public unregisterRenderer(type: string): boolean {
    return this.renderers.delete(type);
  }

  /**
   * Get a Renderer Component by object type
   */
  public getRenderer<T = Record<string, unknown>>(type: string): ObjectRenderer<T> | undefined {
    return this.renderers.get(type);
  }

  /**
   * Check if a Renderer Component is registered for type
   */
  public hasRenderer(type: string): boolean {
    return this.renderers.has(type);
  }
}

/** Singleton Export */
export const rendererRegistry = new RendererRegistry();
