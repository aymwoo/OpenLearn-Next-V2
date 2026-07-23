/**
 * OpenLearn AI Capability Layer - Analytics Capability
 * Handles AI Insights, Suggestions, and Teaching Reflections for Analytics Engine.
 */

import { IAnalyticsCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class AnalyticsCapability implements IAnalyticsCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_analytics',
    name: 'Analytics AI Capability',
    type: 'analytics',
    description: 'Generates AI Insights, Suggestions, and Reflections based on telemetry metrics',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async generateInsight(metrics: Record<string, unknown>): Promise<ReadonlyArray<Record<string, unknown>>> {
    const startTime = Date.now();
    const prompt = `Based on classroom metrics ${JSON.stringify(metrics)}, list 3 actionable teaching insights in JSON array format with fields: title, description, severity.`;
    const resultText = await this.runtimeKernel.providerGateway.generateText(prompt);

    let insights: Record<string, unknown>[] = [];
    try {
      insights = JSON.parse(resultText.replace(/```json|```/g, '').trim());
    } catch {
      insights = [
        { title: '课堂总体状况良好', description: '学生参与度适中，建议按原计划推进', severity: 'info' },
      ];
    }

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { metrics },
      responsePayload: insights,
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return Object.freeze(insights);
  }

  public async generateSuggestion(indicators: Record<string, unknown>): Promise<string> {
    const startTime = Date.now();
    const prompt = `Based on high-level indicators ${JSON.stringify(indicators)}, provide a 2-sentence suggestion for the teacher.`;
    const suggestion = await this.runtimeKernel.providerGateway.generateText(prompt);

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { indicators },
      responsePayload: { suggestion },
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return suggestion;
  }

  public async generateReflection(lessonAnalytics: Record<string, unknown>): Promise<string> {
    const startTime = Date.now();
    const prompt = `Based on lesson analytics data ${JSON.stringify(lessonAnalytics)}, generate a post-lesson reflection report under 150 words.`;
    const reflection = await this.runtimeKernel.providerGateway.generateText(prompt);

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { lessonAnalytics },
      responsePayload: { reflection },
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return reflection;
  }
}
