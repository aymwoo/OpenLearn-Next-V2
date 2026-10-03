/**
 * 前端轻量级 EventBus (Layer 1: In-Process EventBus)
 *
 * **本总线仅限当前浏览器进程内**，不与任何其他端通信。
 *
 * 特性：
 * 1. 强类型支持：结合 FrontendEventMap 提供完备的编译期类型校验与提示；
 * 2. 100% 向后兼容：保留对原有 PlatformEvent 调用的直接支持；
 * 3. 错误隔离：个别监听器异常不会影响其余监听器执行；
 * 4. 丰富能力：提供 once 单次监听、emit 便捷发射、listenerCount 调试自省与生命周期清理。
 */
import type { PlatformEvent } from '../../packages/core/event-bus';
import type { FrontendEventMap, FrontendEventType } from '../types/events';

export type EventHandler<T = any> = (event: PlatformEvent<T>) => void | Promise<void>;
export type PayloadHandler<T = any> = (payload: T, event: PlatformEvent<T>) => void | Promise<void>;

export class FrontendEventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * 订阅指定事件。支持强类型事件键推断，亦兼容任意字符串。
   *
   * @param eventType 事件类型
   * @param handler 事件处理回调 (接收完整 PlatformEvent，其 payload 具备类型提示)
   * @returns 取消订阅函数
   */
  subscribe<K extends FrontendEventType>(
    eventType: K,
    handler: (event: PlatformEvent<FrontendEventMap[K]>) => void | Promise<void>,
  ): () => void;
  subscribe<T = any>(eventType: string, handler: EventHandler<T>): () => void;
  subscribe(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * 仅针对 payload 的轻量订阅方式。
   *
   * @param eventType 事件类型
   * @param handler 回调接收解构后的 payload 与原始 event
   * @returns 取消订阅函数
   */
  subscribePayload<K extends FrontendEventType>(
    eventType: K,
    handler: (payload: FrontendEventMap[K], event: PlatformEvent<FrontendEventMap[K]>) => void | Promise<void>,
  ): () => void;
  subscribePayload<T = any>(
    eventType: string,
    handler: (payload: T, event: PlatformEvent<T>) => void | Promise<void>,
  ): () => void;
  subscribePayload(eventType: string, handler: PayloadHandler): () => void {
    const wrapped: EventHandler = (event) => handler(event.payload, event);
    return this.subscribe(eventType, wrapped);
  }

  /**
   * 单次订阅指定事件，触发一次后自动注销。
   *
   * @param eventType 事件类型
   * @param handler 回调函数
   * @returns 取消订阅函数
   */
  once<K extends FrontendEventType>(
    eventType: K,
    handler: (event: PlatformEvent<FrontendEventMap[K]>) => void | Promise<void>,
  ): () => void;
  once<T = any>(eventType: string, handler: EventHandler<T>): () => void;
  once(eventType: string, handler: EventHandler): () => void {
    const unsub = this.subscribe(eventType, (event) => {
      unsub();
      handler(event);
    });
    return unsub;
  }

  /**
   * 发布已封装好的完整 PlatformEvent 实例。
   */
  async publish(event: PlatformEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;

    // 浅拷贝当前 handlers，防止遍历期间订阅发生变更导致迭代异常
    const snapshot = Array.from(handlers);
    for (const handler of snapshot) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((e) => {
            console.error(`[FrontendEventBus] Async handler error on '${event.type}':`, e);
          });
        }
      } catch (e) {
        console.error(`[FrontendEventBus] Handler error on '${event.type}':`, e);
      }
    }
  }

  /**
   * 强类型发射事件，自动填充通用元数据 (id, timestamp, source)。
   *
   * @param type 事件类型
   * @param payload 事件载荷
   * @param source 触发源 (默认为 'frontend')
   */
  async emit<K extends FrontendEventType>(
    type: K,
    payload: FrontendEventMap[K],
    source?: string,
  ): Promise<void>;
  async emit<T = any>(type: string, payload: T, source?: string): Promise<void>;
  async emit(type: string, payload: any, source = 'frontend'): Promise<void> {
    const event: PlatformEvent = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      source,
      payload,
      timestamp: Date.now(),
    };
    return this.publish(event);
  }

  /**
   * 获取某类型事件当前的订阅者数量；若不传参则返回全部事件监听总数。
   */
  listenerCount(eventType?: string): number {
    if (eventType) {
      return this.handlers.get(eventType)?.size || 0;
    }
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * 清除指定事件或全部事件的订阅者（主要用于测试复位或重载）。
   */
  clear(eventType?: string): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }
}

export const frontendEventBus = new FrontendEventBus();
