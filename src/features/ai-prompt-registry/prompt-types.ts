/**
 * OpenLearn AI Prompt Registry - Data Types & Contracts (Sprint P5-05)
 */

export type PromptCategory =
  | 'Lesson'
  | 'Whiteboard'
  | 'Resource'
  | 'Activity'
  | 'Student'
  | 'Assessment'
  | 'Summary'
  | 'Plugin';

export interface PromptMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: PromptCategory;
  readonly permissions?: ReadonlyArray<string>;
  readonly provider: string;
}

export interface PromptDescriptor {
  readonly metadata: PromptMetadata;
  readonly template: string;
}

export interface IPromptProvider {
  readonly providerId: string;
  readonly getPrompts: () => ReadonlyArray<PromptDescriptor>;
}
