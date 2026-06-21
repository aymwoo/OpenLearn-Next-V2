import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  // 1. 导出插件元数据信息，满足新版 ESM 插件宿主的激活时校验
  manifest: {
    id: "ext-hello-world",
    name: "Hello World 示范插件",
    version: "1.0.0"
  },

  // 2. 插件的主激活函数
  activate: async (ctx: PluginContext) => {
    // 从安全的上下文对象中解构出服务依赖
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    console.log(`[Hello World Plugin] Activating plugin "${ctx.pluginId}"...`);

    // 3. 注册自定义 Action (指令元数据声明)
    // 注册后，该指令可以在系统的指令调试池、API 甚至 AI Agent 中被检索和识别
    await actionRegistry.register({
      id: 'ext-hello-say-action',
      commandType: 'hello.say',
      description: '发送一条问候信息，并选择性地将其投射到白板上',
      capabilityRequired: 'whiteboard:write', // 执行该指令需要的安全权限
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '关联的课堂课时 ID' },
          username: { type: 'STRING', description: '被问候的用户名' },
          shout: { type: 'BOOLEAN', description: '是否同时在白板上用大字绘制投射出来' }
        },
        required: ['username']
      }
    });

    // 4. 绑定总线 Handler (指令执行处理器)
    // 任何终端或 AI 派发类型为 'hello.say' 的指令时，此 execute 函数将被调用
    await commandBus.registerHandler('hello.say', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { lessonId, username, shout } = payload;
        
        console.log(`[Hello World Plugin] Command hello.say received! Greeting: ${username}`);

        let elementId = null;

        // 如果用户要求投射到白板，且传入了有效的课堂课时 ID，则调用系统内置的 whiteboard.draw 指令
        if (shout && lessonId) {
          try {
            const drawRes = await commandBus.execute({
              id: 'internal_' + Math.random().toString(36).slice(2),
              type: 'whiteboard.draw',
              actorId: command.actorId || `plugin:${ctx.manifest.id}`,
              payload: {
                lessonId: lessonId,
                type: 'text', // 在画板上绘制一个文字教具
                data: JSON.stringify({
                  text: `Hello World`,
                  x: 150 + Math.random() * 200,
                  y: 100 + Math.random() * 200,
                  fontSize: 24,
                  color: '#4f46e5',
                  fill: '#4f46e5'
                })
              }
            }) as any;
            if (drawRes && drawRes.elementId) {
              elementId = drawRes.elementId;
            }
          } catch (err) {
            console.error('[Hello World Plugin] Failed to draw text on whiteboard:', err);
          }
        }

        // 返回指令执行结果
        return {
          success: true,
          greeting: `Hello, ${username}!`,
          elementId: elementId,
          timestamp: new Date().toISOString()
        };
      }
    });
  },

  // 5. 插件注销函数 (可选)
  deactivate: async () => {
    console.log('[Hello World Plugin] Deactivating hello-world plugin...');
  }
};
