import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: "ext-memo",
    name: "便签助手插件",
    version: "1.0.0"
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    console.log(`[Memo Plugin] Activating memo plugin "${ctx.pluginId}"...`);

    // 1. 注册 Action
    await actionRegistry.register({
      id: 'ext-memo-create-action',
      commandType: 'memo.create',
      description: '在白板上放置一个黄色背景的便签，写有自定义的文本。',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          text: { type: 'STRING', description: '便签的文本内容' },
          x: { type: 'NUMBER', description: 'X 坐标（可选，默认随机）' },
          y: { type: 'NUMBER', description: 'Y 坐标（可选，默认随机）' },
          color: { type: 'STRING', description: '背景颜色（十六进制，可选，默认黄色 #fef08a）' }
        },
        required: ['lessonId', 'text']
      }
    });

    // 2. 绑定总线 Handler
    await commandBus.registerHandler('memo.create', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { lessonId, text } = payload;
        const x = payload.x !== undefined ? payload.x : (100 + Math.random() * 200);
        const y = payload.y !== undefined ? payload.y : (100 + Math.random() * 200);
        const fillColor = payload.color || '#fef08a';

        console.log(`[Memo Plugin] Creating memo on lesson ${lessonId}: "${text}"`);

        // A. 绘制背景矩形
        const rectResult = await commandBus.execute({
          id: 'memo_rect_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'rectangle',
            data: JSON.stringify({
              x: x,
              y: y,
              width: 200,
              height: 120,
              fill: fillColor,
              stroke: '#eab308',
              strokeWidth: 2,
              cornerRadius: 4
            })
          }
        }) as any;

        // B. 绘制便签文字
        const textResult = await commandBus.execute({
          id: 'memo_text_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'text',
            data: JSON.stringify({
              x: x + 10,
              y: y + 15,
              text: text,
              fontSize: 16,
              fill: '#1e293b',
              width: 180,
              height: 90
            })
          }
        }) as any;

        return {
          success: true,
          rectElementId: rectResult?.elementId,
          textElementId: textResult?.elementId,
          timestamp: new Date().toISOString()
        };
      }
    });
  },

  deactivate: async () => {
    console.log('[Memo Plugin] Deactivating memo plugin...');
  }
};
