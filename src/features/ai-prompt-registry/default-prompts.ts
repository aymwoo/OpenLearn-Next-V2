/**
 * OpenLearn AI Prompt Registry - Default Prompts (Sprint P5-05)
 */

import { PromptRegistry } from './prompt-registry.js';
import { PromptDescriptor, PromptCategory } from './prompt-types.js';

export const createDefaultPrompt = (
  id: string,
  name: string,
  description: string,
  category: PromptCategory,
  template: string,
  version: string = '1.0.0'
): PromptDescriptor => ({
  metadata: {
    id,
    name,
    description,
    version,
    category,
    permissions: ['ai:prompt:read'],
    provider: 'official',
  },
  template,
});

export const registerDefaultPrompts = (registry: PromptRegistry): void => {
  registry.registerPrompt(
    createDefaultPrompt(
      'prompt_lesson_summary',
      'Lesson Summary Prompt',
      'Template for generating key-point summaries of current lesson flow',
      'Lesson',
      'Summarize the following lesson context cleanly: {{lessonContext}}'
    )
  );

  registry.registerPrompt(
    createDefaultPrompt(
      'prompt_whiteboard_explain',
      'Whiteboard Content Explainer',
      'Template for analyzing multi-modal 2D whiteboard drawings and formulas',
      'Whiteboard',
      'Analyze and explain the whiteboard shapes and formulas: {{whiteboardContext}}'
    )
  );

  registry.registerPrompt(
    createDefaultPrompt(
      'prompt_quiz_generate',
      'Interactive Quiz Generator',
      'Template for generating 3 multiple-choice pop quiz questions',
      'Activity',
      'Generate 3 pop quiz questions based on the topic: {{topic}}'
    )
  );

  registry.registerPrompt(
    createDefaultPrompt(
      'prompt_student_insight',
      'Student Engagement Insight',
      'Template for synthesizing student participation telemetry',
      'Student',
      'Synthesize engagement insight for student: {{studentMetrics}}'
    )
  );
};
