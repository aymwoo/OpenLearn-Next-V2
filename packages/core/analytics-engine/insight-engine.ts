/**
 * OpenLearn Learning Analytics Engine - Insight Engine
 * Rule-based automated insight generator producing actionable classroom alerts without AI dependencies.
 */

import {
  RawAnalyticsMetrics,
  HighLevelIndicators,
  AnalyticsInsight,
  CustomInsightRule,
} from './types.js';

export class InsightEngine {
  private customRules: CustomInsightRule[] = [];

  public generateInsights(
    metrics: RawAnalyticsMetrics,
    indicators: HighLevelIndicators
  ): ReadonlyArray<AnalyticsInsight> {
    const insights: AnalyticsInsight[] = [];
    const now = Date.now();

    // Rule 1: Low Participation Alert
    if (indicators.participationIndex < 50) {
      insights.push({
        id: `ins_${globalThis.crypto.randomUUID()}`,
        title: '课堂互动度偏低预警',
        description: `当前课堂参与率仅为 ${indicators.participationIndex}%，建议发起随堂提问或互动小测。`,
        severity: 'warning',
        category: 'interaction',
        recommendation: '使用提问插件或开启小组研讨模式',
        timestamp: now,
      });
    }

    // Rule 2: Low Quiz Accuracy Alert
    if (metrics.quizAnswerRate > 0 && metrics.quizAccuracyRate < 50) {
      insights.push({
        id: `ins_${globalThis.crypto.randomUUID()}`,
        title: '知识点答题正确率偏低',
        description: `随堂测验正确率仅为 ${metrics.quizAccuracyRate}%，多数学生未能完全掌握核心概念。`,
        severity: 'critical',
        category: 'mastery',
        recommendation: '暂停推进新知，进行重点例题推导讲授',
        timestamp: now,
      });
    }

    // Rule 3: Low Completion Rate Alert
    if (metrics.completionRate < 40 && metrics.totalInteractions > 5) {
      insights.push({
        id: `ins_${globalThis.crypto.randomUUID()}`,
        title: '小组/个人任务完成进度滞后',
        description: `当前任务完成率仅为 ${metrics.completionRate}%，建议适当延长互动环节时长。`,
        severity: 'warning',
        category: 'completion',
        recommendation: '巡视进度滞后的小组或下发解题提示',
        timestamp: now,
      });
    }

    // Apply Custom Plugin Rules
    for (const rule of this.customRules) {
      try {
        const customInsight = rule.evaluateFn(metrics, indicators);
        if (customInsight) insights.push(customInsight);
      } catch (err: unknown) {
        console.error(`[InsightEngine] Error evaluating custom rule ${rule.id}:`, err);
      }
    }

    return Object.freeze(insights);
  }

  public registerInsightRule(rule: CustomInsightRule): void {
    this.customRules.push(rule);
  }
}
