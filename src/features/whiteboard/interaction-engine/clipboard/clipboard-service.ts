import type { CanvasObject, CanvasPage, Point2D } from '../../canvas-model/types.js';
import { objectRegistry } from '../../canvas-model/registry/object-registry.js';
import { AddObjectCommand, commandManager } from '../../canvas-model/command/command-system.js';

export class ClipboardService {
  private clipboardData: CanvasObject[] = [];

  /**
   * Copy objects into in-memory clipboard
   */
  public copy(objects: CanvasObject[]): void {
    this.clipboardData = objects.map((obj) => JSON.parse(JSON.stringify(obj)));
  }

  /**
   * Cut objects: copy to clipboard and remove from page
   */
  public cut(page: CanvasPage, objects: CanvasObject[]): CanvasPage {
    this.copy(objects);
    let updatedPage = page;
    const objectIds = objects.map((o) => o.id);

    const nextObjects = { ...updatedPage.objects };
    objectIds.forEach((id) => delete nextObjects[id]);

    return {
      ...updatedPage,
      objects: nextObjects,
    };
  }

  /**
   * Paste objects from clipboard onto page with a slight offset
   */
  public paste(page: CanvasPage, offset: Point2D = { x: 20, y: 20 }): { page: CanvasPage; newObjectIds: string[] } {
    if (this.clipboardData.length === 0) return { page, newObjectIds: [] };

    let currentPage = page;
    const newObjectIds: string[] = [];

    this.clipboardData.forEach((item) => {
      const cloned = objectRegistry.cloneObject(item, offset);
      newObjectIds.push(cloned.id);
      currentPage = commandManager.executeCommand(new AddObjectCommand(cloned), currentPage);
    });

    return { page: currentPage, newObjectIds };
  }

  /**
   * Duplicate objects directly on page
   */
  public duplicate(page: CanvasPage, objectIds: string[], offset: Point2D = { x: 20, y: 20 }): { page: CanvasPage; newObjectIds: string[] } {
    const targets = objectIds.map((id) => page.objects[id]).filter(Boolean);
    this.copy(targets);
    return this.paste(page, offset);
  }

  /**
   * Check if clipboard contains data
   */
  public hasContent(): boolean {
    return this.clipboardData.length > 0;
  }
}

export const clipboardService = new ClipboardService();
