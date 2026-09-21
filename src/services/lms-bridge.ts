import { useEffect } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from './event-bus';
import type { SessionType } from '../types/app';

export interface LmsMessagePayload {
  attempt_id?: string;
  uuid?: string;
  type?: string;
  payload?: any;
  score?: number;
  grade?: number;
  result?: any;
  points?: number;
  comment?: string;
  feedback?: string;
  note?: string;
  completion?: number;
  [key: string]: any;
}

/**
 * attempt 认领缓存：原始 attemptId → 认领后的 attemptId。
 * 同一页面会话内只需认领一次，避免每条消息都多打一次请求。
 */
const adoptedAttemptIds = new Map<string, string>();

/**
 * 归属认领。
 *
 * 背景：课件 iframe 以 `credentialless` + `sandbox`（无 allow-same-origin）加载，
 * 访问 `/runtime/:uuid/` 时**不携带会话 cookie**，服务端 `injectLmsSdk` 只能识别为匿名，
 * 从而建出一条 `student_id='guest'` 的共享 attempt（同一课件的所有匿名访问者复用同一条）。
 * 后果：所有学生共用一个 attempt，真实学生提交时因归属不符被 403 丢弃。
 *
 * 修复：由持有会话 cookie 的父窗口（本模块）在转发上报前先请求服务端把该 attempt
 * 认领到当前登录学生名下；若该 attempt 已归属其他学生，服务端会为当前学生新建/复用
 * 他自己的 attempt 并返回其 id。
 *
 * 失败（未登录 / 网络异常）时退回原始 attemptId，不阻断上报。
 */
async function adoptAttempt(attemptId: string): Promise<string> {
  const cached = adoptedAttemptIds.get(attemptId);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      if (res.status !== 401) {
        console.warn(`[LMS Bridge] Attempt adopt failed: HTTP ${res.status}`);
      }
      return attemptId;
    }
    const json = (await res.json()) as { attemptId?: string };
    if (typeof json?.attemptId === 'string' && json.attemptId) {
      adoptedAttemptIds.set(attemptId, json.attemptId);
      return json.attemptId;
    }
    return attemptId;
  } catch (e) {
    console.warn('[LMS Bridge] Attempt adopt request failed:', e);
    return attemptId;
  }
}

/**
 * Validates and processes incoming LMS messages from sandboxed courseware iframes.
 */
export async function processLmsMessage(event: MessageEvent): Promise<void> {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Security: Verify that event.source is an iframe within the current document
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && event.source) {
    try {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const isFromValidIframe = iframes.some((f) => f.contentWindow === event.source);
      if (!isFromValidIframe && event.source !== window) {
        // Drop message from unknown external window / popup
        return;
      }
    } catch {
      // Ignore DOM query errors
    }
  }

  let attemptId = data.attempt_id;
  const type = data.type || '';
  const payload = data.payload || data;

  // Try to extract attemptId from sending iframe if same-origin is accessible
  if (!attemptId && event.source) {
    try {
      const iframe = Array.from(document.querySelectorAll('iframe')).find((f) => f.contentWindow === event.source);
      if (iframe && iframe.contentWindow) {
        const iframeWindow = iframe.contentWindow as any;
        if (iframeWindow.__LMS_STUDENT__?.attempt_id) {
          attemptId = iframeWindow.__LMS_STUDENT__.attempt_id;
        }
      }
    } catch {
      // Cross-origin or sandbox security error, ignore
    }
  }

  if (!attemptId || typeof attemptId !== 'string') return;

  // 归属认领：把 iframe 上报的（可能是 guest 共享的）attempt 认领到当前登录用户名下。
  // 见 adoptAttempt() 注释。失败时退回原始 attemptId，不阻断上报。
  attemptId = await adoptAttempt(attemptId);

  // ── 双向通信：课件上报配置/元数据 ──
  if (type === 'LMS_CONFIG') {
    emitCoursewareEvent('courseware.config_reported', attemptId, data.config ?? payload);
    return;
  }

  // ── 双向通信：课件请求恢复上次保存的进度 ──
  if (type === 'LMS_GET_PROGRESS') {
    const requestId = data.requestId as string | undefined;
    const source = event.source as Window | null;
    if (requestId && source && typeof source.postMessage === 'function') {
      // SEC-AUTH: 确保接收方必须为 DOM 中受管辖的合法 iframe
      if (typeof document !== 'undefined') {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const isFromValidIframe = iframes.some((f) => f.contentWindow === source);
        if (!isFromValidIframe && source !== window) {
          console.warn('[LMS Bridge Security] Dropping response to untrusted window');
          return;
        }
      }

      let progress: Record<string, unknown> | null;
      try {
        const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/progress`);
        const json = (await res.json()) as { progress?: Record<string, unknown> | null };
        progress = json.progress ?? null;
      } catch {
        progress = null;
      }
      // 对于具有具体 Origin 的课件定向回复，沙箱 opaque origin (null) 时定向到该受控 window
      const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
      source.postMessage({ type: 'LMS_PROGRESS_RESPONSE', requestId, progress }, targetOrigin);
    }
    return;
  }

  // Identify if this is a submission, progress save, or general telemetry log
  const isSubmit =
    type === 'LMS_SUBMIT' ||
    type === 'LMS_FINISH' ||
    type === 'submit' ||
    type === 'finish' ||
    type === 'completed' ||
    (payload &&
      typeof payload === 'object' &&
      (payload.score !== undefined ||
        payload.grade !== undefined ||
        payload.result !== undefined ||
        payload.points !== undefined));

  const isSaveProgress = type === 'LMS_SAVE_PROGRESS' || type === 'saveProgress';

  if (isSubmit) {
    emitCoursewareEvent('courseware.submitted', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
          comment: payload?.comment ?? payload?.feedback ?? payload?.note ?? undefined,
          completion: payload?.completion ?? 1.0,
          // 终态必须用 'completed'：后端 courseware.submit_attempt 处理器只在该取值下
          // 更新 courseware_attempt.finished_at / status；传 'submitted' 会永远停在“进行中”，
          // 导致「已提交/完成」筛选、HtmlAppletFrame 的 submittedAttempts 全部失效。
          status: 'completed',
          extra: payload,
        }),
      });
      if (!res.ok) {
        // 旧实现不看响应，403（归属不符）会被静默吞掉，学生端看起来“提交成功”实际已丢失。
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected attempt submission: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to submit attempt data to backend:', e);
    }
  } else if (isSaveProgress) {
    emitCoursewareEvent('courseware.progress_saved', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
          comment: payload?.comment ?? payload?.feedback ?? undefined,
          completion: payload?.completion ?? undefined,
          status: 'inprogress',
          extra: payload,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected progress save: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to save progress to backend:', e);
    }
  } else {
    emitCoursewareEvent('courseware.event_logged', attemptId, payload);
    try {
      const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: type || 'log',
          payload: payload,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[LMS Bridge] Backend rejected event log: HTTP ${res.status}`, detail);
      }
    } catch (e) {
      console.error('[LMS Bridge] Failed to log event to backend:', e);
    }
  }
}

/**
 * 发布课件事件到前端 EventBus（`courseware.` 前缀会经 Socket 转发到后端 EventBus，
 * 供 AI Agent 与插件订阅分析）。
 *
 * 同时写入 WhiteboardEventSlot，使白板内的 TeacherPanel / 调试面板能实时订阅。
 */
function emitCoursewareEvent(type: string, attemptId: string, payload: unknown): void {
  void frontendEventBus.publish({
    id: uuidv7(),
    type,
    source: 'courseware-bridge',
    payload: { attemptId, data: payload },
    timestamp: Date.now(),
    correlationId: attemptId,
  });
  // 同步进入白板事件槽（纯前端，不依赖 socket）
  try {
    const payloadObj = (payload ?? {}) as Record<string, unknown>;
    void import('../features/whiteboard/events/WhiteboardEventSlot').then(({ whiteboardEventSlot }) => {
      whiteboardEventSlot.ingest({
        source: 'iframe.bridge',
        type,
        attemptId,
        coursewareUuid: typeof payloadObj.courseware_uuid === 'string' ? payloadObj.courseware_uuid : undefined,
        payload: {
          ...payloadObj,
          attemptId,
        },
        raw: payload,
      });
    });
  } catch {
    // WhiteboardEventSlot 故障不应影响 EventBus 主路径
  }
}

/**
 * 宿主 → 课件单向指令：向指定 iframe 下发 `LMS_HOST_COMMAND` 事件。
 * 课件侧通过 `window.LMS.on(event, callback)` 订阅。
 */
export function sendCommandToCourseware(
  iframe: HTMLIFrameElement,
  event: string,
  payload?: unknown,
  targetOrigin?: string,
): void {
  try {
    let origin = targetOrigin;
    if (!origin && iframe.src && typeof window !== 'undefined') {
      try {
        const url = new URL(iframe.src, window.location.href);
        if (url.origin && url.origin !== 'null' && !iframe.src.startsWith('blob:') && !iframe.src.startsWith('data:')) {
          origin = url.origin;
        }
      } catch {
        // ignore invalid URL
      }
    }
    iframe.contentWindow?.postMessage({ type: 'LMS_HOST_COMMAND', event, payload }, origin || '*');
  } catch {
    // 跨域/沙箱安全限制时静默失败
  }
}

/**
 * Hook to attach the LMS message listener when a user session is active.
 */
export function useLmsBridge(session: SessionType | null): void {
  useEffect(() => {
    if (!session) return;

    const handleLmsMessage = (event: MessageEvent) => {
      void processLmsMessage(event);
    };

    window.addEventListener('message', handleLmsMessage);
    return () => {
      window.removeEventListener('message', handleLmsMessage);
    };
  }, [session]);
}

/**
 * 向页面中所有已加载的课件 / 微前端 iframe 广播当前主题状态
 */
export function broadcastThemeToIframes(theme: string, tokens: Record<string, string> = {}): void {
  if (typeof document === 'undefined') return;
  try {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_HOST_COMMAND',
            event: 'theme:changed',
            payload: { theme, tokens },
          },
          '*',
        );
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_THEME_CHANGED',
            theme,
            tokens,
          },
          '*',
        );
      } catch {
        // 忽略可能存在的跨域限制报错
      }
    });
  } catch {
    // 忽略异常
  }
}

/**
 * 向页面中所有已加载的课件 / 微前端 iframe 广播当前界面字号缩放比例
 */
export function broadcastFontScaleToIframes(scale: number): void {
  if (typeof document === 'undefined') return;
  try {
    const clampedScale = Math.min(140, Math.max(85, Math.round(scale)));
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_HOST_COMMAND',
            event: 'font-scale:changed',
            payload: { scale: clampedScale, fontScale: (clampedScale / 100).toFixed(2) },
          },
          '*',
        );
        iframe.contentWindow?.postMessage(
          {
            type: 'LMS_FONT_SCALE_CHANGED',
            scale: clampedScale,
            fontScale: (clampedScale / 100).toFixed(2),
          },
          '*',
        );
      } catch {
        // 忽略跨域错误
      }
    });
  } catch {
    // 忽略异常
  }
}

