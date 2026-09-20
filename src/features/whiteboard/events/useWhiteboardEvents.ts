/**
 * useWhiteboardEvents - React Hook 订阅白板事件槽
 *
 * 用法：
 *   const events = useWhiteboardEvents({ types: ['courseware.submitted'] }, { replay: 10 });
 *   // events 数组会自动随新事件追加（最新在前）
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { whiteboardEventSlot } from './WhiteboardEventSlot';
import type { EventFilter, SubscribeOptions, WhiteboardEvent } from './types';

export interface UseWhiteboardEventsOptions extends SubscribeOptions {
  /** 列表最大长度（环形截断） */
  maxItems?: number;
}

export function useWhiteboardEvents(
  filter: EventFilter = {},
  options: UseWhiteboardEventsOptions = {},
): WhiteboardEvent[] {
  const { replay = 0, maxItems = 50 } = options;
  const [events, setEvents] = useState<WhiteboardEvent[]>(() => {
    if (replay > 0) return whiteboardEventSlot.query(filter, { limit: replay });
    return [];
  });

  // 使用 ref 跟踪最新 filter（避免闭包陈旧）
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const handle = useCallback((e: WhiteboardEvent) => {
    setEvents((prev) => {
      const next = [e, ...prev];
      if (next.length > maxItems) next.length = maxItems;
      return next;
    });
  }, [maxItems]);

  useEffect(() => {
    // 重新拉取历史（filter 变了）
    if (replay > 0) {
      setEvents(whiteboardEventSlot.query(filter, { limit: replay }));
    } else {
      setEvents([]);
    }
    const unsubscribe = whiteboardEventSlot.subscribe(filterRef.current, handle);
    return unsubscribe;
  }, [
    // 序列化 filter 作为依赖（简单做法，足以应对大部分场景）
    JSON.stringify(filter),
    replay,
    handle,
  ]);

  return events;
}

/**
 * useWhiteboardEventListener - 只监听（不维护状态），适用于需要副作用但不需要 React state 的场景
 */
export function useWhiteboardEventListener(
  filter: EventFilter,
  handler: (e: WhiteboardEvent) => void,
  options: SubscribeOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    const unsubscribe = whiteboardEventSlot.subscribe(
      filterRef.current,
      (e) => handlerRef.current(e),
      options,
    );
    return unsubscribe;
  }, [JSON.stringify(filter), options.replay]);
}

/**
 * useEmitWhiteboardEvent - 获取 emit 函数（白板组件主动发送事件时使用）
 */
export function useEmitWhiteboardEvent() {
  return useCallback(
    (
      type: string,
      payload: Record<string, unknown>,
      meta?: Partial<Omit<WhiteboardEvent, 'id' | 'timestamp' | 'type' | 'payload'>>,
    ) => {
      return whiteboardEventSlot.ingest({
        type,
        payload,
        source: meta?.source ?? 'manual',
        ...meta,
      });
    },
    [],
  );
}
