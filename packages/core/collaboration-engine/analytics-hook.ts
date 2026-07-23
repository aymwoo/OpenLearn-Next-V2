/**
 * OpenLearn Teaching Collaboration Engine - Analytics Hook
 * Automatically records collaboration telemetry (participation, edits, discussions, patrols, switches, broadcasts).
 */

import { CollaborationAnalyticsData } from './types.js';

export class CollaborationAnalyticsHook {
  private analytics: CollaborationAnalyticsData = {
    participationCount: 0,
    editCount: 0,
    discussionCount: 0,
    teacherPatrolCount: 0,
    groupSwitchCount: 0,
    broadcastCount: 0,
  };

  public recordParticipation(): void {
    this.analytics.participationCount += 1;
  }

  public recordEdit(): void {
    this.analytics.editCount += 1;
  }

  public recordDiscussion(): void {
    this.analytics.discussionCount += 1;
  }

  public recordTeacherPatrol(): void {
    this.analytics.teacherPatrolCount += 1;
  }

  public recordGroupSwitch(): void {
    this.analytics.groupSwitchCount += 1;
  }

  public recordBroadcast(): void {
    this.analytics.broadcastCount += 1;
  }

  public getAnalytics(): Readonly<CollaborationAnalyticsData> {
    return Object.freeze({ ...this.analytics });
  }

  public reset(): void {
    this.analytics = {
      participationCount: 0,
      editCount: 0,
      discussionCount: 0,
      teacherPatrolCount: 0,
      groupSwitchCount: 0,
      broadcastCount: 0,
    };
  }
}
