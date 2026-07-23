/**
 * OpenLearn AI Action API - Data Types & Contracts (Sprint P5-02)
 */

export interface AIActionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parametersSchema?: Record<string, unknown>;
  readonly permissions?: ReadonlyArray<string>;
  readonly execute: (params: Record<string, unknown>, context?: unknown) => Promise<unknown> | unknown;
}

export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
