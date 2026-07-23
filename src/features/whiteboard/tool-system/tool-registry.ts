/**
 * OpenLearn Whiteboard Tool System - Tool Registry (Sprint P2-01)
 * Central registry managing tool instances, active state, and lifecycle hooks.
 */

import { IWhiteboardTool, WhiteboardToolCategory } from './tool-types.js';

export class WhiteboardToolRegistry {
  private tools = new Map<string, IWhiteboardTool>();
  private activeToolId: string | null = null;

  public register(tool: IWhiteboardTool): void {
    if (!tool || !tool.meta || !tool.meta.id) {
      throw new Error('WhiteboardToolRegistry Error: Invalid tool metadata.');
    }
    this.tools.set(tool.meta.id, tool);
  }

  public unregister(toolId: string): boolean {
    const existing = this.tools.get(toolId);
    if (!existing) return false;

    if (this.activeToolId === toolId) {
      this.deactivateActiveTool();
    }

    if (existing.dispose) {
      existing.dispose();
    }

    return this.tools.delete(toolId);
  }

  public activateTool(toolId: string, context?: Record<string, unknown>): boolean {
    const target = this.tools.get(toolId);
    if (!target) return false;

    if (this.activeToolId && this.activeToolId !== toolId) {
      this.deactivateActiveTool();
    }

    this.activeToolId = toolId;
    if (target.activate) {
      target.activate(context);
    }
    return true;
  }

  public deactivateActiveTool(): void {
    if (this.activeToolId) {
      const active = this.tools.get(this.activeToolId);
      if (active && active.deactivate) {
        active.deactivate();
      }
      this.activeToolId = null;
    }
  }

  public getActiveTool(): IWhiteboardTool | undefined {
    return this.activeToolId ? this.tools.get(this.activeToolId) : undefined;
  }

  public getTool(toolId: string): IWhiteboardTool | undefined {
    return this.tools.get(toolId);
  }

  public listTools(category?: WhiteboardToolCategory): ReadonlyArray<IWhiteboardTool> {
    const all = Array.from(this.tools.values());
    const filtered = category ? all.filter((t) => t.meta.category === category) : all;
    filtered.sort((a, b) => (b.meta.priority ?? 0) - (a.meta.priority ?? 0));
    return Object.freeze(filtered);
  }

  public clear(): void {
    this.deactivateActiveTool();
    for (const tool of this.tools.values()) {
      if (tool.dispose) {
        tool.dispose();
      }
    }
    this.tools.clear();
  }
}
