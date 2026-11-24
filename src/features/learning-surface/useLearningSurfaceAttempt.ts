import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptMode, ProgressPatch, SubmitPayload, SurfaceAttempt } from './types';

interface Options {
  surfaceId: string;
  lessonId: string;
  preview: boolean;
  mode: AttemptMode;
}

interface AttemptHandle {
  attempt: SurfaceAttempt | null;
  readOnly: boolean;
  onProgress: (patch: ProgressPatch) => void;
  onSubmit: (payload?: SubmitPayload) => void;
}

/** 进度上报合并窗口：渲染器可以每帧上报，宿主只落最后一次。 */
const PROGRESS_DEBOUNCE_MS = 1000;

function parseAttemptState(attempt: SurfaceAttempt | null): SurfaceAttempt | null {
  if (!attempt) return null;
  return attempt;
}

/**
 * Surface attempt 生命周期（阶段 4 从宿主内联逻辑抽出）。
 *
 * - `surface`：进入时恢复最近 attempt，首次 progress / submit 才创建；
 * - `bridge` / `none`：不创建 attempt（作业域由桥接服务维护）。
 *
 * 渲染器只拿到 `onProgress / onSubmit`，不接触 attempt id 或 HTTP。
 */
export function useLearningSurfaceAttempt({ surfaceId, lessonId, preview, mode }: Options): AttemptHandle {
  const [attempt, setAttempt] = useState<SurfaceAttempt | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const attemptIdRef = useRef<string | null>(null);
  const pendingRef = useRef<ProgressPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 恢复最近一次 attempt：只取本人（学生）记录；教师预览读不到 mine，忽略。
  useEffect(() => {
    if (mode !== 'surface') return;
    let cancelled = false;

    fetch(`/api/learning-surface-attempts/mine?surfaceId=${encodeURIComponent(surfaceId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: unknown) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const latest = parseAttemptState(rows[0] as SurfaceAttempt);
        if (!latest) return;
        attemptIdRef.current = latest.id;
        setAttempt(latest);
        setReadOnly(latest.status !== 'in_progress');
      })
      .catch(() => {
        // 恢复失败不阻断渲染：下一次 progress 会重新创建 attempt
      });

    return () => {
      cancelled = true;
    };
  }, [surfaceId, mode]);

  const ensureAttempt = useCallback(async (): Promise<string | null> => {
    if (attemptIdRef.current) return attemptIdRef.current;
    try {
      const res = await fetch('/api/learning-surface-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surfaceId, lessonId, preview }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { id?: unknown; readOnly?: unknown };
      if (typeof body.id !== 'string' || !body.id) return null;
      attemptIdRef.current = body.id;
      if (body.readOnly === true) setReadOnly(true);
      return body.id;
    } catch {
      return null;
    }
  }, [surfaceId, lessonId, preview]);

  const flushProgress = useCallback(
    async (patch: ProgressPatch) => {
      const attemptId = await ensureAttempt();
      if (!attemptId) return;
      try {
        await fetch(`/api/learning-surface-attempts/${encodeURIComponent(attemptId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(patch.completion !== undefined ? { completion: patch.completion } : {}),
            ...(patch.state !== undefined ? { state: patch.state } : {}),
            ...(patch.autoScore !== undefined ? { autoScore: patch.autoScore } : {}),
            ...(patch.maxScore !== undefined ? { maxScore: patch.maxScore } : {}),
          }),
        });
      } catch {
        // 进度丢失可由下一次上报补回
      }
    },
    [ensureAttempt],
  );

  const onProgress = useCallback(
    (patch: ProgressPatch) => {
      if (mode !== 'surface' || readOnly) return;
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const merged = pendingRef.current;
        pendingRef.current = null;
        if (merged) void flushProgress(merged);
      }, PROGRESS_DEBOUNCE_MS);
    },
    [mode, readOnly, flushProgress],
  );

  const onSubmit = useCallback(
    (payload?: SubmitPayload) => {
      if (mode !== 'surface' || readOnly) return;
      // 提交前先把最后一次进度落库，避免状态快照落后。
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = null;

      void (async () => {
        if (pending) await flushProgress(pending);
        const attemptId = await ensureAttempt();
        if (!attemptId) return;
        try {
          const res = await fetch(`/api/learning-surface-attempts/${encodeURIComponent(attemptId)}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(payload?.autoScore !== undefined ? { autoScore: payload.autoScore } : {}),
              ...(payload?.maxScore !== undefined ? { maxScore: payload.maxScore } : {}),
              ...(payload?.data !== undefined ? { payload: payload.data } : {}),
            }),
          });
          if (!res.ok) return;
          const body = (await res.json()) as SurfaceAttempt;
          setAttempt(body);
          setReadOnly(true);
        } catch {
          // 保持可重试：失败时不切换只读
        }
      })();
    },
    [mode, readOnly, ensureAttempt, flushProgress],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { attempt, readOnly, onProgress, onSubmit };
}
