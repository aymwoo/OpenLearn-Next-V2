import { useEffect } from 'react';
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
