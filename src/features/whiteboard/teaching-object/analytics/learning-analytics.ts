import type { LearningAnalyticsRecord } from '../types.js';

export class LearningAnalyticsEngine {
  private records = new Map<string, LearningAnalyticsRecord>();

  public startTrack(objectId: string): void {
    if (!this.records.has(objectId)) {
      this.records.set(objectId, {
        objectId,
        startTime: Date.now(),
        participantCount: 0,
        submissionCount: 0,
        completionRate: 0,
        errorRate: 0,
      });
    }
  }

  public recordSubmission(objectId: string, isCorrect: boolean = true): void {
    const record = this.records.get(objectId);
    if (!record) return;

    record.submissionCount++;
    record.participantCount = Math.max(record.participantCount, record.submissionCount);
    record.completionRate = Math.min(1, record.submissionCount / Math.max(1, record.participantCount));
    
    if (!isCorrect) {
      record.errorRate = (record.errorRate * (record.submissionCount - 1) + 1) / record.submissionCount;
    } else {
      record.errorRate = (record.errorRate * (record.submissionCount - 1)) / record.submissionCount;
    }
  }

  public endTrack(objectId: string): LearningAnalyticsRecord | undefined {
    const record = this.records.get(objectId);
    if (record) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
    }
    return record;
  }

  public getRecord(objectId: string): LearningAnalyticsRecord | undefined {
    return this.records.get(objectId);
  }
}

export const learningAnalyticsEngine = new LearningAnalyticsEngine();
