/**
 * OpenLearn AI Classroom Context - Default Official Providers (Sprint P5-01)
 */

import { AIContextProviderRegistry } from './ai-context-provider-registry.js';
import { IAIContextProvider } from './ai-context-types.js';

export const createDefaultAIContextProvider = (
  id: string,
  name: string,
  key: string,
  value: unknown
): IAIContextProvider => ({
  id,
  name,
  provideContext: () => ({ [key]: value }),
});

export const registerDefaultAIContextProviders = (registry: AIContextProviderRegistry): void => {
  registry.registerProvider(
    createDefaultAIContextProvider('provider_ai_lesson', 'AI Lesson Provider', 'lesson', {
      lessonId: 'les_math_101',
      title: 'Advanced Calculus',
      stage: 'Teaching',
    })
  );

  registry.registerProvider(
    createDefaultAIContextProvider('provider_ai_teacher', 'AI Teacher Provider', 'teacher', {
      teacherId: 'tch_001',
      name: 'Prof. Alan Turing',
      status: 'Active',
    })
  );

  registry.registerProvider(
    createDefaultAIContextProvider('provider_ai_students', 'AI Students Provider', 'students', [
      { studentId: 'stu_01', name: 'Alice', online: true },
      { studentId: 'stu_02', name: 'Bob', online: true },
    ])
  );

  registry.registerProvider(
    createDefaultAIContextProvider('provider_ai_whiteboard', 'AI Whiteboard Provider', 'whiteboard', {
      elementCount: 12,
      activeTool: 'tool_pen',
    })
  );

  registry.registerProvider(
    createDefaultAIContextProvider('provider_ai_analytics', 'AI Analytics Provider', 'analyticsSummary', {
      totalInteractions: 128,
      averageEngagementScore: 94.8,
    })
  );
};
