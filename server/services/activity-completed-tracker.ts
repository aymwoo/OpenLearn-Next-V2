import type { PlatformEvent } from '../../packages/core/event-bus/index.js';
import type { ActivityCompletedEvent } from '../../packages/core/events/activity-events.js';

export interface ActivityCompletedTrackerBus {
  subscribe(type: string, handler: (event: PlatformEvent) => void, callerId?: string): () => void;
}

export interface ActivityCompletedRecentItem {
  source: string;
  activityId: string;
  lessonId: string;
  studentId?: string;
  completedAt: number;
}

export interface ActivityCompletedSnapshot {
  total: number;
  bySource: Record<string, number>;
  byKind: Record<string, number>;
  lastCompletedAt: number | null;
  lastEvent: ActivityCompletedRecentItem | null;
  recent: ActivityCompletedRecentItem[];
}

const RECENT_LIMIT = 20;

/**
 * `activity.completed` 聚合消费者（Phase 2 后续）。
 *
 * 事件本身已由 kernel 的 `'*'` 订阅写入 `events` 表；这里只做内存聚合，
 * 供管理端观察三类来源的覆盖度，并避免按 xuean 行 id 无限增长：
 * - bySource：ecosystem / lesson-activity / classroom-interaction / lesson-engine
 * - byKind：activityId 的命名空间前缀（provider / xuean / classroom-legacy / lesson-engine）
 */
export class ActivityCompletedTracker {
  private total = 0;
  private bySource: Record<string, number> = {};
  private byKind: Record<string, number> = {};
  private lastCompletedAt: number | null = null;
  private lastEvent: ActivityCompletedRecentItem | null = null;
  private recent: ActivityCompletedRecentItem[] = [];
  private unsubscribe?: () => void;

  constructor(private readonly eventBus: ActivityCompletedTrackerBus) {
    this.unsubscribe = this.eventBus.subscribe(
      'activity.completed',
      (event) => this.handle(event),
      'server.activity-completed-tracker',
    );
  }

  public snapshot(): ActivityCompletedSnapshot {
    return {
      total: this.total,
      bySource: { ...this.bySource },
      byKind: { ...this.byKind },
      lastCompletedAt: this.lastCompletedAt,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      recent: this.recent.map((item) => ({ ...item })),
    };
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private handle(event: PlatformEvent): void {
    if (event.type !== 'activity.completed') return;
    const payload = event.payload as Partial<ActivityCompletedEvent> | undefined;
    if (!payload || typeof payload.activityId !== 'string' || typeof payload.source !== 'string') return;

    const activityId = payload.activityId;
    const kind = activityId.includes(':') ? activityId.slice(0, activityId.indexOf(':')) : 'unknown';
    const completedAt = typeof payload.completedAt === 'number' ? payload.completedAt : event.timestamp;
    const item: ActivityCompletedRecentItem = {
      source: payload.source,
      activityId,
      lessonId: typeof payload.lessonId === 'string' ? payload.lessonId : '',
      studentId: typeof payload.studentId === 'string' ? payload.studentId : undefined,
      completedAt,
    };

    this.total += 1;
    this.bySource[item.source] = (this.bySource[item.source] ?? 0) + 1;
    this.byKind[kind] = (this.byKind[kind] ?? 0) + 1;
    this.lastCompletedAt = completedAt;
    this.lastEvent = item;
    this.recent = [...this.recent, item].slice(-RECENT_LIMIT);
  }
}
