/**
 * Unified Event Hooks for React Components
 *
 * Provides lifecycle-safe, declarative hooks for Layer 1 (In-Process FrontendEventBus)
 * and Layer 3 (DOM CustomEvents), preventing listener leaks and stale closures.
 */

import { useEffect, useRef, useCallback } from 'react';
import { frontendEventBus } from '../services/event-bus';
import type { PlatformEvent } from '../../packages/core/event-bus';
import type { FrontendEventMap, FrontendEventType } from '../types/events';

/**
 * 声明式监听前端进程内总线事件 (Layer 1)。
 *
 * 特性：
 * - 自动在组件挂载时订阅，卸载时注销，杜绝内存泄漏；
 * - 内部采用 useRef 保证 handler 始终为最新闭包，即使 handler 内部依赖改变也不会触发无谓的重新订阅。
 *
 * @param eventType 目标事件类型
 * @param handler 回调函数，接收类型化载荷 (payload) 与完整事件对象 (event)
 */
export function useEventBus<K extends FrontendEventType>(
  eventType: K,
  handler: (payload: FrontendEventMap[K], event: PlatformEvent<FrontendEventMap[K]>) => void,
): void;
export function useEventBus<T = any>(
  eventType: string,
  handler: (payload: T, event: PlatformEvent<T>) => void,
): void;
export function useEventBus(
  eventType: string,
  handler: (payload: any, event: PlatformEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = frontendEventBus.subscribePayload(eventType, (payload, event) => {
      handlerRef.current?.(payload, event);
    });

    return unsub;
  }, [eventType]);
}

/**
 * 声明式监听 DOM 原生或自定义事件 (Layer 3: DOM CustomEvent)。
 *
 * 特性：
 * - 自动在组件挂载时注册 window / target 监听，卸载时精准注销；
 * - 自动解析 CustomEvent 的 detail 并注入强类型推导；
 * - 内部采用 useRef 包装，防范 stale closure 与重复监听。
 *
 * @param eventName 自定义事件名称
 * @param handler 回调函数，接收 detail 与原始 DOM Event
 * @param target 监听目标，默认为 window
 */
export function useCustomEvent<K extends FrontendEventType>(
  eventName: K,
  handler: (detail: FrontendEventMap[K], event: CustomEvent<FrontendEventMap[K]>) => void,
  target?: EventTarget | null,
): void;
export function useCustomEvent<T = any>(
  eventName: string,
  handler: (detail: T, event: CustomEvent<T>) => void,
  target?: EventTarget | null,
): void;
export function useCustomEvent(
  eventName: string,
  handler: (detail: any, event: CustomEvent) => void,
  target: EventTarget | null = typeof window !== 'undefined' ? window : null,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!target) return;

    const listener = (event: Event) => {
      const customEvent = event as CustomEvent;
      handlerRef.current?.(customEvent.detail, customEvent);
    };

    target.addEventListener(eventName, listener);

    return () => {
      target.removeEventListener(eventName, listener);
    };
  }, [eventName, target]);
}

/**
 * 获取稳定引用的事件发射器 (Layer 1 与 Layer 3 通用能力)。
 */
export function useEventPublish() {
  const emit = useCallback(
    <K extends FrontendEventType>(type: K, payload: FrontendEventMap[K], source = 'react-component') => {
      return frontendEventBus.emit(type, payload, source);
    },
    [],
  );

  const publish = useCallback((event: PlatformEvent) => {
    return frontendEventBus.publish(event);
  }, []);

  const dispatchCustomEvent = useCallback(
    <K extends FrontendEventType>(
      eventName: K,
      detail: FrontendEventMap[K],
      target: EventTarget = typeof window !== 'undefined' ? window : (null as any),
    ) => {
      if (!target || typeof window === 'undefined') return;
      try {
        target.dispatchEvent(
          new CustomEvent(eventName, {
            detail,
            bubbles: true,
            cancelable: true,
          }),
        );
      } catch (err) {
        console.warn(`[useEventPublish] dispatchCustomEvent failed for '${eventName}':`, err);
      }
    },
    [],
  );

  return { emit, publish, dispatchCustomEvent };
}
