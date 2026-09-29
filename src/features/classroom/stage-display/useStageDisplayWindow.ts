/**
 * 大屏展台独立窗口管理
 *
 * 为什么必须新开窗口：展台是投到副屏/投影上的。如果做成同页模态框，
 * 教师本人的屏幕就被展台盖住了 —— 讲台上没法同时看课件和学生。
 *
 * 三个必须处理的现实问题：
 *  1. **弹窗被拦截**：浏览器默认会拦 `window.open`。必须降级为同页模态框，
 *     否则教师点了毫无反应（历史上学生视窗就有这个坑，见 LiveClassroomView）。
 *  2. **重复点击**：教师连点两次会开两个展台互相抢屏幕。已开的窗口要复用/聚焦。
 *  3. **窗口被教师手动关掉后**：引用还在，下次点击会聚焦一个已死的窗口（无反应）。
 *     打开前必须探活。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type StageWindowState = 'idle' | 'open' | 'blocked';

export interface OpenStageWindowOptions {
  lessonId: string;
  lessonTitle?: string;
  lang?: string;
}

export interface UseStageDisplayWindowResult {
  /** 当前是否以「同页模态框」方式展示（弹窗被拦截时的降级态） */
  fallbackOpen: boolean;
  /** 上次是否被浏览器拦截（用于提示教师去地址栏放行） */
  blocked: boolean;
  openStageWindow: (options: OpenStageWindowOptions) => void;
  closeFallback: () => void;
  clearBlockedHint: () => void;
}

function buildStageUrl({ lessonId, lessonTitle, lang }: OpenStageWindowOptions): string {
  const params = new URLSearchParams({ mode: 'stage_display', lessonId });
  if (lessonTitle) params.set('title', lessonTitle);
  if (lang) params.set('lang', lang);
  const { pathname, origin } = window.location;
  return `${origin}${pathname}?${params.toString()}#/stage_display`;
}

export function useStageDisplayWindow(): UseStageDisplayWindowResult {
  const windowRef = useRef<Window | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // 组件卸载时不主动关窗口 —— 展台是常驻副屏的，
  // 教师切到别的标签页（组件卸载）不该把投屏一起带走。
  useEffect(() => {
    // 仅在卸载时丢弃引用，避免 stale
    return () => {
      windowRef.current = null;
    };
  }, []);

  // 定期探活：教师可能直接关掉标签页，此时要清掉失效引用
  useEffect(() => {
    const timer = setInterval(() => {
      const w = windowRef.current;
      if (w && w.closed) windowRef.current = null;
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const openStageWindow = useCallback((options: OpenStageWindowOptions) => {
    const existing = windowRef.current;
    if (existing && !existing.closed) {
      // 已开着：聚焦而不是再开一个
      existing.focus();
      return;
    }

    let win: Window | null;
    try {
      win = window.open(
        buildStageUrl(options),
        'openlearn-stage-display',
        'width=1280,height=720,menubar=no,toolbar=no,location=no',
      );
    } catch (e) {
      console.warn('[StageDisplay] window.open threw:', e);
      win = null;
    }

    if (!win) {
      // 被拦截：降级到同页模态框，并明确告诉教师为什么
      setBlocked(true);
      setFallbackOpen(true);
      return;
    }

    windowRef.current = win;
    setBlocked(false);
    setFallbackOpen(false);
    win.focus?.();
  }, []);

  const closeFallback = useCallback(() => setFallbackOpen(false), []);
  const clearBlockedHint = useCallback(() => setBlocked(false), []);

  return { fallbackOpen, blocked, openStageWindow, closeFallback, clearBlockedHint };
}
