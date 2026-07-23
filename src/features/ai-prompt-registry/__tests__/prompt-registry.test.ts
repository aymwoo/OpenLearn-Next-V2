import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptRegistry,
  registerDefaultPrompts,
  IPromptProvider,
} from '../index.js';

describe('Sprint P5-05 AI Prompt Registry Test Suite', () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  it('should register 4 official default AI Prompts with metadata and versioning', () => {
    registerDefaultPrompts(registry);
    expect(registry.listPrompts().length).toBe(4);

    const summaryPrompt = registry.getPrompt('prompt_lesson_summary');
    expect(summaryPrompt).toBeDefined();
    expect(summaryPrompt?.metadata.version).toBe('1.0.0');
    expect(summaryPrompt?.metadata.category).toBe('Lesson');
    expect(summaryPrompt?.metadata.provider).toBe('official');
  });

  it('should filter registered prompts by PromptCategory', () => {
    registerDefaultPrompts(registry);

    const whiteboardPrompts = registry.listPromptsByCategory('Whiteboard');
    expect(whiteboardPrompts.length).toBe(1);
    expect(whiteboardPrompts[0].metadata.id).toBe('prompt_whiteboard_explain');
  });

  it('should allow third-party plugins to register IPromptProvider', () => {
    registerDefaultPrompts(registry);

    const pluginPromptProvider: IPromptProvider = {
      providerId: 'ext_homework_hub',
      getPrompts: () => [
        {
          metadata: {
            id: 'prompt_plugin_grading_rubric',
            name: 'Grading Rubric Synthesizer',
            description: 'Generates automated grading rubrics',
            version: '2.1.0',
            category: 'Assessment',
            provider: 'ext_homework_hub',
          },
          template: 'Synthesize grading rubric for assignment: {{assignmentDetails}}',
        },
      ],
    };

    registry.registerProvider(pluginPromptProvider);
    expect(registry.listPrompts().length).toBe(5);

    const pluginPrompt = registry.getPrompt('prompt_plugin_grading_rubric');
    expect(pluginPrompt?.metadata.version).toBe('2.1.0');
    expect(pluginPrompt?.metadata.provider).toBe('ext_homework_hub');
  });
});
