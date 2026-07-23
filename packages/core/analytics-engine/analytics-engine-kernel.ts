/**
 * OpenLearn Learning Analytics Engine Kernel
 * Master orchestrator connecting Collectors, Normalizer, Stream, Metrics, Indicators, Insights, Prediction, and Storage.
 */

import { EventNormalizer } from './normalizer.js';
import { EventStream } from './event-stream.js';
import { MetricsEngine } from './metrics-engine.js';
import { IndicatorEngine } from './indicator-engine.js';
import { DomainAnalyticsEngine } from './domain-analytics.js';
import { InsightEngine } from './insight-engine.js';
import { DefaultPredictionProvider } from './prediction-provider.js';
import { AnalyticsPrivacyStorage } from './privacy-storage.js';
import { AnalyticsCollector } from './analytics-collector.js';
import { AnalyticsPublisher } from './analytics-publisher.js';
import {
  CustomMetricDefinition,
  CustomIndicatorDefinition,
  CustomInsightRule,
} from './types.js';

export class AnalyticsEngineKernel {
  public readonly normalizer: EventNormalizer;
  public readonly eventStream: EventStream;
  public readonly metricsEngine: MetricsEngine;
  public readonly indicatorEngine: IndicatorEngine;
  public readonly domainAnalytics: DomainAnalyticsEngine;
  public readonly insightEngine: InsightEngine;
  public readonly predictionProvider: DefaultPredictionProvider;
  public readonly privacyStorage: AnalyticsPrivacyStorage;
  public readonly collector: AnalyticsCollector;
  public readonly publisher: AnalyticsPublisher;

  private registeredCollectors = new Map<string, unknown>();

  constructor() {
    this.normalizer = new EventNormalizer();
    this.eventStream = new EventStream();
    this.metricsEngine = new MetricsEngine();
    this.indicatorEngine = new IndicatorEngine();
    this.domainAnalytics = new DomainAnalyticsEngine();
    this.insightEngine = new InsightEngine();
    this.privacyStorage = new AnalyticsPrivacyStorage();

    this.collector = new AnalyticsCollector(
      this.normalizer,
      this.privacyStorage,
      this.eventStream
    );

    this.publisher = new AnalyticsPublisher(
      this.eventStream,
      this.metricsEngine,
      this.indicatorEngine,
      this.insightEngine
    );

    this.predictionProvider = new DefaultPredictionProvider(() =>
      this.metricsEngine.computeMetrics(this.eventStream.replay())
    );
  }

  // ── Plugin SDK Extension API ───────────────────────────────────────────

  public registerMetric(definition: CustomMetricDefinition): void {
    this.metricsEngine.registerCustomMetric(definition);
  }

  public registerIndicator(definition: CustomIndicatorDefinition): void {
    this.indicatorEngine.registerCustomIndicator(definition);
  }

  public registerCollector(collectorId: string, collectorInstance: unknown): void {
    this.registeredCollectors.set(collectorId, collectorInstance);
  }

  public registerInsight(rule: CustomInsightRule): void {
    this.insightEngine.registerInsightRule(rule);
  }

  public dispose(): void {
    this.eventStream.clear();
    this.registeredCollectors.clear();
  }
}
