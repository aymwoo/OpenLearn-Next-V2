/**
 * OpenLearn Learning Analytics Engine - Publisher & Dashboard Data Facade
 * Query and publishing facade providing data feeds for Teacher, Student, and Admin Dashboards without UI.
 */

import { EventStream } from './event-stream.js';
import { MetricsEngine } from './metrics-engine.js';
import { IndicatorEngine } from './indicator-engine.js';
import { InsightEngine } from './insight-engine.js';
import { RawAnalyticsMetrics, HighLevelIndicators, AnalyticsInsight, NormalizedAnalyticsEvent } from './types.js';

export interface DashboardFeedData {
  readonly metrics: RawAnalyticsMetrics;
  readonly indicators: HighLevelIndicators;
  readonly insights: ReadonlyArray<AnalyticsInsight>;
  readonly timestamp: number;
}

export class AnalyticsPublisher {
  private eventStream: EventStream;
  private metricsEngine: MetricsEngine;
  private indicatorEngine: IndicatorEngine;
  private insightEngine: InsightEngine;

  constructor(
    eventStream: EventStream,
    metricsEngine: MetricsEngine,
    indicatorEngine: IndicatorEngine,
    insightEngine: InsightEngine
  ) {
    this.eventStream = eventStream;
    this.metricsEngine = metricsEngine;
    this.indicatorEngine = indicatorEngine;
    this.insightEngine = insightEngine;
  }

  public getDashboardFeed(windowMs = 3600000): DashboardFeedData {
    const events = this.eventStream.replay(windowMs);
    const metrics = this.metricsEngine.computeMetrics(events);
    const indicators = this.indicatorEngine.computeIndicators(metrics);
    const insights = this.insightEngine.generateInsights(metrics, indicators);

    return Object.freeze({
      metrics,
      indicators,
      insights,
      timestamp: Date.now(),
    });
  }

  public query(predicate: (e: NormalizedAnalyticsEvent) => boolean): ReadonlyArray<NormalizedAnalyticsEvent> {
    return this.eventStream.filter(predicate);
  }

  public subscribe(callback: (feed: DashboardFeedData) => void, intervalMs = 5000): () => void {
    const timer = setInterval(() => {
      callback(this.getDashboardFeed());
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }
}
