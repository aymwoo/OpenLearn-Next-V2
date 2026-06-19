import { ICommandBusServiceToken, IActionRegistryServiceToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    await actionRegistry.register({
      id: 'ext-quiz-create',
      commandType: 'quiz.create',
      description: 'Create a multiple-choice quiz on the whiteboard for a lesson',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['lessonId', 'question', 'options']
      }
    });

    await commandBus.registerHandler('quiz.create', {
      execute: async (command) => {
        const payload = command.payload as any;
        const result = await commandBus.execute({
          id: 'int_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || 'agent-system-0',
          payload: {
            lessonId: payload.lessonId,
            type: 'quiz',
            data: JSON.stringify({ question: payload.question, options: payload.options })
          }
        }) as any;
        return { elementId: result?.elementId };
      }
    });
  },
  deactivate: async () => {
    // Cleanups automatically handled by ResourceTracker
  }
};
