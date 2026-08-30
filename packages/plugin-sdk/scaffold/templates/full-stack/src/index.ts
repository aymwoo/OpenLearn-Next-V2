import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
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
    capabilitiesProposed: ['lesson:read', 'lesson:write'],
    classroomTools: [{
      id: '{{pluginId}}-tool',
      name: '{{pluginName}}',
      icon: 'Puzzle',
      commandType: '{{pluginId}}.open_tool',
    }],
    engines: { openlearn: '^0.2.5' },
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // Create plugin table
    await ctx.db.ensureTable('data', `
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    `);

    // Register AI tool
    await actionRegistry.register({
      id: '{{pluginId}}-process',
      commandType: '{{pluginId}}.process',
      description: 'Process data for {{pluginName}}',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          input: { type: 'STRING', description: 'Input data to process' },
        },
        required: ['input'],
      },
    });

    // Command handler
    await commandBus.registerHandler('{{pluginId}}.process', {
      async execute(command) {
        const payload = command.payload as any;
        const { input } = payload;

        const tableName = ctx.db.table('data');
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`)
          .run(id, input, Date.now());

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: '{{pluginId}}.processed',
          source: 'plugin.{{pluginId}}',
          payload: { id, content: input },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { id, message: `Processed: ${input}` };
      },
    });

    // Classroom tool handler (opens frontend UI)
    await actionRegistry.register({
      id: '{{pluginId}}-open-tool',
      commandType: '{{pluginId}}.open_tool',
      description: 'Open {{pluginName}} classroom tool UI',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: 'Current lesson ID' },
        },
        required: ['lessonId'],
      },
    });

    await commandBus.registerHandler('{{pluginId}}.open_tool', {
      async execute(command) {
        return { opened: true, pluginId: '{{pluginId}}' };
      },
    });

    ctx.log.info('{{pluginName}} activated (full-stack)');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
