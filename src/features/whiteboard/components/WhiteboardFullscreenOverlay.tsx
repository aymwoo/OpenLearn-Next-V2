import React from 'react';
import { BrowserFullscreenHost, BROWSER_FULLSCREEN_PADDING } from '../widgets/BrowserFullscreenHost';
import { WidgetFullscreenStage } from '../widgets/WidgetFullscreenStage';
import { FullscreenOverlay } from '../fullscreen/FullscreenRendererRegistry';
import { parseElementData } from '../utils/element-cache';

export interface WhiteboardFullscreenOverlayProps {
  containerSize: { width: number; height: number };
  browserFullscreenElementId: string | null;
  isRemoteBrowserFullscreen: boolean;
  isBrowserFullscreenDismissible: boolean;
  browserFullscreen: { exit: () => void | Promise<void>; [key: string]: any };
  effectiveFullscreenElementId: string | null;
  isRemoteFullscreen: boolean;
  isFullscreenDismissible: boolean;
  applyFullscreen: (id: string | null) => void;
  safeElements: Array<{ id: string; type: string; data: string; [key: string]: any }>;
  lessonId: string;
  readOnly: boolean;
  renderElement: (el: any, opts?: any) => React.ReactNode;
  children: React.ReactNode;
}

const TYPE_LABEL: Record<string, string> = {
  quiz: '📝 随堂测验',
  timer: '⏱ 计时器',
  assignment: '📋 作业',
  'code-sandbox': '💻 代码沙箱',
  'html-applet': '🌐 交互课件',
  rollcall: '🎲 随机点名',
  presentation: '📽 演示文稿',
  'math-graph': '📐 数学图形',
  text: '📝 文本',
};

export const WhiteboardFullscreenOverlay: React.FC<WhiteboardFullscreenOverlayProps> = ({
  containerSize,
  browserFullscreenElementId,
  isRemoteBrowserFullscreen,
  isBrowserFullscreenDismissible,
  browserFullscreen,
  effectiveFullscreenElementId,
  isRemoteFullscreen,
  isFullscreenDismissible,
  applyFullscreen,
  safeElements,
  lessonId,
  readOnly,
  renderElement,
  children,
}) => {
  if (containerSize.width <= 0 || containerSize.height <= 0) {
    return null;
  }

  // 1. 浏览器全屏优先于白板全屏：脱离白板、占满视口
  if (browserFullscreenElementId) {
    const bfsEl = safeElements.find((e) => e.id === browserFullscreenElementId);
    if (!bfsEl) {
      if (isRemoteBrowserFullscreen) {
        return (
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-xs text-white">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mb-3" />
            <p className="text-xs font-medium text-slate-200">正在同步教师端的浏览器全屏组件...</p>
          </div>
        );
      }
      return null;
    }
    const bfsData = parseElementData(bfsEl);
    return (
      <BrowserFullscreenHost
        elementId={browserFullscreenElementId}
        type={bfsEl.type}
        data={bfsData}
        lessonId={lessonId}
        readOnly={readOnly}
        dismissible={isBrowserFullscreenDismissible}
        onExit={() => void browserFullscreen.exit()}
        renderContent={(viewport) => (
          <WidgetFullscreenStage width={viewport.width} height={viewport.height}>
            {renderElement(bfsEl, {
              fullscreen: {
                width: viewport.width,
                height: viewport.height,
                padding: BROWSER_FULLSCREEN_PADDING,
              },
            })}
          </WidgetFullscreenStage>
        )}
      />
    );
  }

  // 2. 白板全屏覆盖
  if (effectiveFullscreenElementId) {
    const fsEl = safeElements.find((e) => e.id === effectiveFullscreenElementId);
    if (!fsEl) {
      if (isRemoteFullscreen) {
        return (
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-xs text-white">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mb-3" />
            <p className="text-xs font-medium text-slate-200">正在同步教师端全屏组件...</p>
          </div>
        );
      }
      return null;
    }
    const fsData = parseElementData(fsEl);
    return (
      <FullscreenOverlay
        type={fsEl.type}
        title={TYPE_LABEL[fsEl.type] || fsEl.type}
        data={fsData}
        containerSize={containerSize}
        dismissible={isFullscreenDismissible}
        onClose={() => applyFullscreen(null)}
        lessonId={lessonId}
        elementId={fsEl.id}
        readOnly={readOnly}
        renderContent={(size) => (
          <WidgetFullscreenStage width={size.width} height={size.height}>
            {renderElement(fsEl, {
              fullscreen: { width: size.width, height: size.height, padding: 0 },
            })}
          </WidgetFullscreenStage>
        )}
      />
    );
  }

  // 3. 常规 Stage 渲染
  return <>{children}</>;
};
