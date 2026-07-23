import { describe, it, expect, beforeEach } from 'vitest';
import {
  AISkillRegistry,
  registerDefaultAISkills,
  IAISkillProvider,
} from '../index.js';

describe('Sprint P5-03 AI Skill Registry Test Suite', () => {
  let registry: AISkillRegistry;

  beforeEach(() => {
    registry = new AISkillRegistry();
  });

  it('should register 4 official default AI Skills with complete metadata', () => {
    registerDefaultAISkills(registry);
    expect(registry.listSkills().length).toBe(4);

    const tutor = registry.getSkill('skill_tutor_assistant');
    expect(tutor).toBeDefined();
    expect(tutor?.metadata.name).toBe('AI Tutor Assistant');
    expect(tutor?.metadata.permissions).toContain('ai:invoke');
    expect(tutor?.metadata.requiredContext).toEqual(['lesson', 'students']);
    expect(tutor?.metadata.supportedModels).toContain('gemini-1.5-pro');
  });

  it('should filter registered skills by required context and supported models', () => {
    registerDefaultAISkills(registry);

    const whiteboardSkills = registry.findSkillsByContext('whiteboard');
    expect(whiteboardSkills.length).toBe(1);
    expect(whiteboardSkills[0].metadata.id).toBe('skill_whiteboard_explainer');

    const geminiSkills = registry.findSkillsByModel('gemini-1.5-pro');
    expect(geminiSkills.length).toBe(4); // 3 wildcard '*' plus 1 explicit 'gemini-1.5-pro'
  });

  it('should allow third-party plugins to register custom AI Skills', () => {
    registerDefaultAISkills(registry);

    const pluginSkill: IAISkillProvider = {
      metadata: {
        id: 'skill_plugin_code_reviewer',
        name: 'AI Code Reviewer',
        description: 'Analyzes student submitted code for syntax bugs and style violations',
        permissions: ['plugin:ai:code_review'],
        requiredContext: ['resources'],
        supportedModels: ['*'],
      },
      invoke: async () => ({ reviewPassed: true }),
    };

    registry.registerSkill(pluginSkill);
    expect(registry.listSkills().length).toBe(5);
    expect(registry.getSkill('skill_plugin_code_reviewer')?.metadata.name).toBe('AI Code Reviewer');
  });
});
