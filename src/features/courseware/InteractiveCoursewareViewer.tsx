import React, { useState, useEffect, useRef } from 'react';
import { X, Globe, Maximize2, Minimize2 } from 'lucide-react';
import { useThemeStore, getThemeTokens } from '../../store/themeStore';
import { broadcastThemeToIframes } from '../../services/lms-bridge';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

interface InteractiveCoursewareViewerProps {
  coursewareId: string | null;
  onClose?: () => void;
}

export function InteractiveCoursewareViewer({ coursewareId, onClose }: InteractiveCoursewareViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useThemeStore();

  const handleIframeLoad = () => {
    broadcastThemeToIframes(theme, getThemeTokens(theme));
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // SEC-AUTH: 课件 HTML 路由要求短时访问 token（沙箱 iframe 不带会话 cookie，
  // 由持有会话的父页面先铸造，拼进 iframe src 的 ?ct= 参数）
  useEffect(() => {
    let cancelled = false;
    setAccessToken(null);
    if (!coursewareId) return;
    fetch(`/api/courseware/${encodeURIComponent(coursewareId)}/access-token`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { token?: unknown }) => {
        if (!cancelled && typeof j?.token === 'string' && j.token) setAccessToken(j.token);
      })
      .catch((e) => {
        console.warn('[InteractiveCoursewareViewer] Failed to mint courseware access token:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [coursewareId]);

  const toggleFullscreen = () => {
    const element = containerRef.current;
    if (!element) return;

    if (!document.fullscreenElement) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        (element as any).webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

  if (!coursewareId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-300">
        <Globe size={48} className="mb-4 text-gray-300 opacity-50" />
        <h3 className="text-lg font-medium text-gray-700">No Courseware Selected</h3>
        <p className="mt-2 text-sm text-center">Please select a courseware from the list to view it interactively.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative"
    >
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 select-none">
          <Globe size={16} className="text-indigo-500" />
          <span className="font-semibold text-sm text-gray-700">Interactive Courseware</span>
        </div>
        {/* 插件工具栏扩展（草稿本浮窗/截图批注/双语字幕/随堂笔记等） */}
        <ExtensionPointRenderer
          slot="courseware.viewer.toolbar"
          slotProps={{ coursewareId, classId: null, lessonId: null }}
        />
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors cursor-pointer"
            title={isFullscreen ? '退出全屏' : '全屏播放'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 relative bg-white">
        {/* 插件浮层 HUD（弹幕/防作弊水印/抢答悬浮球等；容器 pointer-events-none，插件自行开启子元素交互） */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <ExtensionPointRenderer slot="courseware.viewer.overlay" slotProps={{ coursewareId }} />
        </div>
        {accessToken ? (
          <iframe
            src={`/api/courseware/${coursewareId}?ct=${encodeURIComponent(accessToken)}`}
            sandbox="allow-scripts allow-forms allow-downloads"
            data-lms-bridge="true"
            allowFullScreen
            className="w-full h-full border-none"
            title="Interactive Courseware"
            onLoad={handleIframeLoad}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 bg-slate-50">
            课件加载中…
          </div>
        )}
      </div>
    </div>
  );
}

export default InteractiveCoursewareViewer;
