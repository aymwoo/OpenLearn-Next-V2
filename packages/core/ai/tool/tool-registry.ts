/**
 * OpenLearn AI Infrastructure - Unified Tool Registry
 * Exposes system actions & plugin tools as Gemini / OpenAI tool schemas and handles execution.
 */

import { AIToolSchema, ToolExecutionResult } from '../types/index.js';
import { AIEventBus } from '../event/ai-event-bus.js';

export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export class ToolRegistry {
  private tools = new Map<string, AIToolSchema>();
  private executors = new Map<string, ToolExecutor>();
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
  }

  public registerTool(schema: AIToolSchema, executor?: ToolExecutor): void {
    const sanitizedName = schema.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const sanitizedSchema = Object.freeze({
      ...schema,
      name: sanitizedName,
    });

    this.tools.set(sanitizedName, sanitizedSchema);
    if (executor) {
      this.executors.set(sanitizedName, executor);
    }
  }

  public getOpenAITools(): ReadonlyArray<{ type: 'function'; function: AIToolSchema }> {
    return Object.freeze(
      Array.from(this.tools.values()).map((schema) => ({
        type: 'function' as const,
        function: schema,
      }))
    );
  }

  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    fallbackExecutor?: ToolExecutor
  ): Promise<ToolExecutionResult> {
    const executor = this.executors.get(toolName) || fallbackExecutor;
    if (!executor) {
      const err = `Tool executor not found for: ${toolName}`;
      this.eventBus.publish('ToolCalled', { toolName, args, success: false });
      return { callName: toolName, success: false, error: err };
    }

    try {
      const result = await executor(toolName, args);
      this.eventBus.publish('ToolCalled', { toolName, args, success: true });
      return { callName: toolName, success: true, result };
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.eventBus.publish('ToolCalled', { toolName, args, success: false });
      return { callName: toolName, success: false, error: errorMsg };
    }
  }

  public clear(): void {
    this.tools.clear();
    this.executors.clear();
  }
}
