import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AnalyticsEngineKernel,
  NormalizedAnalyticsEvent,
  CustomMetricDefinition,
  CustomIndicatorDefinition,
  CustomInsightRule,
} from '../analytics-engine/index.js';

describe('OpenLearn Learning Analytics Engine Core Test Suite', () => {
  let kernel: AnalyticsEngineKernel;

  beforeEach(() => {
    kernel = new AnalyticsEngineKernel();
  });

  describe('1. Collector, Normalizer & Stream', () => {
    it('should collect, normalize, and stream raw telemetry events', () => {
      const subSpy = vi.fn();
      kernel.eventStream.subscribe(subSpy);

      const event = kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        metadata: { isCorrect: true, score: 100 },
      });

      expect(event.eventId).toContain('evt_');
      expect(event.eventType).toBe('QuizSubmitted');
      expect(subSpy).toHaveBeenCalled();

      const events = kernel.eventStream.replay();
      expect(events.length).toBe(1);
    });
  });

  describe('2. Metrics Engine', () => {
    it('should compute raw physical metrics from events', () => {
      kernel.collector.collect({
        eventType: 'StudentJoined',
        actor: { id: 'usr_s1', role: 'Student' },
      });
      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        metadata: { isCorrect: true },
      });
      kernel.collector.collect({
        eventType: 'CodeExecuted',
        actor: { id: 'usr_s1', role: 'Student' },
      });
      kernel.collector.collect({
        eventType: 'WhiteboardEdited',
        actor: { id: 'usr_s1', role: 'Student' },
      });

      const metrics = kernel.metricsEngine.computeMetrics(kernel.eventStream.replay());
      expect(metrics.activeCount).toBe(1);
      expect(metrics.participationRate).toBe(100);
      expect(metrics.quizAccuracyRate).toBe(100);
      expect(metrics.codeExecutionCount).toBe(1);
      expect(metrics.whiteboardEditCount).toBe(1);
    });
  });

  describe('3. Indicator Engine', () => {
    it('should synthesize high-level conceptual indicators from raw metrics', () => {
      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        metadata: { isCorrect: true },
      });

      const metrics = kernel.metricsEngine.computeMetrics(kernel.eventStream.replay());
      const indicators = kernel.indicatorEngine.computeIndicators(metrics);

      expect(indicators.participationIndex).toBe(100);
      expect(indicators.knowledgeMasteryIndex).toBe(100);
      expect(indicators.thinkingActivityIndex).toBeGreaterThan(0);
    });
  });

  describe('4. Domain Analytics Models', () => {
    it('should compute student, group, lesson, code, quiz, and AI domain analytics', () => {
      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        lessonId: 'les_101',
        stageId: 'stg_quiz',
        metadata: { isCorrect: true, groupId: 'grp_1' },
      });

      const events = kernel.eventStream.replay();

      const studentData = kernel.domainAnalytics.computeStudentAnalytics('usr_s1', events);
      expect(studentData.totalQuizSubmits).toBe(1);
      expect(studentData.correctQuizSubmits).toBe(1);

      const groupData = kernel.domainAnalytics.computeGroupAnalytics('grp_1', events);
      expect(groupData.groupId).toBe('grp_1');

      const quizData = kernel.domainAnalytics.computeQuizAnalytics(events);
      expect(quizData.accuracyRate).toBe(100);

      const aiData = kernel.domainAnalytics.computeAIAnalytics(events);
      expect(aiData.callCount).toBe(0);
    });
  });

  describe('5. Automated Insight Engine', () => {
    it('should generate rule-based insights when thresholds are met', () => {
      // Collect quiz submit with incorrect answer -> 0% accuracy
      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        metadata: { isCorrect: false },
      });

      const metrics = kernel.metricsEngine.computeMetrics(kernel.eventStream.replay());
      const indicators = kernel.indicatorEngine.computeIndicators(metrics);
      const insights = kernel.insightEngine.generateInsights(metrics, indicators);

      expect(insights.length).toBeGreaterThan(0);
      const masteryAlert = insights.find((i) => i.category === 'mastery');
      expect(masteryAlert).toBeDefined();
      expect(masteryAlert?.severity).toBe('critical');
    });
  });

  describe('6. Prediction Provider Facade', () => {
    it('should provide learning outcome and pace predictions', async () => {
      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
        metadata: { isCorrect: true },
      });

      const prediction = await kernel.predictionProvider.predictLearningOutcome('usr_s1');
      expect(prediction.targetStudentId).toBe('usr_s1');
      expect(prediction.predictedCompletionRate).toBeGreaterThan(0);
      expect(prediction.riskLevel).toBe('low');
    });
  });

  describe('7. Privacy & Storage Controls', () => {
    it('should support anonymous mode masking', () => {
      kernel.privacyStorage.updatePrivacyConfig({ anonymousAnalysis: true });

      const event = kernel.collector.collect({
        eventType: 'CodeExecuted',
        actor: { id: 'usr_secret_123', role: 'Student' },
      });

      expect(event.actor.id).toContain('anon_');
    });
  });

  describe('8. Publisher & Dashboard Data Feed', () => {
    it('should aggregate data into Dashboard Feed', () => {
      kernel.collector.collect({
        eventType: 'StudentJoined',
        actor: { id: 'usr_s1', role: 'Student' },
      });

      const feed = kernel.publisher.getDashboardFeed();
      expect(feed.metrics).toBeDefined();
      expect(feed.indicators).toBeDefined();
      expect(feed.insights).toBeDefined();
    });
  });

  describe('9. Plugin SDK Extensions', () => {
    it('should allow registering custom metrics, indicators, and insight rules', () => {
      const customMetric: CustomMetricDefinition = {
        name: 'testMetric',
        description: 'Test',
        computeFn: (events) => events.length * 2,
      };

      const customIndicator: CustomIndicatorDefinition = {
        name: 'testIndicator',
        description: 'Test',
        computeFn: (metrics) => metrics.activeCount * 10,
      };

      const customRule: CustomInsightRule = {
        id: 'testRule',
        evaluateFn: () => ({
          id: 'ins_custom',
          title: '自定义警示',
          description: '插件提示',
          severity: 'info',
          category: 'interaction',
          timestamp: Date.now(),
        }),
      };

      kernel.registerMetric(customMetric);
      kernel.registerIndicator(customIndicator);
      kernel.registerInsight(customRule);

      kernel.collector.collect({
        eventType: 'QuizSubmitted',
        actor: { id: 'usr_s1', role: 'Student' },
      });


      const events = kernel.eventStream.replay();
      const metrics = kernel.metricsEngine.computeMetrics(events);
      const indicators = kernel.indicatorEngine.computeIndicators(metrics);

      const customMetricsRes = kernel.metricsEngine.computeCustomMetrics(events);
      expect(customMetricsRes['testMetric']).toBe(2);

      const customIndicatorsRes = kernel.indicatorEngine.computeCustomIndicators(metrics);
      expect(customIndicatorsRes['testIndicator']).toBe(10);

      const insights = kernel.insightEngine.generateInsights(metrics, indicators);
      expect(insights.some((i) => i.id === 'ins_custom')).toBe(true);
    });
  });
});
