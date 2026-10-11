/**
 * useSmartEduStatus — 国家平台网关状态的唯一取数口径。
 *
 * 所有需要展示连通状态的 smart-edu 组件（顶栏胶囊 / 课堂横幅 / 管理看板）
 * 统一经此 Hook 取数，避免各组件重复实现 fetch 与各自编造缺省值
 * （v0.6.0 审计 R-5/N-2：此前 `.catch(() => {})` 吞错后按假数据渲染“已连通”）。
 *
 * 状态语义（诚实三态，禁止把故障渲染为健康）：
 * - configured=false → 未配置（灰）
 * - connected=true   → 在线（绿，展示真实 rtt）
 * - 其余             → 离线/异常（红，展示 error）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SmartEduStatus } from './types';

const EMPTY: SmartEduStatus = { success: true, configured: false, connected: false };

export function useSmartEduStatus(pollMs = 0) {
  const [status, setStatus] = useState<SmartEduStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const latestReq = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++latestReq.current;
    try {
      const res = await fetch('/api/external/smart-edu/status');
      const data = (await res.json()) as SmartEduStatus & { success?: boolean };
      if (seq !== latestReq.current) return; // 过期响应不覆盖新状态
      setStatus(data.success ? data : { ...EMPTY, error: data.error });
    } catch {
      if (seq !== latestReq.current) return;
      setStatus({ ...EMPTY, configured: true, connected: false, error: '网络异常，无法查询网关状态' });
    } finally {
      if (seq === latestReq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    if (!pollMs) return;
    const timer = setInterval(() => void refetch(), pollMs);
    return () => clearInterval(timer);
  }, [refetch, pollMs]);

  return { status, loading, refetch };
}
