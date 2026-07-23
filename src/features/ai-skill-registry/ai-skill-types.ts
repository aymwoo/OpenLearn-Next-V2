/**
 * OpenLearn AI Skill Registry - Data Types & Contracts (Sprint P5-03)
 */

export interface AISkillMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: ReadonlyArray<string>;
  readonly requiredContext: ReadonlyArray<string>;
  readonly supportedModels: ReadonlyArray<string>;
}

export interface IAISkillProvider {
  readonly metadata: AISkillMetadata;
  readonly invoke?: (params: Record<string, unknown>, context?: unknown) => Promise<unknown> | unknown;
}
