export function parsePluginSource(codeStr: string): any {
  if (!codeStr || typeof codeStr !== 'string') return null;
  try {
    const fn = new Function('exports', 'require', 'module', codeStr);
    const exportsObj: any = {};
    const moduleObj = { exports: exportsObj };

    const mockRequire = (modName: string) => {
      if (modName === '@openlearn/plugin-sdk') {
        return {
          ICommandBusServiceToken: '@openlearn/core:ICommandBusService',
          IEventBusServiceToken: '@openlearn/core:IEventBusService',
          IActionRegistryServiceToken: '@openlearn/core:IActionRegistryService',
          ICapabilityServiceToken: '@openlearn/core:ICapabilityService',
          IProcessServiceToken: '@openlearn/core:IProcessService',
          IStorageServiceToken: '@openlearn/core:IStorageService',
          IAIServiceToken: '@openlearn/core:IAIService',
          IDatabaseToken: '@openlearn/core:IDatabase',
          IPluginHostToken: '@openlearn/core:IPluginHost',
        };
      }
      return {};
    };

    fn(exportsObj, mockRequire, moduleObj);
    return moduleObj.exports.default || exportsObj.default || moduleObj.exports;
  } catch (e) {
    return null;
  }
}

export const DEFAULT_PLUGIN = `exports.default = {
  manifest: {
    id: "ext-ai-quiz-gen",
    name: "AI Course Quiz Generator (智能测验生成器)",
    version: "1.0.0",
    description: "自动根据教案主题或特定文本，一键生成结构化的单选/多选随堂测验，并直接分发至指定班级的学生学习终端。",
    author: "EduOS AI Team",
    capabilitiesProposed: ["lesson:read", "whiteboard:write"]
  },
  activate: async (ctx) => {
    ctx.actionRegistry.register({
      id: 'ext-quiz-create',
      commandType: 'quiz.create',
      description: '为指定课时快速创建一份包含指定题目的随堂测验卷，可直接投射至白板或学生端',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '关联的课时 ID' },
          title: { type: 'STRING', description: '测验标题' },
          questionsCount: { type: 'INTEGER', description: '自动生成的题目数量 (1-10)' }
        },
        required: ['lessonId', 'title']
      }
    });

    ctx.commandBus.registerHandler('quiz.create', {
      execute: async (command) => {
        const payload = command.payload;
        const count = payload.questionsCount || 3;
        
        const mockQuestions = Array.from({ length: count }).map((_, i) => ({
          id: 'q_' + (i + 1),
          question: \`关于\${payload.title}的第 \${i + 1} 道随堂思考题？\`,
          options: ["选项 A: 基础概念描述", "选项 B: 核心定理应用", "选项 C: 边界条件推导", "选项 D: 实验验证方法"],
          answerIndex: i % 4
        }));

        const quizData = {
          quizId: 'qz_' + Math.random().toString(36).slice(2, 9),
          lessonId: payload.lessonId,
          title: payload.title,
          questions: mockQuestions,
          createdTime: new Date().toISOString()
        };

        await ctx.eventBus.publish({
          id: 'evt_' + Math.random().toString(36).slice(2),
          type: 'quiz.created',
          source: 'plugin.ext-ai-quiz-gen',
          payload: quizData,
          timestamp: Date.now()
        });

        return {
          success: true,
          quiz: quizData,
          message: \`已为课时 \${payload.lessonId} 成功生成包含 \${count} 道题目的测验包！\`
        };
      }
    });
  }
};`;
