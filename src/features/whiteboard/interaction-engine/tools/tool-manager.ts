import type { ITool } from '../types.js';

export class ToolManager {
  private tools = new Map<string, ITool>();
  private activeToolId: string = 'pointer';
  private listeners: Array<(activeTool: ITool) => void> = [];

  /**
   * Register a new Tool
   */
  public registerTool(tool: ITool): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Unregister a Tool
   */
  public unregisterTool(id: string): boolean {
    if (this.activeToolId === id) {
      this.setActiveTool('pointer');
    }
    return this.tools.delete(id);
  }

  /**
   * Set active tool by ID
   */
  public setActiveTool(id: string): void {
    if (!this.tools.has(id)) {
      console.warn(`[ToolManager] Unknown tool ID "${id}", falling back to "pointer"`);
      id = 'pointer';
    }

    if (this.activeToolId === id) return;

    const previousTool = this.tools.get(this.activeToolId);
    if (previousTool && previousTool.onDeactivate) {
      previousTool.onDeactivate();
    }

    this.activeToolId = id;

    const newTool = this.tools.get(id)!;
    if (newTool.onActivate) {
      newTool.onActivate();
    }

    this.listeners.forEach((fn) => fn(newTool));
  }

  /**
   * Get currently active tool
   */
  public getActiveTool(): ITool | undefined {
    return this.tools.get(this.activeToolId);
  }

  /**
   * Get tool by ID
   */
  public getTool(id: string): ITool | undefined {
    return this.tools.get(id);
  }

  /**
   * List all registered tools
   */
  public listTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Subscribe to tool changes
   */
  public onToolChange(listener: (activeTool: ITool) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const toolManager = new ToolManager();
