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
      const iframe = Array.from(document.querySelectorAll('iframe')).find(
        (f) => f.contentWindow === event.source,
      );
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
      let progress: Record<string, unknown> | null = null;
      try {
        const res = await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/progress`);
        const json = (await res.json()) as { progress?: Record<string, unknown> | null };
        progress = json.progress ?? null;
      } catch {
        progress = null;
      }
      source.postMessage({ type: 'LMS_PROGRESS_RESPONSE', requestId, progress }, '*');
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
      await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload?.score ?? payload?.grade ?? payload?.result ?? payload?.points ?? undefined,
          comment: payload?.comment ?? payload?.feedback ?? payload?.note ?? undefined,
          completion: payload?.completion ?? 1.0,
          status: 'submitted',
          extra: payload,
        }),
      });
    } catch (e) {
      console.error('[LMS Bridge] Failed to submit attempt data to backend:', e);
    }
  } else if (isSaveProgress) {
    emitCoursewareEvent('courseware.progress_saved', attemptId, payload);
    try {
      await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/submit`, {
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
    } catch (e) {
      console.error('[LMS Bridge] Failed to save progress to backend:', e);
    }
  } else {
    emitCoursewareEvent('courseware.event_logged', attemptId, payload);
    try {
      await fetch(`/api/courseware/attempts/${encodeURIComponent(attemptId)}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: type || 'log',
          payload: payload,
        }),
      });
    } catch (e) {
      console.error('[LMS Bridge] Failed to log event to backend:', e);
    }
  }
}

/**
 * 发布课件事件到前端 EventBus（`courseware.` 前缀会经 Socket 转发到后端 EventBus，
 * 供 AI Agent 与插件订阅分析）。
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
}

/**
 * 宿主 → 课件单向指令：向指定 iframe 下发 `LMS_HOST_COMMAND` 事件。
 * 课件侧通过 `window.LMS.on(event, callback)` 订阅。
 */
export function sendCommandToCourseware(
  iframe: HTMLIFrameElement,
  event: string,
  payload?: unknown,
): void {
  try {
    iframe.contentWindow?.postMessage({ type: 'LMS_HOST_COMMAND', event, payload }, '*');
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
