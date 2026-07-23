/**
 * OpenLearn Learning Analytics Engine - Metrics Engine
 * Computes raw classroom metrics (online, active, participation, accuracy, duration, counts).
 */

import { NormalizedAnalyticsEvent, RawAnalyticsMetrics, CustomMetricDefinition } from './types.js';

export class MetricsEngine {
  private customMetrics = new Map<string, CustomMetricDefinition>();

  public computeMetrics(events: ReadonlyArray<NormalizedAnalyticsEvent>): RawAnalyticsMetrics {
    let onlineCount = 0;
    let activeCount = 0;
    let quizSubmits = 0;
    let quizCorrect = 0;
    let codeExecutions = 0;
    let whiteboardEdits = 0;
    let aiCalls = 0;

    const studentIds = new Set<string>();
    const activeStudentIds = new Set<string>();

    for (const e of events) {
      if (e.actor.role === 'Student' || e.actor.role === 'student') {
        studentIds.add(e.actor.id);
      }

      if (e.eventType === 'StudentJoined' || e.eventType === 'PresenceChanged') {
        onlineCount = Math.max(onlineCount, studentIds.size);
      }

      if (
        e.eventType === 'QuizSubmitted' ||
        e.eventType === 'CodeExecuted' ||
        e.eventType === 'WhiteboardEdited' ||
        e.eventType === 'DiscussionPosted'
      ) {
        activeStudentIds.add(e.actor.id);
      }

      if (e.eventType === 'QuizSubmitted') {
        quizSubmits += 1;
        if (e.metadata && (e.metadata as Record<string, unknown>).isCorrect) {
          quizCorrect += 1;
        }
      }

      if (e.eventType === 'CodeExecuted') {
        codeExecutions += 1;
      }

      if (e.eventType === 'WhiteboardEdited') {
        whiteboardEdits += 1;
      }

      if (e.eventType === 'AIResponse' || e.eventType === 'AIInvoked') {
        aiCalls += 1;
      }
    }

    activeCount = activeStudentIds.size;
    const totalStudents = Math.max(studentIds.size, 1);
    const participationRate = Math.min(100, Math.round((activeCount / totalStudents) * 100));
    const quizAccuracyRate = quizSubmits > 0 ? Math.round((quizCorrect / quizSubmits) * 100) : 0;
    const quizAnswerRate = Math.min(100, Math.round((quizSubmits / totalStudents) * 100));

    return Object.freeze({
      onlineCount: Math.max(onlineCount, totalStudents),
      activeCount,
      participationRate,
      totalInteractions: events.length,
      quizAnswerRate,
      quizAccuracyRate,
      averageTimeSeconds: Math.round(events.length * 1.5),
      completionRate: Math.min(100, Math.round((quizSubmits / Math.max(1, totalStudents)) * 100)),
      codeExecutionCount: codeExecutions,
      whiteboardEditCount: whiteboardEdits,
      aiInvocationCount: aiCalls,
      timestamp: Date.now(),
    });
  }

  public registerCustomMetric(def: CustomMetricDefinition): void {
    this.customMetrics.set(def.name, def);
  }

  public computeCustomMetrics(events: ReadonlyArray<NormalizedAnalyticsEvent>): Record<string, number> {
    const results: Record<string, number> = {};
    for (const [name, def] of this.customMetrics.entries()) {
      results[name] = def.computeFn(events);
    }
    return Object.freeze(results);
  }
}
