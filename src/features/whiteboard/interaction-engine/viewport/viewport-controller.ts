import type { BoundingBox, CanvasObject, Point2D } from '../../canvas-model/types.js';
import type { ViewportState } from '../types.js';

export class ViewportController {
  private state: ViewportState = {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.1,
    maxZoom: 5,
  };

  private listeners: Array<(state: ViewportState) => void> = [];

  public getViewport(): ViewportState {
    return { ...this.state };
  }

  public setViewport(patch: Partial<ViewportState>): ViewportState {
    const nextZoom = patch.zoom !== undefined 
      ? Math.max(this.state.minZoom, Math.min(this.state.maxZoom, patch.zoom)) 
      : this.state.zoom;

    this.state = {
      ...this.state,
      ...patch,
      zoom: nextZoom,
    };

    this.listeners.forEach((fn) => fn(this.state));
    return this.getViewport();
  }

  public pan(dx: number, dy: number): ViewportState {
    return this.setViewport({
      x: this.state.x + dx,
      y: this.state.y + dy,
    });
  }

  public zoomAt(screenCenter: Point2D, factor: number): ViewportState {
    const newZoom = Math.max(this.state.minZoom, Math.min(this.state.maxZoom, this.state.zoom * factor));
    const zoomRatio = newZoom / this.state.zoom;

    const newX = screenCenter.x - (screenCenter.x - this.state.x) * zoomRatio;
    const newY = screenCenter.y - (screenCenter.y - this.state.y) * zoomRatio;

    return this.setViewport({
      x: newX,
      y: newY,
      zoom: newZoom,
    });
  }

  public resetZoom(): ViewportState {
    return this.setViewport({ x: 0, y: 0, zoom: 1 });
  }

  public fitScreen(containerSize: { width: number; height: number }, bbox: BoundingBox): ViewportState {
    if (bbox.width <= 0 || bbox.height <= 0) return this.resetZoom();

    const padding = 40;
    const scaleX = (containerSize.width - padding * 2) / bbox.width;
    const scaleY = (containerSize.height - padding * 2) / bbox.height;
    const zoom = Math.max(this.state.minZoom, Math.min(1.5, Math.min(scaleX, scaleY)));

    const x = (containerSize.width - bbox.width * zoom) / 2 - bbox.x * zoom;
    const y = (containerSize.height - bbox.height * zoom) / 2 - bbox.y * zoom;

    return this.setViewport({ x, y, zoom });
  }

  public zoomToObject(containerSize: { width: number; height: number }, object: CanvasObject): ViewportState {
    const bbox: BoundingBox = {
      x: object.position.x,
      y: object.position.y,
      width: object.size.width,
      height: object.size.height,
    };
    return this.fitScreen(containerSize, bbox);
  }

  public onChange(listener: (state: ViewportState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const viewportController = new ViewportController();
