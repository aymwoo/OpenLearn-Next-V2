import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, ChevronUp, Loader2 } from 'lucide-react';
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
  /**
   * 当前视图的使用者身份（学生端槽位才有）。
   * 沙箱 iframe 无法访问宿主会话，插件只能通过该字段拿到「我是谁」，
   * 用于在共享数据（如便签、投票）中标注作者。
   */
  studentId?: string | null;
  studentName?: string | null;
  className?: string;
  onResize?: (height: number) => void;
  /**
   * 容器布局语义。
   * - `panel`（默认）：占满父容器，用于 `teacher.tab` / `teacher.panel` / `student.view` 等页面级槽位。
   * - `floating`：固定定位的小浮层，**不参与父级 flex 布局**，用于 `student.classroom.overlay`
   *   这类「浮在课堂视图之上」的槽位。
   *
   * 背景：父级 `App.tsx` 是 `flex h-screen` 横向容器，若把带 `w-full h-full` 的块级视图
   * 直接插进去，它会成为 flex item 并占满整行宽，把 `flex-1` 的主内容（白板）挤成 0 宽。
   */
  variant?: PluginViewVariant;
  style?: React.CSSProperties;
  /**
   * 全班专注锁定（只读跟随）期间为 true。
   *
   * iframe 始终保持挂载（插件内未提交的状态不丢），但必须不可操作：
   * - `panel` 槽位：视图留在原地，覆盖一层拦截罩并禁用指针/键盘事件；
   * - `floating` 槽位：整体下滑收起，原位只留一个「已收起」提示图标。
   *
   * 否则学生会继续点得动浮层里的便签输入框、抢答球等组件 ——
   * 锁定只锁了白板，`student.classroom.overlay` 这类浮层完全不受影响。
   */
  locked?: boolean;
}

export type PluginViewVariant = 'panel' | 'floating';

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
  studentId,
  studentName,
  className,
  onResize,
  variant = 'panel',
  style,
  locked = false,
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
          studentId: studentId ?? null,
          studentName: studentName ?? null,
          lang,
          theme,
        },
      },
      '*',
    );
  }, [pluginId, slot, lessonId, classId, studentId, studentName, lang, theme]);

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
            const rawType = args[1];
            const type = rawType === 'success' || rawType === 'warning' || rawType === 'error' ? rawType : 'info';
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
              const errDetail =
                typeof json === 'object' && json !== null && 'error' in json
                  ? String((json as Record<string, unknown>).error)
                  : `Request failed with HTTP ${res.status}`;
              reply(false, undefined, errDetail);
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
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          reply(false, undefined, errMsg);
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
          studentId: studentId ?? null,
          studentName: studentName ?? null,
          lang,
          theme,
        },
      },
      '*',
    );
  }, [lessonId, classId, studentId, studentName, lang, theme, isLoaded]);

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

  // panel：铺满父容器（页面级槽位）；floating：固定小浮层，不占父级布局。
  const isFloating = variant === 'floating';
  // 浮层型槽位（如 student.classroom.overlay）锁定后整体下滑收起，
  // 原位只留一个「已收起」的展开图标；页面级 panel 槽位仍用拦截罩。
  const collapsed = locked && isFloating;
  const containerClassName = isFloating
    ? `fixed bottom-6 left-6 z-40 flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-slate-700 dark:bg-slate-900 ${className || ''}`
    : `relative w-full h-full flex flex-col min-h-0 bg-white dark:bg-slate-900 ${className || ''}`;
  const containerStyle: React.CSSProperties = {
    ...(style || {}),
    ...(isFloating ? { height: `${iframeHeight ?? 180}px` } : iframeHeight ? { minHeight: `${iframeHeight}px` } : {}),
    ...(collapsed ? { transform: 'translateY(calc(100% + 1.5rem))' } : {}),
  };

  return (
    <>
      <div
        className={`${containerClassName}${collapsed ? ' pointer-events-none' : ''}`}
        style={containerStyle}
        data-plugin-view-variant={variant}
        data-plugin-view-locked={locked ? 'true' : undefined}
        data-plugin-view-collapsed={collapsed ? 'true' : undefined}
        aria-hidden={collapsed ? true : undefined}
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
          // 锁定时连键盘焦点也挡掉：pointer-events 只拦鼠标/触摸
          inert={locked ? true : undefined}
          className={`w-full flex-1 border-none transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }${locked ? ' pointer-events-none' : ''}`}
        />
        {/* 专注锁定拦截罩：仅页面级 panel 槽位使用（浮层型已整体收起） */}
        {locked && !isFloating && (
          <div
            data-testid="plugin-view-lock-cover"
            className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/15 backdrop-blur-[1px] cursor-not-allowed select-none"
            title={
              lang === 'zh'
                ? '老师已开启全班专注锁定，当前为只读跟随'
                : 'Classroom focus lock is on — read-only follow mode'
            }
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <span className="px-2 py-1 rounded-full bg-slate-900/70 text-white text-[10px] font-bold tracking-wide">
              🔒 {lang === 'zh' ? '专注锁定中' : 'Focus locked'}
            </span>
          </div>
        )}
      </div>

      {/* 收起后的原位提示：点击只解释「为什么收起了」，不会打开浮层 */}
      {collapsed && (
        <button
          type="button"
          data-testid="plugin-view-lock-collapsed"
          aria-expanded={false}
          aria-label={
            lang === 'zh'
              ? `${label || pluginId} 已收起：老师已开启全班专注锁定`
              : `${label || pluginId} collapsed: classroom focus lock is on`
          }
          title={
            lang === 'zh'
              ? '老师已开启全班专注锁定，互动浮层已收起'
              : 'Classroom focus lock is on — the floating panel is collapsed'
          }
          className="fixed bottom-6 left-6 z-40 flex items-center gap-1 rounded-full border border-slate-300 bg-white/95 px-2.5 py-1.5 text-slate-500 shadow-lg backdrop-blur-xs transition-colors hover:text-slate-700 dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-300"
          style={style}
          onClick={() =>
            appStore.getState().addToast({
              id: Math.random().toString(16).slice(2),
              title: label || pluginId,
              message:
                lang === 'zh'
                  ? '老师已开启全班专注锁定，互动浮层暂时收起，解锁后自动恢复。'
                  : 'Classroom focus lock is on — the floating panel is collapsed and will return after unlock.',
              type: 'info',
            })
          }
        >
          <ChevronUp size={14} />
          <span className="text-[10px] font-bold">🔒</span>
        </button>
      )}
    </>
  );
}

export default PluginSandboxIframeView;
