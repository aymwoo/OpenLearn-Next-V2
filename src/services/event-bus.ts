/**
 * 前端轻量级 EventBus (Layer 1: In-Process EventBus)
 *
 * **本总线仅限当前浏览器进程内**，不与任何其他端通信。
 *
 * 特性：
 * 1. 强类型支持：结合 FrontendEventMap 提供完备的编译期类型校验与提示；
 * 2. 100% 向后兼容：保留对原有 PlatformEvent 调用的直接支持；
 * 3. 错误隔离：个别监听器异常不会影响其余监听器执行；
 * 4. 丰富能力：提供 once 单次监听、emit 便捷发射、listenerCount 调试自省与生命周期清理；
 * 5. 通配符订阅：支持 `courseware.*`（前缀匹配）与 `*`（全量匹配），精确订阅仍是 O(1) 命中。
 */
import type { PlatformEvent } from '../../packages/core/event-bus';
import type { FrontendEventMap, FrontendEventType } from '../types/events';

export type EventHandler<T = any> = (event: PlatformEvent<T>) => void | Promise<void>;
export type PayloadHandler<T = any> = (payload: T, event: PlatformEvent<T>) => void | Promise<void>;

/** 订阅模式解析结果 */
type PatternKind = 'exact' | 'prefix' | 'global';
interface ParsedPattern {
  kind: PatternKind;
  /** exact: 原事件名；prefix: 事件名前缀（含尾部 '.'，如 'courseware.'）；global: '*' */
  key: string;
}

/**
 * 解析订阅模式：
 * - `'*'` → 全局通配符；
 * - `'ns.*'`（且前缀部分不含其他 `*`）→ 前缀通配符，`'courseware.*'` 匹配 `courseware.submitted` 等；
 * - 其余（含 `ns.mid*` 这类不完整通配）→ 按字面量精确订阅，100% 保持历史行为。
 */
function parsePattern(eventType: string): ParsedPattern {
  if (eventType === '*') return { kind: 'global', key: '*' };
  if (eventType.length > 2 && eventType.endsWith('.*') && !eventType.slice(0, -2).includes('*')) {
    return { kind: 'prefix', key: eventType.slice(0, -1) };
  }
  return { kind: 'exact', key: eventType };
}

export class FrontendEventBus {
  /** 精确订阅：Map<事件名, Set<handler>>，publish 时 O(1) 命中 */
  private handlers = new Map<string, Set<EventHandler>>();
  /** 前缀通配符订阅：Map<前缀, Set<handler>>，publish 时按已注册前缀数线性试探（通常为空） */
  private prefixHandlers = new Map<string, Set<EventHandler>>();
  /** 全局通配符 '*' 订阅 */
  private globalHandlers = new Set<EventHandler>();
  /** 通配符订阅总数（>0 时才付出前缀试探成本，保证纯精确订阅场景零退化） */
  private wildcardCount = 0;

  /**
   * 订阅指定事件。支持强类型事件键推断，亦兼容任意字符串与通配符（`ns.*` / `*`）。
   *
   * @param eventType 事件类型，或前缀通配符（`courseware.*`）、全量通配符（`*`）
   * @param handler 事件处理回调 (接收完整 PlatformEvent，其 payload 具备类型提示)
   * @returns 取消订阅函数
   */
  subscribe<K extends FrontendEventType>(
    eventType: K,
    handler: (event: PlatformEvent<FrontendEventMap[K]>) => void | Promise<void>,
  ): () => void;
  subscribe<T = any>(eventType: string, handler: EventHandler<T>): () => void;
  subscribe(eventType: string, handler: EventHandler): () => void {
    const { kind, key } = parsePattern(eventType);

    let bucket: Set<EventHandler>;
    if (kind === 'global') {
      bucket = this.globalHandlers;
      this.wildcardCount++;
    } else if (kind === 'prefix') {
      let existing = this.prefixHandlers.get(key);
      if (!existing) {
        existing = new Set();
        this.prefixHandlers.set(key, existing);
      }
      bucket = existing;
      this.wildcardCount++;
    } else {
      let existing = this.handlers.get(key);
      if (!existing) {
        existing = new Set();
        this.handlers.set(key, existing);
      }
      bucket = existing;
    }

    bucket.add(handler);

    // 取消订阅：命中集合变空时立即清理索引条目，避免长时间运行时泄漏
    let released = false;
    return () => {
      if (released) return;
      released = true;
      bucket.delete(handler);
      if (bucket.size > 0) return;
      if (kind === 'global') {
        this.wildcardCount--;
      } else if (kind === 'prefix') {
        this.wildcardCount--;
        this.prefixHandlers.delete(key);
      } else {
        this.handlers.delete(key);
      }
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
   * 收集某事件类型应触发的订阅者：精确集合（O(1) 命中）+ 前缀通配符 + 全量通配符。
   *
   * 性能结构：
   * 1. 无任何通配符订阅时走快速路径，与历史实现完全等价（单次 Map 查找 + 一次数组拷贝）；
   * 2. 有通配符时按「已注册前缀数」线性试探（通常 0–2 个），多数事件一次 startsWith 即可排除；
   * 3. 去重用的 Set 只在**首个通配符真正命中时**才分配 —— 非匹配事件（如 whiteboard.*）
   *    全程零额外分配，因此精确订阅方不承担通配符的成本。
   * 命中后以精确订阅者先入 Set，保证历史调用顺序不变。
   */
  private resolveHandlers(type: string): EventHandler[] {
    const exact = this.handlers.get(type);

    // 快速路径：不存在任何通配符订阅时，与历史实现完全等价
    if (this.wildcardCount === 0) {
      return exact && exact.size > 0 ? Array.from(exact) : [];
    }

    let merged: Set<EventHandler> | null = null;
    for (const [prefix, set] of this.prefixHandlers) {
      if (!type.startsWith(prefix)) continue;
      if (!merged) {
        // 以精确订阅者为先，保持历史调用顺序
        merged = new Set<EventHandler>();
        if (exact) {
          for (const handler of exact) merged.add(handler);
        }
      }
      for (const handler of set) merged.add(handler);
    }
    if (this.globalHandlers.size > 0) {
      if (!merged) {
        merged = new Set<EventHandler>();
        if (exact) {
          for (const handler of exact) merged.add(handler);
        }
      }
      for (const handler of this.globalHandlers) merged.add(handler);
    }

    if (merged) return Array.from(merged);
    return exact && exact.size > 0 ? Array.from(exact) : [];
  }

  /**
   * 发布已封装好的完整 PlatformEvent 实例。
   */
  async publish(event: PlatformEvent): Promise<void> {
    const handlers = this.resolveHandlers(event.type);
    if (handlers.length === 0) return;

    for (const handler of handlers) {
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
  async emit<K extends FrontendEventType>(type: K, payload: FrontendEventMap[K], source?: string): Promise<void>;
  async emit<T = any>(type: string, payload: T, source?: string): Promise<void>;
  async emit(type: string, payload: any, source = 'frontend'): Promise<void> {
    const event: PlatformEvent = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      source,
      payload,
      timestamp: Date.now(),
    };
    return this.publish(event);
  }

  /**
   * 获取某模式当前的订阅者数量；若不传参则返回全部事件监听总数（含通配符订阅）。
   * 传入通配符模式时返回该模式自身的订阅数，传入字面量事件名时返回其精确订阅数。
   */
  listenerCount(eventType?: string): number {
    if (eventType) {
      const { kind, key } = parsePattern(eventType);
      if (kind === 'global') return this.globalHandlers.size;
      if (kind === 'prefix') return this.prefixHandlers.get(key)?.size ?? 0;
      return this.handlers.get(key)?.size || 0;
    }
    let total = this.wildcardCount;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * 清除指定模式或全部模式的订阅者（主要用于测试复位或重载）。
   */
  clear(eventType?: string): void {
    if (eventType) {
      const { kind, key } = parsePattern(eventType);
      if (kind === 'global') {
        this.wildcardCount -= this.globalHandlers.size;
        this.globalHandlers.clear();
      } else if (kind === 'prefix') {
        const set = this.prefixHandlers.get(key);
        if (set) this.wildcardCount -= set.size;
        this.prefixHandlers.delete(key);
      } else {
        this.handlers.delete(key);
      }
    } else {
      this.handlers.clear();
      this.prefixHandlers.clear();
      this.globalHandlers.clear();
      this.wildcardCount = 0;
    }
  }
}

export const frontendEventBus = new FrontendEventBus();
