import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: "ext-quiz-generator",
    name: "Quiz Component Plugin",
    version: "1.0.0",
    engines: { openlearn: '^2.5.0' },
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
          options: { type: 'ARRAY', items: { type: 'STRING' }, description: '选项列表，如 ["A. 答案1", "B. 答案2"]' },
          correctAnswer: { type: 'STRING', description: '正确答案，值应对应 options 中的某一项，如 "A. 答案1"' }
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
            type: 'plugin',
            data: JSON.stringify({
              pluginId: 'ext-quiz-generator',
              title: '随堂测验',
              teacherWidgetId: 'quiz-teacher-widget',
              studentWidgetId: 'quiz-student-view',
              width: payload.width ?? 350,
              height: payload.height ?? 300,
              page: payload.page ?? 0,
              question: payload.question,
              options: payload.options,
              correctAnswer: payload.correctAnswer || 'A',
              submissions: {},
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
