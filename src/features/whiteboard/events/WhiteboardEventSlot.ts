/**
 * WhiteboardEventSlot - 白板事件采集 + 队列 + 分发核心
 *
 * 设计为单例，所有白板组件、widget、iframe 桥接共享一个队列。
 * - ingest(): 采集层调用
 * - emit(): 主动发布
 * - subscribe(): 订阅（带类型/来源/上下文过滤）
 * - query(): 读取历史
 * - clear(): 清空队列（调试用）
 */

import {
  DEFAULT_QUEUE_CAPACITY,
  type EventFilter,
  type EventSlotOptions,
  type SubscribeOptions,
  type WhiteboardEvent,
  type WhiteboardEventPayload,
  type WhiteboardEventSource,
  toPlatformEvent,
} from './types';
import { frontendEventBus } from '../../../services/event-bus';
import { v7 as uuidv7 } from 'uuid';

type Handler = (event: WhiteboardEvent) => void;

interface Subscription {
  filter: EventFilter;
  handler: Handler;
}

export class WhiteboardEventSlot {
  private buffer: WhiteboardEvent[] = [];
  private capacity: number;
  private persist: boolean;
  private subscriptions: Subscription[] = [];
  /** 按类型索引（加速匹配） */
  private byType = new Map<string, Set<Subscription>>();

  constructor(options: EventSlotOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_QUEUE_CAPACITY;
    this.persist = options.persist ?? false;
  }

  /** 入队一个事件（采集层或主动 emit） */
  ingest(payload: WhiteboardEventPayload): WhiteboardEvent {
    const event: WhiteboardEvent = {
      id: uuidv7(),
      timestamp: Date.now(),
      ...payload,
    };

    // Ring buffer：超过容量从头部弹出
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }

    // 分发到本地订阅者
    this.dispatch(event);

    // 同步推送到全局 frontendEventBus（兼容 socket 转发链）
    try {
      const platformEvent = toPlatformEvent(event);
      // 不 await：publish 是 fire-and-forget
      void frontendEventBus.publish(platformEvent);
    } catch (e) {
      // frontendEventBus 故障不能影响 ingest 主流程
      if (typeof console !== 'undefined') {
        console.warn('[WhiteboardEventSlot] frontendEventBus publish failed:', e);
      }
    }

    // 可选持久化（开发期默认关闭）
    if (this.persist && typeof indexedDB !== 'undefined') {
      void this.persistEvent(event);
    }

    return event;
  }

  /** 便捷 emit */
  emit(
    type: string,
    payload: Record<string, unknown>,
    meta: Partial<WhiteboardEventPayload> = {},
  ): WhiteboardEvent {
    return this.ingest({
      ...meta,
      type,
      source: meta.source ?? 'manual',
      payload,
    });
  }

  /** 订阅（返回取消订阅函数） */
  subscribe(
    filter: EventFilter,
    handler: Handler,
    options: SubscribeOptions = {},
  ): () => void {
    const sub: Subscription = { filter, handler };
    this.subscriptions.push(sub);

    // 类型索引
    if (filter.types) {
      for (const t of filter.types) {
        if (!this.byType.has(t)) this.byType.set(t, new Set());
        this.byType.get(t)!.add(sub);
      }
    }

    // 立即回放最近 N 条
    if (options.replay && options.replay > 0) {
      const recent = this.query(filter, { limit: options.replay });
      // 异步回放，避免与 subscribe 同步执行产生竞态
      queueMicrotask(() => {
        for (const e of recent) {
          try {
            handler(e);
          } catch (err) {
            console.error('[WhiteboardEventSlot] replay handler error:', err);
          }
        }
      });
    }

    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
      if (filter.types) {
        for (const t of filter.types) {
          this.byType.get(t)?.delete(sub);
        }
      }
    };
  }

  /** 查询历史 */
  query(filter: EventFilter = {}, options: { limit?: number; since?: number } = {}): WhiteboardEvent[] {
    const limit = options.limit ?? this.capacity;
    const since = options.since ?? 0;
    const matched: WhiteboardEvent[] = [];

    // 从最新往前扫，push 保证返回顺序也是 最新 → 最旧
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const e = this.buffer[i];
      if (e.timestamp < since) break;
      if (matchesFilter(e, filter)) {
        matched.push(e);
        if (matched.length >= limit) break;
      }
    }

    return matched;
  }

  /** 统计 */
  stats(): {
    total: number;
    byType: Record<string, number>;
    bySource: Record<WhiteboardEventSource, number>;
  } {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const e of this.buffer) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    return { total: this.buffer.length, byType, bySource: bySource as Record<WhiteboardEventSource, number> };
  }

  /** 清空队列（调试用） */
  clear(): void {
    this.buffer = [];
  }

  /** 队列大小 */
  size(): number {
    return this.buffer.length;
  }

  // --- 私有 ---

  private dispatch(event: WhiteboardEvent): void {
    // 优先用类型索引筛掉明显不匹配的订阅者
    const candidateSet = event.type ? this.byType.get(event.type) : undefined;
    const candidates: Subscription[] = candidateSet
      ? Array.from(candidateSet)
      : this.subscriptions;

    for (const sub of candidates) {
      if (!matchesFilter(event, sub.filter)) continue;
      try {
        sub.handler(event);
      } catch (err) {
        console.error('[WhiteboardEventSlot] handler error:', err);
      }
    }
  }

  private async persistEvent(event: WhiteboardEvent): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await openPersistDB();
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      store.put(event);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {
      // 持久化失败不影响主流程
    }
  }
}

/** 过滤器匹配 */
function matchesFilter(event: WhiteboardEvent, filter: EventFilter): boolean {
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false;
  if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(event.source)) return false;
  if (filter.lessonId && event.lessonId !== filter.lessonId) return false;
  if (filter.elementId && event.elementId !== filter.elementId) return false;
  if (filter.coursewareUuid && event.coursewareUuid !== filter.coursewareUuid) return false;
  if (filter.studentId && event.studentId !== filter.studentId) return false;
  if (filter.predicate && !filter.predicate(event)) return false;
  return true;
}

let persistDbPromise: Promise<IDBDatabase> | null = null;
function openPersistDB(): Promise<IDBDatabase> {
  if (persistDbPromise) return persistDbPromise;
  persistDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('whiteboard-event-slot', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return persistDbPromise;
}

/** 全局单例 */
export const whiteboardEventSlot = new WhiteboardEventSlot({
  capacity: DEFAULT_QUEUE_CAPACITY,
  persist: false,
});
