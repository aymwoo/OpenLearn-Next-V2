import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  // 插件元数据声明，满足 ESM 激活时的 manifest 属性检查
  manifest: {
    id: "ext-mindmap-assistant",
    name: "思维导图与画板卡片扩展",
    version: "1.1.0"
  },

  // 激活入口 activate
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    // 注册自定义指令元数据，这样指令就会出现在内核控制台及命令总线列表中
    await actionRegistry.register({
      id: 'ext-mindmap-generate',
      commandType: 'mindmap.create',
      description: '为当前白板一键生成结构化的知识思维导图卡片',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '关联的课堂课时 ID' },
          topic: { type: 'STRING', description: '思维导图的中心主题名称' },
          nodes: { 
            type: 'ARRAY', 
            items: { type: 'STRING' },
            description: '脑图的子分支节点列表'
          }
        },
        required: ['lessonId', 'topic', 'nodes']
      }
    });

    // 注册该命令的处理器：当 CommandBus 调度 mindmap.create 时触发
    await commandBus.registerHandler('mindmap.create', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { lessonId, topic, nodes } = payload;
        
        // 调用内核白板 API 在交互画板上绘制思维导图卡片
        const drawResult = await commandBus.execute({
          id: 'internal_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || 'system-plugin',
          payload: {
            lessonId: lessonId,
            type: 'mindmap',
            data: JSON.stringify({
              title: topic,
              branches: nodes,
              themeColor: '#6366f1',
              createdAt: new Date().toISOString()
            })
          }
        }) as any;

        return { 
          success: true, 
          elementId: drawResult?.elementId || 'mock-elt-202',
          message: `已经成功在白板上完成主题【${topic}】的脑图渲染！` 
        };
      }
    });
  }
};
