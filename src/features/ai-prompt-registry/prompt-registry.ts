/**
 * OpenLearn AI Prompt Registry - Registry (Sprint P5-05)
 * Central registry for official and plugin AI Prompts with metadata and versioning.
 */

import { PromptDescriptor, PromptCategory, IPromptProvider } from './prompt-types.js';

export class PromptRegistry {
  private prompts = new Map<string, PromptDescriptor>();

  public registerPrompt(prompt: PromptDescriptor): void {
    if (!prompt || !prompt.metadata || !prompt.metadata.id) {
      throw new Error('PromptRegistry Error: PromptDescriptor must have valid metadata with an ID.');
    }
    this.prompts.set(prompt.metadata.id, prompt);
  }

  public unregisterPrompt(promptId: string): boolean {
    return this.prompts.delete(promptId);
  }

  public registerProvider(provider: IPromptProvider): void {
    if (!provider || !provider.providerId || typeof provider.getPrompts !== 'function') {
      throw new Error('PromptRegistry Error: IPromptProvider must have providerId and getPrompts function.');
    }
    const descriptors = provider.getPrompts();
    for (const descriptor of descriptors) {
      this.registerPrompt(descriptor);
    }
  }

  public getPrompt(promptId: string): PromptDescriptor | undefined {
    return this.prompts.get(promptId);
  }

  public listPrompts(): ReadonlyArray<PromptDescriptor> {
    return Object.freeze(Array.from(this.prompts.values()));
  }

  public listPromptsByCategory(category: PromptCategory): ReadonlyArray<PromptDescriptor> {
    const results: PromptDescriptor[] = [];
    for (const prompt of this.prompts.values()) {
      if (prompt.metadata.category === category) {
        results.push(prompt);
      }
    }
    return Object.freeze(results);
  }

  public clear(): void {
    this.prompts.clear();
  }
}
