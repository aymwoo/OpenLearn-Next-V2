import React, { useState, useEffect } from 'react';
import { wrapSrcDocWithBridge } from '../whiteboard/utils/bridgeUtils';
import { coursewareSourceRegistry } from '../whiteboard/courseware/courseware-source-registry';
import { useCoursewareFrameMount } from '../whiteboard/courseware/courseware-frame-limiter';
import { useThemeStore, getThemeTokens } from '../../store/themeStore';
import { useFontSizeStore } from '../../store/fontSizeStore';
import { broadcastThemeToIframes, broadcastFontScaleToIframes, registerManagedIframe } from '../../services/lms-bridge';
import { whiteboardEventSlot } from '../whiteboard/events/WhiteboardEventSlot';

function pickNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * CoursewareHost 接受的最小内容源描述。
 *
 * 与白板 `HtmlAppletPayload` 结构兼容，但刻意不依赖白板模块，方便学案区块
 * 与第三方工作区复用同一容器。
 */
export interface CoursewareSource {
  coursewareUuid?: string;
  resourceId?: string;
  code?: string;
  title?: string;
  /** 插件自定义内容源类型（配合 coursewareSourceRegistry） */
  sourceType?: string;
  /** 插件自定义内容源 id（配合 coursewareSourceRegistry） */
  sourceId?: string;
}

export interface CoursewareHostProps {
  source: CoursewareSource;
  lessonId: string;
  /** 画布元素 id（事件槽关联到具体组件），可选 */
  elementId?: string;
  className?: string;
  title?: string;
  /** 懒挂载（进入可视区才创建 iframe），默认 true */
  lazy?: boolean;
  /** 渲染在 iframe 之上的附加浮层（成绩榜、工具栏等） */
  overlay?: React.ReactNode;
  /**
   * LMS Bridge 事件回调（已归一化）。
   *
   * 白板沿用 WhiteboardEventSlot；LearningSurface 宿主用它把进度 / 提交
   * 写入统一 attempt 表，两条路径互不影响。
   */
  onEvent?: (event: CoursewareHostEvent) => void;
}

/** CoursewareHost 归一化后的生命周期事件。 */
export type CoursewareHostEvent =
  | { type: 'progress'; completion?: number; score?: number; total?: number; attemptId?: string }
  | { type: 'submit'; completion?: number; score?: number; total?: number; attemptId?: string }
  | { type: 'finish'; attemptId?: string };

/** `GET /api/courseware/host` 返回的插件宿主信息（只取渲染所需字段）。 */
interface PluginCoursewareHost {
  id: string;
  label: string;
  view?: string;
  entry?: string;
  pluginId: string;
}

/** 只接受插件静态目录下的相对路径，拒绝 `..` / 协议 / 绝对路径。 */
function safePluginView(view: string): string | null {
  const trimmed = view.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('..')) return null;
  if (!/^[a-zA-Z0-9_\-./]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 互动课件沙箱容器（独立于白板/学案）。
 *
 * 统一渲染四种内容源（优先级从高到低）：
 *   1. coursewareUuid → `/runtime/:uuid/`（ZIP 解包的多文件互动课件）
 *   2. resourceId     → `/api/resources/:id/`（系统资源库单 HTML / 文件夹）
 *   3. 插件自定义内容源 → `coursewareSourceRegistry` 返回的 src URL
 *   4. code           → iframe `srcDoc` + `wrapSrcDocWithBridge`（手写 HTML）
 *
 * 负责：懒挂载与并发上限、短时访问 token、手写 HTML 服务端落库、主题/字号广播、
 * LMS Bridge postMessage 归一化（写入 WhiteboardEventSlot）。
 */
export function CoursewareHost({
  source,
  lessonId,
  elementId,
  className,
  title,
  lazy = true,
  overlay,
  onEvent,
}: CoursewareHostProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  // 事件回调放 ref，避免父组件每次渲染都重绑 postMessage 监听。
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;
  const mounted = useCoursewareFrameMount(lazy, containerRef);
  const { theme } = useThemeStore();
  const { scale } = useFontSizeStore();

  // SEC-AUTH: /runtime 课件 HTML 入口的短时访问 token（见 server/utils/courseware-access.ts）。
  // 正常浏览器靠 Sec-Fetch 元数据放行即可，这里铸造 token 作为旧浏览器/特殊 webview 的兜底。
  const [runtimeToken, setRuntimeToken] = useState<string | null>(null);
  // SEC-NET-02: 手写 HTML 课件经服务端落库（POST /api/courseware/inline）后改走
  // /runtime/inline-<hash>/ 加载 —— srcdoc 文档会继承父页面 CSP，全局 CSP 收紧后
  // 课件内联脚本会被拦；服务端直出的 /runtime 文档有自有宽松 CSP，不受影响。
  const [inlineUuid, setInlineUuid] = useState<string | null>(null);
  // 插件宿主接管：仅当插件声明了可 iframe 的 view 时才替换内置渲染；
  // 只声明 entry（远程模块）时无法在沙箱内直接加载，继续使用内置宿主。
  const [pluginHost, setPluginHost] = useState<PluginCoursewareHost | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/courseware/host')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { kind?: string; host?: Record<string, unknown> } } | null) => {
        if (cancelled) return;
        const host = body?.data?.kind === 'plugin' ? body.data.host : null;
        if (!host) return;
        const view = typeof host.view === 'string' ? safePluginView(host.view) : null;
        if (!view || typeof host.pluginId !== 'string' || typeof host.id !== 'string') return;
        setPluginHost({
          id: host.id,
          label: typeof host.label === 'string' ? host.label : host.id,
          view,
          entry: typeof host.entry === 'string' ? host.entry : undefined,
          pluginId: host.pluginId,
        });
      })
      .catch(() => {
        // 宿主目录不可用时按内置宿主渲染
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customSrc = coursewareSourceRegistry.resolve(source, { lessonId });
  const isInlineOnly = !!source.code && !source.coursewareUuid && !source.resourceId && !customSrc;
  const effectiveUuid = source.coursewareUuid ?? (isInlineOnly ? inlineUuid : null);

  useEffect(() => {
    if (!isInlineOnly || !source.code) {
      setInlineUuid(null);
      return;
    }
    let cancelled = false;
    fetch('/api/courseware/inline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: source.code }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { uuid?: unknown }) => {
        if (!cancelled && typeof j?.uuid === 'string' && j.uuid) setInlineUuid(j.uuid);
      })
      .catch(() => {
        // 落库失败不阻断渲染：降级回 srcDoc（内联脚本在收紧后的全局 CSP 下会被拦，
        // 但页面 HTML 仍可见），由教师重新保存元素恢复
      });
    return () => {
      cancelled = true;
    };
  }, [isInlineOnly, source.code]);

  useEffect(() => {
    if (!effectiveUuid) {
      setRuntimeToken(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (lessonId) params.set('lessonId', lessonId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/courseware/${encodeURIComponent(effectiveUuid)}/access-token${suffix}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { token?: unknown }) => {
        if (!cancelled && typeof j?.token === 'string' && j.token) setRuntimeToken(j.token);
      })
      .catch(() => {
        // 铸造失败不阻断渲染：现代浏览器仍可经 Sec-Fetch 元数据通过门控
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveUuid, lessonId]);

  const handleIframeLoad = () => {
    broadcastThemeToIframes(theme, getThemeTokens(theme));
    broadcastFontScaleToIframes(scale);
  };

  /**
   * 监听 iframe 内的 postMessage，把 LMS Bridge SDK 协议事件归一化进 WhiteboardEventSlot。
   *
   * 注意：
   * - 仅监听本组件的 iframe（通过 contentWindow 引用比对），与全局 lms-bridge 监听器共存不冲突
   * - 适配 LMS_SUBMIT / LMS_SAVE_PROGRESS / LMS_FINISH / courseware:score / openlearn-cw-sdk:score
   * - 未知 LMS_* 协议事件统一记入 'courseware.unknown'，便于调试面板观察
   */
  useEffect(() => {
    const shapeId = elementId ?? source.title ?? undefined;
    const uuid = source.coursewareUuid;
    if (!shapeId && !uuid) return;
    if (!mounted) return;

    const iframe = containerRef.current?.querySelector('iframe');
    if (!iframe || !(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return;

    const messageHandler = (event: MessageEvent) => {
      // 仅信任本组件的 iframe
      if (event.source !== iframe.contentWindow) return;

      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      // LMS Bridge SDK 协议
      if (msg.type === 'LMS_SUBMIT') {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        const attemptId = typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined;
        const completion = pickNumber(payload.completion ?? payload.progress);
        const score = pickNumber(payload.score ?? payload.grade);
        const total = pickNumber(payload.total ?? payload.fullScore);
        onEventRef.current?.({ type: 'submit', completion, score, total, attemptId });
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.submitted',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId,
          payload: {
            score,
            total,
            completion,
            comment: typeof payload.comment === 'string' ? payload.comment : undefined,
          },
          raw: msg,
        });
      } else if (msg.type === 'LMS_SAVE_PROGRESS') {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        const attemptId = typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined;
        const completion = pickNumber(payload.completion ?? payload.progress);
        const score = pickNumber(payload.score);
        onEventRef.current?.({ type: 'progress', completion, score, attemptId });
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.progress_saved',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId,
          payload: {
            score,
            completion,
          },
          raw: msg,
        });
      } else if (msg.type === 'LMS_FINISH') {
        const attemptId = typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined;
        onEventRef.current?.({ type: 'finish', attemptId });
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.finished',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId,
          payload: {},
          raw: msg,
        });
      } else if (msg.type === 'courseware:score' || msg.type === 'openlearn-cw-sdk:score') {
        // v2_plugins/courseware-hub SDK 协议
        const payload = (msg.payload ?? msg) as Record<string, unknown>;
        const score = pickNumber(payload.score);
        const total = pickNumber(payload.total);
        onEventRef.current?.({ type: 'submit', score, total });
        whiteboardEventSlot.ingest({
          source: 'applet.score',
          type: 'courseware.submitted',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          payload: {
            score,
            total,
            detail: payload.detail,
            source: typeof msg.source === 'string' ? msg.source : 'openlearn-cw-sdk',
          },
          raw: msg,
        });
      } else if (typeof msg.type === 'string' && msg.type.startsWith('LMS_')) {
        // 其他 LMS_* 协议事件统一记入 unknown 分桶
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.unknown',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          payload: { originalType: msg.type },
          raw: msg,
        });
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [mounted, elementId, source.title, source.coursewareUuid, lessonId]);

  const pluginHostSrc = pluginHost?.view
    ? `/plugins/${encodeURIComponent(pluginHost.pluginId)}/${pluginHost.view}?${new URLSearchParams({
        lessonId,
        elementId: elementId ?? '',
        coursewareUuid: source.coursewareUuid ?? '',
        resourceId: source.resourceId ?? '',
        title: source.title ?? '',
      }).toString()}`
    : undefined;

  const src =
    pluginHostSrc ??
    (source.coursewareUuid
      ? `/runtime/${source.coursewareUuid}/${runtimeToken ? `?ct=${encodeURIComponent(runtimeToken)}` : ''}`
      : source.resourceId
        ? `/api/resources/${source.resourceId}/`
        : (customSrc ??
          (inlineUuid
            ? `/runtime/${inlineUuid}/${runtimeToken ? `?ct=${encodeURIComponent(runtimeToken)}` : ''}`
            : undefined)));

  useEffect(() => {
    if (!mounted) return;
    const iframe = iframeRef.current ?? containerRef.current?.querySelector('iframe');
    if (iframe && iframe instanceof HTMLIFrameElement) {
      return registerManagedIframe(iframe);
    }
  }, [mounted, src]);

  return (
    <div ref={containerRef} className={(className ?? 'w-full h-full') + ' relative'}>
      {mounted ? (
        <iframe
          ref={iframeRef}
          className="w-full h-full border-none"
          src={src}
          srcDoc={src ? undefined : wrapSrcDocWithBridge(source.code || '', lessonId)}
          sandbox="allow-scripts allow-forms allow-downloads"
          data-lms-bridge="true"
          referrerPolicy="no-referrer"
          title={title ?? source.title ?? 'Interactive Courseware'}
          {...({ credentialless: 'true' } as unknown as React.IframeHTMLAttributes<HTMLIFrameElement>)}
          onLoad={handleIframeLoad}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl">
          课件未加载
        </div>
      )}
      {overlay}
    </div>
  );
}

export default CoursewareHost;
