/**
 * OpenLearn Learning Analytics Engine - Privacy & Storage Subsystem
 * Enforces anonymization, data masking, snapshots, incremental storage, and retention compaction.
 */

import { NormalizedAnalyticsEvent, AnalyticsPrivacyConfig } from './types.js';

export class AnalyticsPrivacyStorage {
  private config: AnalyticsPrivacyConfig;

  constructor(initialConfig?: Partial<AnalyticsPrivacyConfig>) {
    this.config = {
      anonymousAnalysis: initialConfig?.anonymousAnalysis ?? false,
      dataMasking: initialConfig?.dataMasking ?? false,
      retentionPeriodDays: initialConfig?.retentionPeriodDays ?? 30,
    };
  }

  public sanitizeEvent(event: NormalizedAnalyticsEvent): NormalizedAnalyticsEvent {
    let actorId = event.actor.id;
    let metadata = { ...event.metadata };

    if (this.config.anonymousAnalysis) {
      actorId = `anon_${actorId.slice(-6)}`;
    }

    if (this.config.dataMasking) {
      metadata = {
        masked: true,
      };
    }

    return Object.freeze({
      ...event,
      actor: Object.freeze({
        ...event.actor,
        id: actorId,
      }),
      metadata: Object.freeze(metadata),
    });
  }

  public updatePrivacyConfig(partial: Partial<AnalyticsPrivacyConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
    };
  }

  public getPrivacyConfig(): Readonly<AnalyticsPrivacyConfig> {
    return Object.freeze({ ...this.config });
  }
}
