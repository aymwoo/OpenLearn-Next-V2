/**
 * OpenLearn AI Capability Layer - Lesson Capability
 * Handles Lesson Flow, Quiz Generation, and Activity Summaries for Lesson Engine.
 */

import { ILessonCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class LessonCapability implements ILessonCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_lesson',
    name: 'Lesson Flow & Content Generation Capability',
    type: 'lesson',
    description: 'Generates structured lesson flows, quizzes, and activity summaries',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async generateLessonPlan(
    subject: string,
    grade: string,
    topic: string
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const prompt = this.runtimeKernel.promptRegistry.buildPrompt('lesson_plan_generation', {
      subject,
      grade,
      topic,
    });

    try {
      const rawText = await this.runtimeKernel.providerGateway.generateText(prompt);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      } catch {
        parsed = { rawContent: rawText };
      }

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { subject, grade, topic },
        responsePayload: parsed,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        timestamp: Date.now(),
      });

      return parsed;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { subject, grade, topic },
        responsePayload: null,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        error: errorMsg,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  public async generateQuiz(
    stageTitle: string,
    knowledgePoints: ReadonlyArray<string>,
    count = 3
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const startTime = Date.now();
    const prompt = this.runtimeKernel.promptRegistry.buildPrompt('stage_quiz_generation', {
      title: stageTitle,
      knowledgePoints: knowledgePoints.join(', '),
      teachingGoals: '教学目标巩固',
      count,
    });

    try {
      const rawText = await this.runtimeKernel.providerGateway.generateText(prompt);
      let quizzes: Record<string, unknown>[] = [];
      try {
        quizzes = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      } catch {
        quizzes = knowledgePoints.map((kp) => ({
          question: `关于 ${kp}，下列哪项说法是正确的？`,
          options: [`${kp} 概念A`, `${kp} 概念B`, `${kp} 概念C`, `以上均正确`],
          answerIndex: 3,
        }));
      }

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { stageTitle, knowledgePoints, count },
        responsePayload: quizzes,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        timestamp: Date.now(),
      });

      return Object.freeze(quizzes);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { stageTitle, knowledgePoints, count },
        responsePayload: null,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        error: errorMsg,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  public async generateSummary(activityTitle: string, activityType: string): Promise<string> {
    const startTime = Date.now();
    const prompt = this.runtimeKernel.promptRegistry.buildPrompt('activity_summary', {
      title: activityTitle,
      type: activityType,
    });

    try {
      const result = await this.runtimeKernel.providerGateway.generateText(prompt);

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { activityTitle, activityType },
        responsePayload: { result },
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        timestamp: Date.now(),
      });

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { activityTitle, activityType },
        responsePayload: null,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        error: errorMsg,
        timestamp: Date.now(),
      });
      throw err;
    }
  }
}
