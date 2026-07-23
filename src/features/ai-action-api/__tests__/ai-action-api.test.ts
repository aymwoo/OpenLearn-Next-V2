import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AIActionRegistry,
  registerDefaultAIActions,
  AIActionDescriptor,
} from '../index.js';

describe('Sprint P5-02 AI Action API Test Suite', () => {
  let registry: AIActionRegistry;

  beforeEach(() => {
    registry = new AIActionRegistry();
  });

  it('should register official default AI Classroom Actions and delegate execution to Capability APIs', async () => {
    registerDefaultAIActions(registry);
    expect(registry.listActions().length).toBe(4);

    const result = (await registry.executeAction('ai_summarize_lesson', {
      lessonId: 'les_math_101',
    })) as any;

    expect(result.success).toBe(true);
    expect(result.actionId).toBe('ai_summarize_lesson');
    expect(result.executedViaCapabilityApi).toBe(true);
    expect(result.params.lessonId).toBe('les_math_101');
  });

  it('should generate LLM tool definitions compatible with LLM Function Calling', () => {
    registerDefaultAIActions(registry);
    const definitions = registry.getToolDefinitions();

    expect(definitions.length).toBe(4);
    expect(definitions[0].name).toBe('ai_summarize_lesson');
    expect(definitions[0].description).toContain('Summarize Lesson Content');
    expect(definitions[0].parameters).toBeDefined();
  });

  it('should allow third-party plugins to register AI Actions using the same registration API', async () => {
    registerDefaultAIActions(registry);

    const pluginExecuteSpy = vi.fn().mockResolvedValue({ pluginExecuted: true });

    const pluginAction: AIActionDescriptor = {
      id: 'ai_plugin_auto_grade',
      name: 'Auto Grade Homework',
      description: 'Automatically grades student homework submissions via AI Assistant',
      parametersSchema: {
        type: 'object',
        properties: { assignmentId: { type: 'string' } },
        required: ['assignmentId'],
      },
      execute: pluginExecuteSpy,
    };

    registry.registerAction(pluginAction);
    expect(registry.listActions().length).toBe(5);

    const result = await registry.executeAction('ai_plugin_auto_grade', { assignmentId: 'assign_01' });
    expect(pluginExecuteSpy).toHaveBeenCalledWith({ assignmentId: 'assign_01' }, undefined);
    expect(result).toEqual({ pluginExecuted: true });
  });
});
