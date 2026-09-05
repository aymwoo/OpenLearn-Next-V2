import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * 课件 iframe 挂载调度器：
 * - 懒挂载：元素进入可视区（含 200px 预加载边距）才真正创建 iframe；
 * - 并发上限：同时挂载的 iframe 数不超过 MAX_CONCURRENT_FRAMES，超限时等待
 *   其他 iframe 释放后再挂载（降低同屏大量互动课件时的内存/CPU 开销）。
 */

export const MAX_CONCURRENT_FRAMES = 4;

let activeFrames = 0;
const slotSubscribers = new Set<() => void>();

/** 尝试占用一个 iframe 挂载槽位；成功返回释放函数，满则返回 null */
export function tryAcquireFrameSlot(): (() => void) | null {
  if (activeFrames >= MAX_CONCURRENT_FRAMES) return null;
  activeFrames += 1;
  return () => {
    activeFrames = Math.max(0, activeFrames - 1);
    for (const cb of slotSubscribers) cb();
  };
}

function subscribeFrameSlots(cb: () => void): () => void {
  slotSubscribers.add(cb);
  return () => {
    slotSubscribers.delete(cb);
  };
}

/**
 * 课件 iframe 挂载 hook：结合可视区检测与并发槽位，返回是否应挂载 iframe。
 */
export function useCoursewareFrameMount(
  lazy: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
): boolean {
  const [visible, setVisible] = useState(!lazy);
  const [mounted, setMounted] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);

  // 1. 可视区检测（懒挂载）
  useEffect(() => {
    if (!lazy || visible) return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazy, visible, containerRef]);

  // 2. 并发槽位申请 / 释放
  useEffect(() => {
    if (!visible) {
      releaseRef.current?.();
      releaseRef.current = null;
      setMounted(false);
      return;
    }
    const release = tryAcquireFrameSlot();
    if (release) {
      releaseRef.current = release;
      setMounted(true);
    } else {
      // 满额：订阅释放通知，重试
      const unsub = subscribeFrameSlots(() => {
        const r = tryAcquireFrameSlot();
        if (r) {
          unsub();
          releaseRef.current = r;
          setMounted(true);
        }
      });
      return () => unsub();
    }
  }, [visible]);

  // 3. 组件卸载兜底释放
  useEffect(
    () => () => {
      releaseRef.current?.();
    },
    [],
  );

  return mounted;
}
