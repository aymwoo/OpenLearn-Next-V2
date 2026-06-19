import { describe, it, expect, afterEach } from 'vitest';
import { Kernel } from '../../core/kernel/index.js';

describe('Quiz Plugin E2E Worker Mode', () => {
  let kernel: Kernel;

  afterEach(async () => {
    // Terminate workers
    const activePlugins = kernel.pluginHost.listPlugins();
    for (const plugin of activePlugins) {
      if (plugin.state === 'active') {
        try {
          await kernel.pluginHost.deactivatePlugin(plugin.id);
        } catch (e) {}
      }
    }
  });

  it('should seed, activate and execute quiz commands in worker mode', async () => {
    // Kernel auto-seeds ZIP plugins from dist/plugins/ during construction
    kernel = new Kernel();
    await kernel.ready;

    const plugins = kernel.pluginHost.listPlugins();
    const quizPlugin = plugins.find(p => p.name.includes('Quiz'));
    expect(quizPlugin).toBeDefined();
    expect(quizPlugin!.state).toBe('active');

    // Test command execution — grant necessary capabilities
    kernel.capabilityGuard.grant('user-teacher-0', 'whiteboard:write');
    const result = await kernel.commandBus.execute({
      id: 'cmd-quiz-create-test',
      type: 'quiz.create',
      actorId: 'user-teacher-0',
      timestamp: Date.now(),
      payload: {
        lessonId: 'lesson-123',
        question: 'What is 2+2?',
        options: ['3', '4', '5']
      }
    }) as any;

    expect(result).toBeDefined();
    expect(result.elementId).toBeDefined();

    // Verify whiteboard element was drawn in the DB
    const dbElement = kernel.db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?').get(result.elementId) as any;
    expect(dbElement).toBeDefined();
    expect(dbElement.lesson_id).toBe('lesson-123');
    expect(dbElement.type).toBe('quiz');
    const quizData = JSON.parse(dbElement.data);
    expect(quizData.question).toBe('What is 2+2?');
    expect(quizData.options).toEqual(['3', '4', '5']);
  });
});
