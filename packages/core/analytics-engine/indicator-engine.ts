/**
 * OpenLearn Learning Analytics Engine - Indicator Engine
 * Synthesizes high-level conceptual indicators (Participation, Focus, Pace, Collaboration, Thinking, Mastery).
 */

import { RawAnalyticsMetrics, HighLevelIndicators, CustomIndicatorDefinition } from './types.js';

export class IndicatorEngine {
  private customIndicators = new Map<string, CustomIndicatorDefinition>();

  public computeIndicators(metrics: RawAnalyticsMetrics): HighLevelIndicators {
    const participationIndex = metrics.participationRate;
    const focusIndex = Math.min(100, Math.round((metrics.activeCount / Math.max(1, metrics.onlineCount)) * 100));
    const paceIndex = Math.min(100, Math.round(metrics.averageTimeSeconds > 0 ? 85 : 50));
    const collaborationIndex = Math.min(100, Math.round((metrics.whiteboardEditCount + metrics.codeExecutionCount) * 5));
    const thinkingActivityIndex = Math.min(100, Math.round(metrics.quizAccuracyRate * 0.6 + metrics.codeExecutionCount * 4));
    const knowledgeMasteryIndex = metrics.quizAccuracyRate;
    const teacherPatrolIndex = Math.min(100, Math.round(metrics.totalInteractions > 0 ? 90 : 30));
    const aiAssistanceIndex = Math.min(100, metrics.aiInvocationCount * 10);

    return Object.freeze({
      participationIndex,
      focusIndex,
      paceIndex,
      collaborationIndex,
      thinkingActivityIndex,
      knowledgeMasteryIndex,
      teacherPatrolIndex,
      aiAssistanceIndex,
      timestamp: Date.now(),
    });
  }

  public registerCustomIndicator(def: CustomIndicatorDefinition): void {
    this.customIndicators.set(def.name, def);
  }

  public computeCustomIndicators(metrics: RawAnalyticsMetrics): Record<string, number> {
    const results: Record<string, number> = {};
    for (const [name, def] of this.customIndicators.entries()) {
      results[name] = def.computeFn(metrics);
    }
    return Object.freeze(results);
  }
}
