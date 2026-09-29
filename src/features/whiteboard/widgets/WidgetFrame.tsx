/**
 * WidgetFrame — 画布组件的统一窗口框架
 *
 * 为什么需要它：此前每个组件分支各自调 `getWidgetTitleBarProps` 并手工渲染
 * `WidgetTitleBar`，新增一种组件类型时很容易漏掉 —— 于是该组件就没有标题栏、
 * 不能全屏、不能删除，行为与其他组件不一致。第三方 widget 更是完全由插件自己
 * 控制，宿主无法保证它有任何窗口能力。
 *
 * 统一后：宿主在渲染层强制包一层，**组件内容自己无需实现任何窗口逻辑**，
 * 新增类型与第三方组件自动获得完整窗口能力。
 *
 * 两种「全屏」语义必须分清（此前只有前者）：
 *   - 白板全屏（board）：组件在白板画布内最大化，位置随画布，仍能看到白板周边；
 *   - 浏览器全屏（browser）：组件脱离白板占满整个视口，并进入浏览器原生全屏，
 *     用于投屏演示。
 * 两者可叠加：先白板全屏再浏览器全屏，或反过来。
 */
import React from 'react';
import { Maximize, Minimize2, X } from 'lucide-react';
import { WidgetTitleBar, type WidgetTitleBarProps } from './WidgetTitleBar';

export interface WidgetFrameProps extends Omit<WidgetTitleBarProps, 'onMaximize'> {
  children: React.ReactNode;
  /** 白板全屏（画布内最大化）—— 保持原语义 */
  onMaximize?: () => void;
  /** 进入/退出「整个浏览器全屏」：脱离白板占满视口 + 原生全屏 */
  onBrowserFullscreen?: () => void;
  /** 当前是否处于浏览器全屏（决定隐藏标题栏 / 显示悬浮退出） */
  isBrowserFullscreen?: boolean;
  /**
   * 浏览器全屏时是否允许本地退出。
   * 学生端跟随教师同步时为 false —— 与白板全屏的 dismissible 口径一致，
   * 避免学生本地按 ESC 脱离教师正在展示的内容。
   */
  browserFullscreenDismissible?: boolean;
  /** 内容区是否填满（默认填满剩余空间） */
  contentClassName?: string;
}

/** 浏览器全屏层级：高于白板全屏（99999）与所有画布元素 */
export const BROWSER_FULLSCREEN_Z = 100000;

export function WidgetFrame({
  children,
  onMaximize,
  onBrowserFullscreen,
  isBrowserFullscreen = false,
  browserFullscreenDismissible = true,
  contentClassName = 'flex-1 min-h-0 overflow-auto',
  ...titleBarProps
}: WidgetFrameProps) {
  if (isBrowserFullscreen) {
    return (
      <div
        data-widget-frame="browser-fullscreen"
        style={{ pointerEvents: 'auto' }}
        className="fixed inset-0 bg-white dark:bg-slate-950 flex flex-col"
      >
        {/* 标题栏在浏览器全屏下隐藏（沉浸），仅保留悬浮退出，避免误触后无法退出 */}
        {browserFullscreenDismissible && onBrowserFullscreen && (
          <button
            type="button"
            data-testid="widget-frame-exit-browser-fullscreen"
            onClick={onBrowserFullscreen}
            className="fixed top-4 right-4 z-[100001] px-3 py-2 rounded-xl bg-slate-900/85 hover:bg-slate-900 text-slate-100 text-xs font-bold flex items-center gap-1.5 shadow-2xl backdrop-blur-md border border-white/15 transition-colors cursor-pointer"
            title="退出全屏（Esc）"
          >
            <Minimize2 size={14} />
            退出全屏
          </button>
        )}
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      </div>
    );
  }

  const { title, icon, readOnly, isMinimized, isMaximized, isPropertiesOpen, themeColor, extraActions, ...handlers } =
    titleBarProps;

  return (
    <div data-widget-frame="true" className="w-full h-full flex flex-col min-h-0">
      <WidgetTitleBar
        title={title}
        icon={icon}
        readOnly={readOnly}
        isMinimized={isMinimized}
        isMaximized={isMaximized}
        isPropertiesOpen={isPropertiesOpen}
        themeColor={themeColor}
        extraActions={extraActions}
        {...handlers}
        onMaximize={onMaximize}
        // 「整个浏览器全屏」独立于「白板全屏」，两个按钮同时提供
        onBrowserFullscreen={onBrowserFullscreen}
      />
      {!isMinimized && <div className={contentClassName}>{children}</div>}
    </div>
  );
}

export default WidgetFrame;
