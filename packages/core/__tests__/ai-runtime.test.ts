import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AIRuntimeKernel,
  AIToolSchema,
} from '../ai/index.js';
import { AIService } from '../di/ai-service.js';

describe('OpenLearn AI Infrastructure Core Test Suite', () => {
  let kernel: AIRuntimeKernel;

  beforeEach(() => {
    kernel = new AIRuntimeKernel();
  });

  describe('1. Prompt Registry & Variable Interpolation', () => {
    it('should register default prompts and interpolate variables', () => {
      const built = kernel.promptRegistry.buildPrompt('stage_quiz_generation', {
        title: '微积分极值',
        knowledgePoints: '导数, 驻点',
        teachingGoals: '掌握极值判定',
        count: 2,
      });

      expect(built).toContain('微积分极值');
      expect(built).toContain('导数, 驻点');
      expect(built).toContain('2 multiple choice questions');
    });
  });

  describe('2. AI Context Service', () => {
    it('should combine multiple context slices into unified context prompt', () => {
      const combined = kernel.contextService.buildCombinedContext({
        teacherContext: '教师：张老师',
        lessonContext: '课程：高等数学',
        stageContext: '阶段：新知讲解',
      });

      expect(combined).toContain('[Teacher Context]\n教师：张老师');
      expect(combined).toContain('[Lesson Context]\n课程：高等数学');
      expect(combined).toContain('[Stage Context]\n阶段：新知讲解');
    });
  });

  describe('3. Tool Registry & Execution', () => {
    it('should register tool schema and execute tool with registered executor', async () => {
      const toolSchema: AIToolSchema = {
        name: 'test_action',
        description: '测试动作',
        parameters: { type: 'object' },
      };

      const executor = vi.fn().mockResolvedValue({ success: true, resultData: 'OK' });
      kernel.toolRegistry.registerTool(toolSchema, executor);

      const openAITools = kernel.toolRegistry.getOpenAITools();
      expect(openAITools.length).toBe(1);
      expect(openAITools[0].function.name).toBe('test_action');

      const result = await kernel.toolRegistry.executeTool('test_action', { foo: 'bar' });
      expect(result.success).toBe(true);
      expect(executor).toHaveBeenCalledWith('test_action', { foo: 'bar' });
    });
  });

  describe('4. Conversation Service', () => {
    it('should manage multi-turn session history and messages', () => {
      const session = kernel.conversationService.createSession('测试会话');
      expect(session.title).toBe('测试会话');

      kernel.conversationService.addMessage(session.id, 'user', '你好！');
      kernel.conversationService.addMessage(session.id, 'assistant', '你好，我是教育 OS Agent。');

      const updated = kernel.conversationService.getSession(session.id);
      expect(updated?.messages.length).toBe(2);
      expect(updated?.messages[1].role).toBe('assistant');
    });
  });

  describe('5. Memory & Streaming Services', () => {
    it('should set, get memory and handle streaming sessions', () => {
      kernel.memoryService.setMemory('activeLessonId', 'les_1001');
      expect(kernel.memoryService.getMemory<string>('activeLessonId')).toBe('les_1001');

      const streamSpy = vi.fn();
      kernel.eventBus.subscribe('StreamingFinished', streamSpy);

      const stream = kernel.streamingService.createStreamSession();
      stream.finish(1024);

      expect(streamSpy).toHaveBeenCalled();
    });
  });

  describe('6. AI Event Bus Telemetry', () => {
    it('should publish typed AI events', async () => {
      const modelSpy = vi.fn();
      kernel.eventBus.subscribe('ModelStarted', modelSpy);

      await kernel.eventBus.publish('ModelStarted', {
        providerId: 'prov_test',
        modelName: 'gpt-4o',
        promptLength: 100,
      });

      expect(modelSpy).toHaveBeenCalled();
    });
  });

  describe('7. AIService Facade Backward Compatibility', () => {
    it('should instantiate AIService and use provider gateway facade', async () => {
      const mockDb = {
        prepare: () => ({
          get: () => undefined,
        }),
      } as any;

      process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
      const aiService = new AIService(mockDb);

      await expect(aiService.generateText('hello')).rejects.toThrow(
        'GEMINI_API_KEY is not configured in the environment.'
      );
    });
  });
});
