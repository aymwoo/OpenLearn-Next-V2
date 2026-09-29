/**
 * 视口级全屏控制器（整页全屏，非元素级）
 *
 * 与元素级的 `useBrowserFullscreen` 同一套语义，区别只在于作用对象：后者管「某个
 * 组件脱离白板占满视口」，这里管「整个页面占满视口」（大屏展台这类独立整页场景）。
 *
 * 存在的理由 —— 补上原生全屏**降级**路径的缺口：
 * `requestFullscreen()` 可能因权限策略 / 缺少用户手势被拒绝，此时浏览器不会进入
 * 原生全屏，**Esc 也就完全失效**（Esc 只在原生全屏态下由浏览器接管）。若只监听
 * `document.fullscreenElement`，界面会误判「没进全屏」而什么都不做，用户就被卡在
 * 一个看似全屏、实则退不出的状态。
 *
 * 所以这里把「是否全屏」独立成一个显式状态：
 *   - 进入时若原生调用被拒，仍然进入「占满视口」并置 fullscreen=true；
 *   - 无论原生全屏是否成功，Esc 一律能退出；
 *   - 反向监听 fullscreenchange：用户用浏览器 UI 或系统 Esc 退出原生全屏时，
 *     一并把状态退回来。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 浏览器是否支持原生全屏 */
export function isNativeFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** 当前是否处于浏览器原生全屏 */
export function isNativeFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
}

export interface UseViewportFullscreenResult {
  /** 是否处于全屏展示（含降级后的「仅占满视口」） */
  isFullscreen: boolean;
  /** 原生全屏是否真的生效（降级时为 false） */
  nativeActive: boolean;
  toggle: () => void;
  exit: () => void;
}

export function useViewportFullscreen(): UseViewportFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nativeActive, setNativeActive] = useState(false);
  // 降级进入时（原生被拒）没有 fullscreenchange 可依赖，Esc 只能靠这个标记识别
  const degradedRef = useRef(false);

  // 反向同步：用户经浏览器 UI / 系统 Esc 退出原生全屏时，把状态一并退回来
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = isNativeFullscreenActive();
      setNativeActive(active);
      if (!active) {
        degradedRef.current = false;
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange as EventListener);
    };
  }, []);

  // Esc 退出：原生全屏下由浏览器接管（我们监听 fullscreenchange 即可），
  // 降级态下浏览器不会管，必须自己处理，否则用户退不出
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isNativeFullscreenActive()) return; // 交给浏览器
      if (!degradedRef.current) return; // 本来就没在全屏
      degradedRef.current = false;
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enter = useCallback(async () => {
    setIsFullscreen(true);
    if (!isNativeFullscreenSupported()) {
      // 环境根本不支持：静默降级为占满视口，Esc 仍需可用
      degradedRef.current = true;
      return;
    }
    try {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      setNativeActive(true);
    } catch (e) {
      // 权限策略 / 缺少用户手势被拒：保留占满视口体验，并让 Esc 生效
      degradedRef.current = true;
      console.warn('[ViewportFullscreen] native fullscreen rejected, falling back to viewport fill:', e);
    }
  }, []);

  const exit = useCallback(async () => {
    degradedRef.current = false;
    setIsFullscreen(false);
    setNativeActive(false);
    if (isNativeFullscreenActive()) {
      try {
        await (document.exitFullscreen?.() as unknown as Promise<void>);
      } catch (e) {
        console.warn('[ViewportFullscreen] exit failed:', e);
      }
    }
  }, []);

  const toggle = useCallback(() => {
    if (isNativeFullscreenActive() || degradedRef.current) {
      void exit();
    } else {
      void enter();
    }
  }, [enter, exit]);

  return { isFullscreen, nativeActive, toggle, exit };
}
