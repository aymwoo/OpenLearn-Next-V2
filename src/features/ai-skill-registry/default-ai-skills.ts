/**
 * OpenLearn AI Skill Registry - Default AI Skill Providers (Sprint P5-03)
 */

import { AISkillRegistry } from './ai-skill-registry.js';
import { IAISkillProvider } from './ai-skill-types.js';

export const createDefaultAISkill = (
  id: string,
  name: string,
  description: string,
  requiredContext: string[],
  supportedModels: string[]
): IAISkillProvider => ({
  metadata: {
    id,
    name,
    description,
    permissions: ['ai:invoke'],
    requiredContext,
    supportedModels,
  },
  invoke: async (params, context) => ({
    success: true,
    skillId: id,
    params,
    context,
  }),
});

export const registerDefaultAISkills = (registry: AISkillRegistry): void => {
  registry.registerSkill(
    createDefaultAISkill(
      'skill_tutor_assistant',
      'AI Tutor Assistant',
      'Provides real-time Q&A and learning guidance for students',
      ['lesson', 'students'],
      ['gemini-1.5-pro', 'gpt-4o', '*']
    )
  );

  registry.registerSkill(
    createDefaultAISkill(
      'skill_whiteboard_explainer',
      'AI Whiteboard Visual Explainer',
      'Interprets multi-modal whiteboard drawings, formulas, and diagrams',
      ['whiteboard', 'resources'],
      ['gemini-1.5-flash', '*']
    )
  );

  registry.registerSkill(
    createDefaultAISkill(
      'skill_quiz_generator',
      'AI Quiz & Exercise Generator',
      'Generates adaptive pop quizzes based on classroom lesson flow',
      ['lesson', 'activities'],
      ['*']
    )
  );

  registry.registerSkill(
    createDefaultAISkill(
      'skill_analytics_insight',
      'AI Student Engagement Insight',
      'Analyzes telemetry logs to generate student participation insights',
      ['analyticsSummary'],
      ['*']
    )
  );
};
