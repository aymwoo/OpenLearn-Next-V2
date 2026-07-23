/**
 * OpenLearn AI Action API - Registry (Sprint P5-02)
 * Central registry for official and plugin AI Actions, delegating to Capability APIs.
 */

import { AIActionDescriptor, LLMToolDefinition } from './ai-action-types.js';

export class AIActionRegistry {
  private actions = new Map<string, AIActionDescriptor>();

  public registerAction(action: AIActionDescriptor): void {
    if (!action || !action.id || !action.name) {
      throw new Error('AIActionRegistry Error: AIActionDescriptor must have a valid ID and Name.');
    }
    this.actions.set(action.id, action);
  }

  public unregisterAction(actionId: string): boolean {
    return this.actions.delete(actionId);
  }

  public getAction(actionId: string): AIActionDescriptor | undefined {
    return this.actions.get(actionId);
  }

  public listActions(): ReadonlyArray<AIActionDescriptor> {
    return Object.freeze(Array.from(this.actions.values()));
  }

  public async executeAction(
    actionId: string,
    params: Record<string, unknown> = {},
    context?: unknown
  ): Promise<unknown> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`AIActionRegistry Error: Action '${actionId}' not found.`);
    }

    // Execute action (strictly delegating to Capability APIs)
    return await action.execute(params, context);
  }

  public getToolDefinitions(): ReadonlyArray<LLMToolDefinition> {
    const definitions: LLMToolDefinition[] = [];
    for (const action of this.actions.values()) {
      definitions.push({
        name: action.id,
        description: `${action.name}: ${action.description}`,
        parameters: action.parametersSchema ?? { type: 'object', properties: {} },
      });
    }
    return Object.freeze(definitions);
  }

  public clear(): void {
    this.actions.clear();
  }
}
