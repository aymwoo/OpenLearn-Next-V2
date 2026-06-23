import { ICommandBusServiceToken, IActionRegistryServiceToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  manifest: {
    id: "ext-quiz-generator",
    name: "Quiz Component Plugin",
    version: "1.0.0"
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    await actionRegistry.register({
      id: 'ext-quiz-create',
      commandType: 'quiz.create',
      description: '【创建课堂选择题】在白板上生成一道交互式选择题。'
        + ' 自动处理题型格式、位置、尺寸。'
        + ' 这是创建测验题目的首选工具（优于直接调用 whiteboard.draw）。',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          question: { type: 'STRING', description: '题目文字' },
          options: { type: 'ARRAY', items: { type: 'STRING' }, description: '选项列表，如 ["A. 答案1", "B. 答案2"]' }
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
            data: JSON.stringify({
              question: payload.question,
              options: payload.options,
              // 方案 B：补齐位置、页码等元数据，避免完全依赖服务端注入和前端默认值
              x: payload.x ?? 120,
              y: payload.y ?? 120,
              width: payload.width ?? 320,
              height: payload.height ?? 280,
              page: payload.page ?? 0,
              isMinimized: false,
            })
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
