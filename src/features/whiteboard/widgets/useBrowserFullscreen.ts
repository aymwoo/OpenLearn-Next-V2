/**
 * 浏览器全屏控制器
 *
 * 与既有「白板全屏」（组件在画布内最大化，z-index 遮罩）区分开的第二种全屏：
 *   - 组件脱离白板，占满整个浏览器视口；
 *   - 教师端额外调用 `document.documentElement.requestFullscreen()` 进入浏览器原生全屏；
 *   - ESC / 悬浮按钮均可退出。
 *
 * 两个关键边界（都来自真实踩过的坑）：
 *  1. **原生全屏只能本地发起**。学生端跟随教师展示时只占满视口，**不代学生调用
 *     requestFullscreen** —— 那是本机权限与体验选择，不该被课堂状态绑架。
 *  2. **用户按 ESC 退出原生全屏时不会通知我们**，必须监听 `fullscreenchange` 反向
 *     同步状态；否则界面会以为还在全屏，黑屏且退不出。
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

export interface UseBrowserFullscreenOptions {
  /** 目标元素 id；null 表示未处于浏览器全屏 */
  elementId: string | null;
  /** 是否由本机（教师）控制 —— 决定是否发起原生全屏 */
  enableNativeFullscreen?: boolean;
  /** 状态变化回调（用于广播给其他客户端） */
  onChange?: (elementId: string | null) => void;
}

export interface UseBrowserFullscreenResult {
  /** 原生全屏是否可用（不可用时静默降级为「仅占满视口」） */
  nativeSupported: boolean;
  /** 当前是否处于浏览器原生全屏 */
  nativeActive: boolean;
  /** 进入浏览器全屏（占满视口 + 原生全屏） */
  enter: (id: string) => Promise<void>;
  /** 退出浏览器全屏 */
  exit: () => Promise<void>;
}

export function useBrowserFullscreen({
  elementId,
  enableNativeFullscreen = true,
  onChange,
}: UseBrowserFullscreenOptions): UseBrowserFullscreenResult {
  const nativeSupported = isNativeFullscreenSupported();
  const [nativeActive, setNativeActive] = useState(false);
  const elementIdRef = useRef<string | null>(elementId);
  elementIdRef.current = elementId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 组件卸载 / 元素被删除 / 换课节时兜底退出，避免原生全屏把用户困在全屏黑屏里
  useEffect(() => {
    return () => {
      if (isNativeFullscreenActive()) {
        void (document.exitFullscreen?.() as unknown as Promise<void>)?.catch?.(() => {});
      }
    };
  }, []);

  /**
   * 反向同步：用户按 ESC 或用浏览器 UI 退出原生全屏时，`fullscreenchange` 会触发，
   * 此时必须把组件也从「占满视口」状态退回来，否则界面停留在一个不存在的全屏里。
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChangeFs = () => {
      const active = isNativeFullscreenActive();
      setNativeActive(active);
      if (!active && elementIdRef.current && onChangeRef.current) {
        onChangeRef.current(null);
      }
    };
    document.addEventListener('fullscreenchange', onChangeFs);
    document.addEventListener('webkitfullscreenchange', onChangeFs as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onChangeFs);
      document.removeEventListener('webkitfullscreenchange', onChangeFs as EventListener);
    };
  }, []);

  const enter = useCallback(
    async (id: string) => {
      onChangeRef.current?.(id);
      if (!enableNativeFullscreen) return; // 跟随端只占满视口
      if (!isNativeFullscreenSupported()) return; // 不支持则静默降级
      try {
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
        setNativeActive(true);
      } catch (e) {
        // 浏览器可能因未获用户手势 / 权限策略拒绝；此时保留「占满视口」体验即可
        console.warn('[BrowserFullscreen] native fullscreen rejected:', e);
      }
    },
    [enableNativeFullscreen],
  );

  const exit = useCallback(async () => {
    onChangeRef.current?.(null);
    if (isNativeFullscreenActive()) {
      try {
        await (document.exitFullscreen?.() as unknown as Promise<void>);
      } catch (e) {
        console.warn('[BrowserFullscreen] exit failed:', e);
      }
    }
    setNativeActive(false);
  }, []);

  return { nativeSupported, nativeActive, enter, exit };
}
