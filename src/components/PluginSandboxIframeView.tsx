import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { PLUGIN_VIEW_CHANNEL } from '../plugin-host/sandbox-frame';
import { useAppStore, appStore } from '../store/appStore';
import { useThemeStore } from '../store/themeStore';

export interface PluginSandboxIframeViewProps {
  pluginId: string;
  view: string;
  label?: string;
  slot?: string;
  lessonId?: string | null;
  classId?: string | null;
  className?: string;
  onResize?: (height: number) => void;
}

/**
 * 校验并净化插件自定义页面路径，防止跨目录遍历或协议注入。
 */
export function sanitizeViewPath(rawView: string): string | null {
  if (typeof rawView !== 'string' || !rawView.trim()) return null;
  const trimmed = rawView.trim();
  if (
    trimmed.includes('://') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('\\') ||
    trimmed.includes('..') ||
    /^(javascript|data|blob):/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.replace(/^\/+/, '');
}

/**
 * 插件可视化沙箱容器组件 (Dual-Track UI Architecture Phase 1)
 *
 * 在严格沙箱 iframe（无 allow-same-origin）中呈现第三方插件贡献的 HTML/JS 页面，
 * 并通过 postMessage 桥（'ol-plugin-view'）提供上下文同步、RPC 与命令调用能力。
 */
export function PluginSandboxIframeView({
  pluginId,
  view,
  label,
  slot,
  lessonId: propLessonId,
  classId: propClassId,
  className,
  onResize,
}: PluginSandboxIframeViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [iframeHeight, setIframeHeight] = useState<number | null>(null);

  const lang = useAppStore((s) => s.lang);
  const storeLessonId = useAppStore((s) => s.selectedLesson);
  const storeClassId = useAppStore((s) => s.liveClassSelectedClassId);
  const theme = useThemeStore((s) => s.theme);

  const lessonId = propLessonId !== undefined ? propLessonId : storeLessonId;
  const classId = propClassId !== undefined ? propClassId : storeClassId;

  const cleanView = sanitizeViewPath(view);

  const postInit = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'init',
        payload: {
          pluginId,
          slot,
          lessonId,
          classId,
          lang,
          theme,
        },
      },
      '*',
    );
  }, [pluginId, slot, lessonId, classId, lang, theme]);

  // 处理 iframe 内部发送来的消息与 RPC 调度
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.channel !== PLUGIN_VIEW_CHANNEL) return;

      if (data.type === 'ready') {
        setIsLoaded(true);
        postInit();
        return;
      }

      if (data.type === 'resize' && typeof data.height === 'number' && data.height > 0) {
        setIframeHeight(data.height);
        onResize?.(data.height);
        return;
      }

      if (data.type === 'call' && data.callId && data.op) {
        const { callId, op, args = [] } = data;
        const reply = (ok: boolean, value?: unknown, error?: string) => {
          iframe.contentWindow?.postMessage(
            {
              channel: PLUGIN_VIEW_CHANNEL,
              type: 'reply',
              callId,
              ok,
              value,
              error,
            },
            '*',
          );
        };

        try {
          if (op === 'ui.toast') {
            const message = String(args[0] ?? '');
            const type = (args[1] as any) || 'info';
            appStore.getState().addToast({
              id: Math.random().toString(16).slice(2),
              title: label || pluginId,
              message,
              type,
            });
            reply(true, true);
          } else if (op === 'command.invoke') {
            const commandType = String(args[0] ?? '');
            const payload = args[1];
            const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/sandbox-command`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ type: commandType, payload }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) {
              reply(false, undefined, json.error || `Command failed with HTTP ${res.status}`);
            } else {
              reply(true, json.result);
            }
          } else if (op === 'api.get' || op === 'api.post' || op === 'api.del') {
            const subpath = String(args[0] ?? '').replace(/^\/+/, '');
            const url = subpath.startsWith('api/plugins/')
              ? `/${subpath}`
              : `/api/plugins/${encodeURIComponent(pluginId)}/${subpath}`;
            const method = op === 'api.get' ? 'GET' : op === 'api.post' ? 'POST' : 'DELETE';
            const res = await fetch(url, {
              method,
              headers: op === 'api.post' ? { 'Content-Type': 'application/json' } : undefined,
              credentials: 'include',
              body: op === 'api.post' ? JSON.stringify(args[1]) : undefined,
            });
            let json: unknown;
            try {
              json = await res.json();
            } catch {
              json = await res.text();
            }
            if (!res.ok) {
              reply(
                false,
                undefined,
                typeof json === 'object' && json && 'error' in (json as any)
                  ? (json as any).error
                  : `Request failed with HTTP ${res.status}`,
              );
            } else {
              reply(true, json);
            }
          } else if (op === 'storage.get') {
            const key = `ol_pv_${pluginId}_${String(args[0] ?? '')}`;
            const val = localStorage.getItem(key);
            let parsed = val;
            try {
              parsed = JSON.parse(val ?? '');
            } catch {}
            reply(true, parsed ?? val);
          } else if (op === 'storage.set') {
            const key = `ol_pv_${pluginId}_${String(args[0] ?? '')}`;
            const val = typeof args[1] === 'string' ? args[1] : JSON.stringify(args[1] ?? null);
            localStorage.setItem(key, val);
            reply(true, true);
          } else if (op === 'storage.delete') {
            const key = `ol_pv_${pluginId}_${String(args[0] ?? '')}`;
            localStorage.removeItem(key);
            reply(true, true);
          } else {
            reply(false, undefined, `Unsupported op "${op}"`);
          }
        } catch (err: any) {
          reply(false, undefined, err?.message || String(err));
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [pluginId, label, onResize, postInit]);

  // 当宿主上下文属性（课堂/班级/语言/主题）变动时同步至 iframe
  useEffect(() => {
    if (!isLoaded || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      {
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'context-update',
        payload: {
          lessonId,
          classId,
          lang,
          theme,
        },
      },
      '*',
    );
  }, [lessonId, classId, lang, theme, isLoaded]);

  if (!cleanView) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-red-600 bg-red-50/50 rounded-xl border border-red-200 m-4">
        <AlertCircle size={32} className="mb-2 text-red-500" />
        <p className="text-sm font-semibold">{lang === 'zh' ? '非法的插件视图路径' : 'Invalid Plugin View Path'}</p>
        <p className="text-xs text-red-400 mt-1 font-mono">{view || '(empty)'}</p>
      </div>
    );
  }

  const srcUrl = `/plugins/${encodeURIComponent(pluginId)}/${cleanView}`;

  return (
    <div
      className={`relative w-full h-full flex flex-col min-h-0 bg-white dark:bg-slate-900 ${className || ''}`}
      style={iframeHeight ? { minHeight: `${iframeHeight}px` } : undefined}
    >
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-2xs transition-opacity duration-200">
          <Loader2 size={24} className="animate-spin text-indigo-500 mb-2" />
          <span className="text-xs font-medium text-slate-500">
            {lang === 'zh' ? '正在加载插件视图...' : 'Loading plugin view...'}
          </span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={srcUrl}
        title={label || `${pluginId} view`}
        sandbox="allow-scripts allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        onLoad={() => {
          setIsLoaded(true);
          postInit();
        }}
        className={`w-full flex-1 border-none transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}

export default PluginSandboxIframeView;
