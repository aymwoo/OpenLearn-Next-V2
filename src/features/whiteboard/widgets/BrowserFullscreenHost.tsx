/**
 * 浏览器全屏宿主
 *
 * 承接「整个浏览器全屏」的内容渲染：脱离白板、占满视口，标题栏隐藏，
 * 仅保留悬浮退出按钮（Esc 亦可退出）。
 *
 * 之所以把内容渲染交给调用方（`renderContent`）而不是在这里按 type 分发：
 * 组件渲染逻辑已经在 `InteractiveWhiteboard` 内按元素类型分支好了，
 * 复制一份必然漂移。这里只负责「外层容器 + 退出出口」。
 */
import React, { useEffect, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { BROWSER_FULLSCREEN_Z } from './WidgetFrame';

/** 元素与视口边缘的留白 */
export const BROWSER_FULLSCREEN_PADDING = 24;

export interface BrowserFullscreenHostProps {
  elementId: string;
  type: string;
  data: Record<string, any>;
  lessonId: string;
  readOnly?: boolean;
  /**
   * 是否允许本地退出。
   * 学生端跟随教师同步时为 false —— 保持与「白板全屏」的 dismissible 口径一致，
   * 避免学生按 ESC 脱离教师正在展示的内容。
   */
  dismissible?: boolean;
  onExit: () => void;
  /**
   * 由调用方渲染组件内容（复用白板内已有的元素渲染逻辑）。
   * 传入当前视口尺寸 —— 元素需据此铺满全屏，而非保持画布内的原始尺寸。
   */
  renderContent: (viewport: { width: number; height: number }) => React.ReactNode;
}

export function BrowserFullscreenHost({
  elementId,
  type,
  lessonId,
  readOnly = false,
  dismissible = true,
  onExit,
  renderContent,
}: BrowserFullscreenHostProps) {
  // Esc 退出（与 FullscreenOverlay 同一口径；不可退出时 ESC 也不生效）
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, dismissible]);

  // 视口尺寸：元素要在全屏下铺满，必须跟随窗口变化（含原生全屏切换时的尺寸变化）
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      data-testid="browser-fullscreen-host"
      data-element-id={elementId}
      data-element-type={type}
      data-dismissible={dismissible ? 'true' : 'false'}
      style={{ pointerEvents: 'auto', zIndex: BROWSER_FULLSCREEN_Z }}
      className="fixed inset-0 bg-white dark:bg-slate-950 flex flex-col"
    >
      {dismissible ? (
        <button
          type="button"
          data-testid="browser-fullscreen-exit"
          onClick={onExit}
          className="fixed top-4 right-4 z-[100001] px-3 py-2 rounded-xl bg-slate-900/85 hover:bg-slate-900 text-slate-100 text-xs font-bold flex items-center gap-1.5 shadow-2xl backdrop-blur-md border border-white/15 transition-colors cursor-pointer"
          title="退出全屏（Esc）"
        >
          <Minimize2 size={14} />
          退出全屏
        </button>
      ) : (
        <span
          className="fixed top-4 right-4 z-[100001] px-3 py-2 rounded-xl bg-slate-900/85 text-slate-200 text-xs font-bold flex items-center gap-1.5 shadow-2xl border border-white/10 select-none"
          title={readOnly ? '教师已开启全班专注锁定' : '由教师端控制，无法在本地退出'}
        >
          {readOnly ? '🔒 教师同步视图' : '教师同步视图'}
        </span>
      )}

      <div
        data-testid="browser-fullscreen-content"
        className="flex-1 min-h-0 overflow-auto"
        style={{ width: viewport.width, height: viewport.height }}
      >
        {renderContent(viewport)}
      </div>

      {/* 供自动化测试/调试确认上下文，不影响视觉 */}
      <span hidden data-lesson-id={lessonId} />
    </div>
  );
}

export default BrowserFullscreenHost;
