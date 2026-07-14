/**
 * ext-quiz-dashboard（V3.2）
 *
 * 消费 ext-quiz-generator 提供的 IQuizStatsService。
 * 演示跨插件类型安全的 DI 解析流程。
 */

import type { PluginContext } from '@openlearn/plugin-sdk';
import type { IQuizStatsService } from 'ext-quiz-generator/contracts';
import { QuizStatsServiceToken } from 'ext-quiz-generator/contracts';

export default {
  manifest: {
    id: 'ext-quiz-dashboard',
    name: 'Quiz Dashboard Plugin',
    version: '1.0.0',
    engines: { openlearn: '^2.5.0' },
  },
  activate: async (ctx: PluginContext) => {
    // V3.2: 编译期类型安全 + 运行时 Token 解析
    const statsService = await ctx.resolve(QuizStatsServiceToken);
    // statsService 类型为 IQuizStatsService，IDE 有完整补全

    // 注册一个诊断工具：列出所有提交记录
    const actionRegistry = ctx.services.actionRegistry;
    await actionRegistry.register({
      id: 'quiz-dashboard-report',
      commandType: 'quiz.dashboard.report',
      description: '获取随堂测验的统计数据（正确率、提交数等）',
      capabilityRequired: 'quiz:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
        },
        required: ['lessonId'],
      },
    });

    const commandBus = ctx.services.commandBus;
    await commandBus.registerHandler('quiz.dashboard.report', {
      async execute(command) {
        const payload = command.payload as any;
        const stats = statsService.getStats(payload.lessonId);
        const all = statsService.getAllSubmissions();
        return {
          lessonId: payload.lessonId,
          stats,
          totalTrackedSubmissions: all.length,
        };
      },
    });

    ctx.log.info('Quiz Dashboard 已激活，IQuizStatsService 解析成功');
  },
  deactivate: async () => {},
};
