/**
 * 白板事件槽 - 类型定义
 *
 * 白板内所有组件事件（iframe postMessage、widget 提交、手动录入、quiz/canvas）
 * 统一进入 WhiteboardEventSlot，供教师面板、AI 助手、批改模块、调试 UI 订阅。
 *
 * 设计目标：
 * - 采集层（HtmlAppletFrame / lms-bridge / widget）不知道谁会订阅
 * - 队列层提供可重放历史 + 过滤
 * - 分发层提供 subscribe + 同步 frontendEventBus
 */

import type { PlatformEvent } from '../../../../packages/core/event-bus';

/** 事件来源 */
export type WhiteboardEventSource =
  | 'iframe.postMessage' // iframe 直接 postMessage（未规范化）
  | 'iframe.bridge' // 父窗口 LMS Bridge 处理后的协议事件
  | 'widget.quiz' // 原生 quiz widget
  | 'widget.canvas' // 原生画布 widget
  | 'widget.custom' // 通用自定义 widget
  | 'applet.score' // 来自 HtmlAppletFrame 解析后的成绩事件
  | 'manual'; // 手动 emit（UI / 调试代码）

/** 白板事件载荷（标准化后） */
export interface WhiteboardEventPayload {
  /** 课程 id（可选，跨课程事件不填） */
  lessonId?: string;
  /** 白板元素 id（如 html-applet 的 shapeId） */
  elementId?: string;
  /** 课件 UUID（courseware.uuid） */
  coursewareUuid?: string;
  /** courseware_attempt.id（如有） */
  attemptId?: string;
  /** 学生 id */
  studentId?: string;
  /** 学生姓名（便于调试） */
  studentName?: string;
  /** 事件来源 */
  source: WhiteboardEventSource;
  /** 事件类型（命名空间:动作） */
  type: string;
  /** 标准化后的字段（score / total / completion / answer / ...） */
  payload: Record<string, unknown>;
  /** 原始数据（iframe 消息原文 / widget 回调参数） */
  raw?: unknown;
}

/** 完整事件（带 id + 时间戳） */
export interface WhiteboardEvent extends WhiteboardEventPayload {
  id: string;
  timestamp: number;
}

/** 事件过滤器（subscribe/query 时使用） */
export interface EventFilter {
  /** 限定事件类型列表（任一命中即可） */
  types?: string[];
  /** 限定事件来源 */
  sources?: WhiteboardEventSource[];
  /** 限定课程 */
  lessonId?: string;
  /** 限定元素 */
  elementId?: string;
  /** 限定课件 */
  coursewareUuid?: string;
  /** 限定学生 */
  studentId?: string;
  /** 自定义谓词 */
  predicate?: (e: WhiteboardEvent) => boolean;
}

/** Ring buffer 默认容量 */
export const DEFAULT_QUEUE_CAPACITY = 200;

/** 订阅配置 */
export interface SubscribeOptions {
  /** 是否在订阅时立即收到最近的匹配历史（最近 N 条） */
  replay?: number;
}

export type Subscription = () => void;
export type EventFilterMatch = EventFilter;
export type QueryOptions = EventFilter;

/** EventSlot 配置 */
export interface EventSlotOptions {
  /** Ring buffer 容量 */
  capacity?: number;
  /** 是否启用 IndexedDB 持久化（开发环境关闭以减少复杂度） */
  persist?: boolean;
}

/** 转换为 PlatformEvent 推送到全局 EventBus（兼容 socket 转发链） */
export function toPlatformEvent(event: WhiteboardEvent): PlatformEvent {
  return {
    id: event.id,
    type: event.type,
    source: `whiteboard.slot.${event.source}`,
    payload: {
      lessonId: event.lessonId,
      elementId: event.elementId,
      coursewareUuid: event.coursewareUuid,
      attemptId: event.attemptId,
      studentId: event.studentId,
      studentName: event.studentName,
      ...event.payload,
      __raw: event.raw,
    },
    timestamp: event.timestamp,
    correlationId: event.lessonId,
  };
}
