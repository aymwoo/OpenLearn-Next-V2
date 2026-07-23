import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActivityRegistry,
  registerDefaultActivities,
  IActivityProvider,
} from '../index.js';

describe('Sprint P3-03 Activity Workflow Test Suite', () => {
  let registry: ActivityRegistry;

  beforeEach(() => {
    registry = new ActivityRegistry();
  });

  it('should register 5 official activity providers (Quiz, Poll, Brainstorm, Discussion, Assignment)', () => {
    registerDefaultActivities(registry);
    expect(registry.listProviders().length).toBe(5);

    const quiz = registry.createActivity('Quiz', 'Pop Quiz 1');
    expect(quiz.title).toBe('Pop Quiz 1');
    expect(quiz.type).toBe('Quiz');
  });

  it('should allow third-party plugins to register custom activity providers', () => {
    registerDefaultActivities(registry);

    const pluginActivityProvider: IActivityProvider = {
      id: 'provider_plugin_code_challenge',
      type: 'PluginActivity',
      createActivity: (title, config) => ({
        id: `act_code_${Date.now()}`,
        title: title || 'Live Coding Challenge',
        type: 'PluginActivity',
        config,
      }),
    };

    registry.registerProvider(pluginActivityProvider);
    expect(registry.listProviders().length).toBe(6);

    const codeAct = registry.createActivity('PluginActivity', 'Python Algorithm Challenge', { language: 'python' });
    expect(codeAct.title).toBe('Python Algorithm Challenge');
    expect(codeAct.config).toEqual({ language: 'python' });
  });
});
