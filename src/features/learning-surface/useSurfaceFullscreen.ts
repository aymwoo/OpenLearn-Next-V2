/**
 * Surface 宿主级全屏控制器（阶段 10.2）。
 *
 * 与白板「浏览器全屏」（`useBrowserFullscreen`）的区别：
 * - 这里作用对象是 LearningSurface 容器，不参与白板元素广播；
 * - 原生 `requestFullscreen()` 被权限策略拒绝时，仍进入「占满视口」降级态，
 *   `Esc` 必须能退出；
 * - 退出后焦点回到触发按钮，避免键盘用户丢失位置。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SurfaceFullscreenTarget {
  current: HTMLElement | null;
}

export interface UseSurfaceFullscreenResult {
  /** 是否处于全屏（含原生被拒后的降级占满视口） */
  isFullscreen: boolean;
  /** 原生全屏是否真的生效 */
  nativeActive: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => void;
}

function activeFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    null
  );
}

export function useSurfaceFullscreen(ref: SurfaceFullscreenTarget): UseSurfaceFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nativeActive, setNativeActive] = useState(false);
  // 原生被拒时没有 fullscreenchange，Esc 只能靠这个标记识别
  const degradedRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 反向同步：用户用浏览器 UI / 系统 Esc 退出原生全屏
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const target = ref.current;
      const active = Boolean(target) && activeFullscreenElement() === target;
      setNativeActive(active);
      if (!active && !degradedRef.current) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange as EventListener);
    };
  }, [ref]);

  // 组件卸载时兜底退出，避免把用户困在全屏里
  useEffect(() => {
    return () => {
      const target = ref.current;
      if (target && activeFullscreenElement() === target) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [ref]);

  const enter = useCallback(async () => {
    const target = ref.current;
    if (!target) return;
    previousFocusRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    setIsFullscreen(true);

    const request =
      target.requestFullscreen?.bind(target) ??
      (target as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(target);
    if (!request) {
      degradedRef.current = true;
      return;
    }
    try {
      await request();
      degradedRef.current = false;
      setNativeActive(true);
    } catch (e) {
      // 权限策略 / 缺少用户手势：保留占满视口体验，Esc 仍需可用
      degradedRef.current = true;
      console.warn('[SurfaceFullscreen] native fullscreen rejected, falling back to viewport fill:', e);
    }
  }, [ref]);

  const exit = useCallback(async () => {
    degradedRef.current = false;
    setIsFullscreen(false);
    const target = ref.current;
    if (target && activeFullscreenElement() === target) {
      try {
        await document.exitFullscreen?.();
      } catch (e) {
        console.warn('[SurfaceFullscreen] exit failed:', e);
      }
    }
    setNativeActive(false);
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    previous?.focus?.();
  }, [ref]);

  // 降级态 Esc 退出：原生全屏下交给浏览器
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeFullscreenElement()) return;
      if (!degradedRef.current) return;
      void exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  const toggle = useCallback(() => {
    if (isFullscreen) void exit();
    else void enter();
  }, [isFullscreen, enter, exit]);

  return { isFullscreen, nativeActive, enter, exit, toggle };
}
