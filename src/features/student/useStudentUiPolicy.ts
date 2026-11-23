/**
 * 学生首屏界面可见性策略（Gitee Issue IKW5KV）。
 *
 * 进入/离开课堂立即重拉，标签页重新可见或窗口聚焦时刷新，并做 60s 轻量轮询，
 * 让教师调整能在不打断学生操作的前提下接近实时生效。请求失败时保留上一次
 * 成功结果（首次失败回退到“全部可见”），不因策略接口故障导致首屏空白。
 */
import { useEffect, useState } from 'react';
import {
  normalizeEffectiveStudentUiPolicy,
  type EffectiveStudentUiPolicy,
} from '../../../packages/core/student-ui-policy/index';
import { getStudentUiPolicy } from '../../services/studentUiPolicyService';

const DEFAULT_POLICY = normalizeEffectiveStudentUiPolicy(null);

export function useStudentUiPolicy(
  studentId: string | null | undefined,
  lessonId: string | null | undefined,
  intervalMs = 60_000,
): EffectiveStudentUiPolicy {
  const [policy, setPolicy] = useState<EffectiveStudentUiPolicy>(DEFAULT_POLICY);

  useEffect(() => {
    if (!studentId) {
      setPolicy(DEFAULT_POLICY);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const { ok, data } = await getStudentUiPolicy(studentId, lessonId);
        if (!ok || cancelled) return;
        setPolicy(normalizeEffectiveStudentUiPolicy(data?.policy ?? data));
      } catch {
        // 网络异常时保留上一次成功策略，下次轮询自愈
      }
    };

    void load();
    const timer = setInterval(() => void load(), intervalMs);
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [studentId, lessonId, intervalMs]);

  return policy;
}
