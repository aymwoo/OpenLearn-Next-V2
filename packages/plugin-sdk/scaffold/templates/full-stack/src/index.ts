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
    // 入口文件：esbuild 把插件打成单文件 bundle，安装后即位于插件目录下的 index.js。
    // manifestSchema 的 main 为必填（z.string().min(1)）—— 缺失会让插件**装不上**。
    main: 'index.js',
    description: '{{description}}',
    author: '{{author}}',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write'],
    classroomTools: [
      {
        id: '{{name}}-tool',
        name: '{{pluginName}}',
        icon: 'Puzzle',
        commandType: '{{pluginId}}.open_tool',
        // $lessonId / $classId 由宿主在点击瞬间替换成当前课堂上下文 ——
        // 这是工具按钮拿到 lessonId / classId 的唯一通道，别自己瞎猜字段名。
        payload: { lessonId: '$lessonId', classId: '$classId' },
      },
    ],
    engines: { openlearn: '>=0.2.5' },
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // Create plugin table
    await ctx.db.ensureTable(
      'data',
      `
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    `,
    );

    // Register AI tool
    await actionRegistry.register({
      id: '{{name}}-process',
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
        db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`).run(id, input, Date.now());

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
      id: '{{name}}-open-tool',
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
        const payload = command.payload as { lessonId?: string; classId?: string };
        // 第三方插件的前端跑在隐藏 iframe 里，无法渲染面板 —— 课堂工具只能
        // 在后端做事（写库、发事件、回一条结果给事件流）。这里把上下文回显，
        // 便于在「课堂事件流」里确认占位符替换成功。
        return {
          opened: true,
          pluginId: '{{pluginId}}',
          lessonId: payload?.lessonId ?? null,
          classId: payload?.classId ?? null,
        };
      },
    });

    ctx.log.info('{{pluginName}} activated (full-stack)');
  },

  async deactivate() {
    console.log('{{pluginName}} deactivated');
  },
};
