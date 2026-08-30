import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
} from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '{{pluginId}}',
    name: '{{pluginName}}',
    version: '0.1.0',
    description: '{{description}}',
    author: '{{author}}',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read'],
    engines: { openlearn: '^0.2.5' },
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // Register AI tool
    await actionRegistry.register({
      id: '{{pluginId}}-hello',
      commandType: '{{pluginId}}.hello',
      description: 'Say hello — a starter action for {{pluginName}}',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Who to greet' },
        },
        required: ['name'],
      },
    });

    // Handle command
    await commandBus.registerHandler('{{pluginId}}.hello', {
      async execute(command) {
        const payload = command.payload as any;
        const message = `Hello, ${payload.name}! — from {{pluginName}}`;

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: '{{pluginId}}.hello_executed',
          source: 'plugin.{{pluginId}}',
          payload: { message },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { message };
      },
    });

    ctx.log.info('{{pluginName}} activated successfully');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
