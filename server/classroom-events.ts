// server/classroom-events.ts
//
// 课堂事件的统一发布入口。
//
// 背景：此前课堂里最核心的几条状态变更（全班锁屏、学生进度、随堂作答、
// 课件 attempt、进度模式切换）都是在 REST 路由里直接 `io.emit(...)`，绕过了
// 内核事件总线。后果是：事件不进 `events` 审计表、没有 correlationId 可追踪、
// 无法被其它订阅者（学情统计、课堂报告、未来重放）复用，新增一种事件要同时
// 改发布方和 realtime-bridge 两处。
//
// 本模块把「类型常量 + 发布动作」收在一处，路由层只负责声明意图，不再直接
// 操作 Socket.IO；Socket 投递交给 `server/event-routing.ts` 的声明式路由表。

import { randomBytes } from 'node:crypto';
import { kernelContainer } from '../packages/core/kernel/index.js';
import type { PlatformEvent } from '../packages/core/event-bus/index.js';

/**
 * 课堂域的内核事件类型。
 * 命名规范：`<领域>.<实体>_<过去式动词>`，全小写点号分隔。
 */
export const CLASSROOM_EVENTS = {
  /** 全班锁屏 / 解锁 */
  CLASSROOM_LOCK_CHANGED: 'classroom.lock_changed',
  /** 学生课节进度变化（含 promote 后的强制 100%） */
  STUDENT_PROGRESS_UPDATED: 'student.progress_updated',
  /** 学生已读通知回执 */
  STUDENT_NOTIFICATION_ACKNOWLEDGED: 'student.notification_acknowledged',
  /** 白板随堂练习作答 */
  WHITEBOARD_QUIZ_ANSWERED: 'whiteboard.quiz_answered',
  /** 课件 attempt 日志 / 提交 / 认领 */
  COURSEWARE_ATTEMPT_UPDATED: 'courseware.attempt_updated',
  /** 课节进度模式（manual / auto …）切换 */
  LESSON_PROGRESS_MODE_CHANGED: 'lesson.progress_mode_changed',
} as const;

export type ClassroomEventType = (typeof CLASSROOM_EVENTS)[keyof typeof CLASSROOM_EVENTS];

export interface PublishClassroomEventOptions {
  /** 事件来源标识，写入 `events.source`，默认 `server.classroom`。 */
  source?: string;
  /** 追踪 ID。课堂事件默认用 `lessonId` 或 `attemptId`，便于串联同一条业务流。 */
  correlationId?: string;
}

function newEventId(): string {
  return `evt_${randomBytes(8).toString('hex')}`;
}

/**
 * 发布一条课堂事件。
 *
 * 与直接 `io.emit` 的区别：事件会先进内核总线（被 `events` 审计表记录、可被
 * 任意订阅者消费），再由 `server/event-routing.ts` 声明的路由投递到 Socket。
 *
 * 抛出时不会失败：总线已对单个订阅者做超时与错误隔离，这里再兜一层，保证
 * 「推送失败绝不影响业务请求本身」。
 */
export async function publishClassroomEvent<T>(
  type: ClassroomEventType,
  payload: T,
  options: PublishClassroomEventOptions = {},
): Promise<void> {
  const event: PlatformEvent<T> = {
    id: newEventId(),
    type,
    source: options.source ?? 'server.classroom',
    payload,
    timestamp: Date.now(),
    correlationId: options.correlationId,
  };
  try {
    await kernelContainer.eventBus.publish(event as PlatformEvent);
  } catch (error) {
    // 总线本身已隔离订阅者异常；此处只兜底总线自身的意外故障。
    console.error(`[classroom-events] Failed to publish ${type}:`, error);
  }
}

/**
 * 同步场景下「发了就不管」的写法。
 * 仅用于 REST 处理器里不希望因事件派发而延长响应时间的分支。
 */
export function publishClassroomEventDetached<T>(
  type: ClassroomEventType,
  payload: T,
  options: PublishClassroomEventOptions = {},
): void {
  void publishClassroomEvent(type, payload, options);
}
