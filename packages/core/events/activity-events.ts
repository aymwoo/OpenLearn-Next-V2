import crypto from 'node:crypto';
import type { EventBusPort } from '../event-bus/index.js';

export type ActivityCompletedSource = 'ecosystem' | 'lesson-activity' | 'classroom-interaction' | 'lesson-engine';

export interface ActivityCompletedEvent {
  type: 'activity.completed';
  source: ActivityCompletedSource;
  activityId: string;
  lessonId: string;
  sessionId?: string;
  classId?: string;
  /** 个人完成时填；全班完成时省略。 */
  studentId?: string;
  completedAt: number;
  raw?: Record<string, unknown>;
}

/**
 * 统一 activity.completed 出口。
 *
 * 旁路设计：发布失败只告警，不影响原有完成逻辑。
 */
export function publishActivityCompleted(
  eventBus: EventBusPort | undefined,
  event: Omit<ActivityCompletedEvent, 'type' | 'completedAt'> & { completedAt?: number },
): void {
  if (!eventBus) return;
  const completedAt = event.completedAt ?? Date.now();
  const payload: ActivityCompletedEvent = {
    type: 'activity.completed',
    ...event,
    completedAt,
  };

  void eventBus
    .publish({
      id: `evt_activity_completed_${crypto.randomUUID()}`,
      type: 'activity.completed',
      source: event.source,
      payload,
      timestamp: completedAt,
      correlationId: event.lessonId,
    })
    .catch((err) => {
      console.warn('[activity.completed] publish failed:', err);
    });
}
