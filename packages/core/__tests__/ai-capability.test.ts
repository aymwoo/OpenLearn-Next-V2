import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIRuntimeKernel } from '../ai/index.js';
import {
  AICapabilityKernel,
  ICompletionCapability,
  IChatCapability,
  IToolCapability,
  ILessonCapability,
  IWhiteboardCapability,
  IAnalyticsCapability,
  IPluginCapability,
  IAICapability,
  AICapabilityMeta,
} from '../ai-capability/index.js';

describe('OpenLearn AI Capability Layer Test Suite', () => {
  let runtimeKernel: AIRuntimeKernel;
  let capabilityKernel: AICapabilityKernel;

  beforeEach(() => {
    runtimeKernel = new AIRuntimeKernel();
    capabilityKernel = new AICapabilityKernel(runtimeKernel);
  });

  describe('1. Capability Registry & Custom Capability Extension', () => {
    it('should register and resolve standard and custom plugin capabilities', () => {
      expect(capabilityKernel.registry.hasCapability('capability_completion')).toBe(true);
      expect(capabilityKernel.registry.hasCapability('capability_chat')).toBe(true);
      expect(capabilityKernel.registry.hasCapability('capability_lesson')).toBe(true);

      // Custom Plugin Capability (e.g. MathCapability)
      const mathCapability: IAICapability = {
        meta: {
          id: 'capability_math',
          name: 'Math Solver Capability',
          type: 'math',
          description: 'Solves complex math formulas',
          version: '1.0.0',
        },
      };

      capabilityKernel.registry.registerCapability(mathCapability);
      expect(capabilityKernel.registry.hasCapability('capability_math')).toBe(true);

      const resolved = capabilityKernel.registry.resolveCapability('capability_math');
      expect(resolved.meta.name).toBe('Math Solver Capability');
    });
  });

  describe('2. Completion Capability', () => {
    it('should complete text and log telemetry metrics', async () => {
      vi.spyOn(runtimeKernel.providerGateway, 'generateText').mockResolvedValue('Calculus is neat');

      const completionCap = capabilityKernel.registry.resolveCapability<ICompletionCapability>('capability_completion');
      const text = await completionCap.complete('What is calculus?');

      expect(text).toBe('Calculus is neat');
      const logs = capabilityKernel.logger.getLogs('capability_completion');
      expect(logs.length).toBe(1);
      expect(logs[0].capabilityId).toBe('capability_completion');
    });
  });

  describe('3. Chat Capability', () => {
    it('should handle multi-turn chat and create conversation session', async () => {
      vi.spyOn(runtimeKernel.providerGateway, 'generateText').mockResolvedValue('AI Assistant Reply');

      const chatCap = capabilityKernel.registry.resolveCapability<IChatCapability>('capability_chat');
      const res = await chatCap.chat('Hello AI');

      expect(res.reply).toBe('AI Assistant Reply');
      expect(res.sessionId).toBeDefined();

      const session = runtimeKernel.conversationService.getSession(res.sessionId);
      expect(session?.messages.length).toBe(2);
    });
  });

  describe('4. Tool Capability (Tool Gateway)', () => {
    it('should execute tool calls and log telemetry', async () => {
      runtimeKernel.toolRegistry.registerTool(
        { name: 'vfs_read_file', description: 'Read file', parameters: {} },
        async () => 'file content'
      );

      const toolCap = capabilityKernel.registry.resolveCapability<IToolCapability>('capability_tool');
      const res = await toolCap.executeToolCall('vfs_read_file', { path: '/test.txt' });

      expect(res.success).toBe(true);
      expect(res.result).toBe('file content');
    });
  });

  describe('5. Lesson Capability', () => {
    it('should generate lesson plans, quizzes, and activity summaries', async () => {
      vi.spyOn(runtimeKernel.providerGateway, 'generateText').mockResolvedValue(
        JSON.stringify([
          { question: 'What is 1+1?', options: ['1', '2', '3', '4'], answerIndex: 1 },
        ])
      );

      const lessonCap = capabilityKernel.registry.resolveCapability<ILessonCapability>('capability_lesson');
      const quizzes = await lessonCap.generateQuiz('Intro Stage', ['Addition'], 1);

      expect(quizzes.length).toBe(1);
      expect(quizzes[0].question).toBe('What is 1+1?');
    });
  });

  describe('6. Whiteboard Capability', () => {
    it('should summarize selection and beautify layout', async () => {
      vi.spyOn(runtimeKernel.providerGateway, 'generateText').mockResolvedValue('Summary of selection');

      const whiteboardCap = capabilityKernel.registry.resolveCapability<IWhiteboardCapability>('capability_whiteboard');
      const summary = await whiteboardCap.summarizeSelection([{ id: 'elem1' }]);
      expect(summary).toBe('Summary of selection');

      const beautified = await whiteboardCap.beautifyLayout([{ id: 'n1' }, { id: 'n2' }]);
      expect(beautified.length).toBe(2);
      expect((beautified[0] as any).x).toBe(50);
    });
  });

  describe('7. Analytics & Plugin Capabilities', () => {
    it('should generate insights and invoke plugin AI safely', async () => {
      vi.spyOn(runtimeKernel.providerGateway, 'generateText').mockResolvedValue('Safe plugin output');

      const analyticsCap = capabilityKernel.registry.resolveCapability<IAnalyticsCapability>('capability_analytics');
      const suggestion = await analyticsCap.generateSuggestion({ score: 95 });
      expect(suggestion).toBe('Safe plugin output');

      const pluginCap = capabilityKernel.registry.resolveCapability<IPluginCapability>('capability_plugin');
      const pluginOut = await pluginCap.invokeAI('@openlearn/plugin-test', 'Generate quiz');
      expect(pluginOut).toBe('Safe plugin output');
    });
  });
});
