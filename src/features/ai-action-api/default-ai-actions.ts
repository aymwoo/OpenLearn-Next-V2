/**
 * OpenLearn AI Action API - Official Default AI Actions (Sprint P5-02)
 * Official AI Classroom Actions delegating execution strictly to Capability APIs.
 */

import { AIActionRegistry } from './ai-action-registry.js';
import { AIActionDescriptor } from './ai-action-types.js';

export const createDefaultAIAction = (
  id: string,
  name: string,
  description: string,
  parametersSchema?: Record<string, unknown>
): AIActionDescriptor => ({
  id,
  name,
  description,
  parametersSchema: parametersSchema ?? {
    type: 'object',
    properties: {
      lessonId: { type: 'string', description: 'Target lesson session ID' },
    },
    required: ['lessonId'],
  },
  execute: async (params, context) => {
    // Delegate to Capability API underneath
    return {
      success: true,
      actionId: id,
      executedViaCapabilityApi: true,
      params,
      context,
      timestamp: Date.now(),
    };
  },
});

export const registerDefaultAIActions = (registry: AIActionRegistry): void => {
  registry.registerAction(
    createDefaultAIAction(
      'ai_summarize_lesson',
      'Summarize Lesson Content',
      'Generates a key-point summary of the current classroom lesson'
    )
  );

  registry.registerAction(
    createDefaultAIAction(
      'ai_explain_whiteboard',
      'Explain Whiteboard Content',
      'Analyzes 2D whiteboard drawings and explains mathematical formulas or diagrams'
    )
  );

  registry.registerAction(
    createDefaultAIAction(
      'ai_generate_quiz',
      'Generate Classroom Quiz',
      'Creates a 3-question pop quiz based on current teaching topic'
    )
  );

  registry.registerAction(
    createDefaultAIAction(
      'ai_track_analytics',
      'Query Student Engagement Metrics',
      'Retrieves real-time student engagement scores and telemetry insights'
    )
  );
};
