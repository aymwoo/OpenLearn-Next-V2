import { useCallback, useEffect, useState } from 'react';
import { frontendEventBus } from '../../services/event-bus.js';

export interface SegmentGateProgressView {
  current: number;
  target: number;
  unit?: string;
}

export interface SegmentGateView {
  type: string;
  allowed: boolean;
  reason?: string;
  progress?: SegmentGateProgressView;
}

export interface SegmentAccessState {
  status: 'idle' | 'loading' | 'open' | 'locked';
  allowed: boolean;
  reason?: string;
  progress?: SegmentGateProgressView;
  gates: SegmentGateView[];
  visibleSegmentId: string | null;
  segmentId: string | null;
}

const IDLE: SegmentAccessState = {
  status: 'idle',
  allowed: true,
  gates: [],
  visibleSegmentId: null,
  segmentId: null,
};

function lockedFallback(segmentId: string | null, reason: string): SegmentAccessState {
  return {
    status: 'locked',
    allowed: false,
    reason,
    gates: [],
    visibleSegmentId: null,
    segmentId,
  };
}

/**
 * 向服务端核对「当前学生能否看到这个环节」。
 * 未达标、网络失败、无法识别的响应都保持锁定。锁定期间每 5 秒再问一次。
 */
export function useSegmentAccess(lessonId: string | null, targetSegmentId: string | null): SegmentAccessState {
  const [state, setState] = useState<SegmentAccessState>(IDLE);

  const refresh = useCallback(async () => {
    if (!lessonId || !targetSegmentId) {
      setState(IDLE);
      return;
    }
    setState((prev) =>
      prev.segmentId === targetSegmentId && (prev.status === 'open' || prev.status === 'locked')
        ? prev
        : { ...prev, status: 'loading', segmentId: targetSegmentId },
    );
    try {
      const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/segment-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ targetSegmentId }),
      });
      const body = await res.json().catch(() => null);
      if (typeof body?.allowed === 'boolean') {
        const gates = Array.isArray(body.gates) ? (body.gates as SegmentGateView[]) : [];
        setState({
          status: body.allowed ? 'open' : 'locked',
          allowed: body.allowed,
          reason: typeof body.reason === 'string' ? body.reason : undefined,
          progress: body.progress,
          gates,
          visibleSegmentId:
            typeof body.visibleSegmentId === 'string' ? body.visibleSegmentId : body.allowed ? targetSegmentId : null,
          segmentId: targetSegmentId,
        });
        return;
      }
      setState(
        lockedFallback(
          targetSegmentId,
          res.ok ? '进入条件返回了无法识别的结果' : `进入条件暂时无法核对（HTTP ${res.status}）`,
        ),
      );
    } catch {
      setState(lockedFallback(targetSegmentId, '进入条件服务不可达，已暂时锁定'));
    }
  }, [lessonId, targetSegmentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onRefresh = () => {
      void refresh();
    };
    window.addEventListener('openlearn:segment-gate-changed', onRefresh);
    const unsubQuiz = frontendEventBus.subscribe('QuizSubmitted', onRefresh);
    const unsubAssignment = frontendEventBus.subscribe('assignment.submitted', onRefresh);
    return () => {
      window.removeEventListener('openlearn:segment-gate-changed', onRefresh);
      unsubQuiz();
      unsubAssignment();
    };
  }, [refresh]);

  useEffect(() => {
    if (state.status !== 'locked' || !lessonId || !targetSegmentId) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [state.status, lessonId, targetSegmentId, refresh]);

  return state;
}
