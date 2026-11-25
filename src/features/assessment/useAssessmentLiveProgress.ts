/**
 * 教师端实时作答进度数据源。
 *
 * 两条通路并行，互为兜底：
 * 1. Socket.IO 下行信号 `assessment:progress_updated`：学生开始作答 / 自动保存 / 交卷 /
 *    监考事件发生时立即刷新（房间 `assessment-<assignmentId>` 仅教师与管理员可加入）。
 * 2. 自适应轮询：有学生作答中时 3 秒、否则 10 秒；标签页隐藏时暂停，回到前台立即补拉。
 *
 * 事件只携带定位信息，明细一律重新拉取快照，避免客户端与服务端各自维护聚合状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { assessmentApi, ApiError, type AssessmentProgressSnapshot } from './api';
import { onSocketInstance } from '../../services/socket-service';

export const ASSESSMENT_PROGRESS_EVENT = 'assessment:progress_updated';

export function useAssessmentLiveProgress(assignmentId: string) {
  const [snapshot, setSnapshot] = useState<AssessmentProgressSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const queued = useRef(false);

  const load = useCallback(
    async (silent = false): Promise<void> => {
      if (inFlight.current) {
        queued.current = true;
        return;
      }
      inFlight.current = true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await assessmentApi.getAssignmentProgress(assignmentId);
        if (!mounted.current) return;
        setSnapshot(data);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e: unknown) {
        if (!mounted.current) return;
        setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
        if (queued.current && mounted.current) {
          queued.current = false;
          void load(true);
        }
      }
    },
    [assignmentId],
  );

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const hasInProgress = snapshot?.students.some((student) => student.status === 'in_progress') ?? false;

  useEffect(() => {
    const intervalMs = hasInProgress ? 3000 : 10000;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load(true);
    }, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load, hasInProgress]);

  useEffect(() => {
    const room = `assessment-${assignmentId}`;
    let bound: Socket | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (data: { assignmentId?: string }) => {
      if (data?.assignmentId !== assignmentId) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void load(true);
      }, 300);
    };

    const bind = (socket: Socket) => {
      if (bound === socket) return;
      bound?.off(ASSESSMENT_PROGRESS_EVENT, handler);
      bound = socket;
      socket.emit('join-room', room);
      socket.on(ASSESSMENT_PROGRESS_EVENT, handler);
    };

    const offReady = onSocketInstance(bind);
    return () => {
      offReady();
      bound?.off(ASSESSMENT_PROGRESS_EVENT, handler);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [assignmentId, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { snapshot, loading, refreshing, error, updatedAt, refresh };
}
