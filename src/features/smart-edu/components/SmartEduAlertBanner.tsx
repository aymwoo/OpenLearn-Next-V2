import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { ClassroomAlertBannerSlotProps } from '../../../plugin-host/types';
import { useSmartEduStatus } from '../useSmartEduStatus';

/**
 * 课堂中控国家平台双师通道横幅。
 *
 * 只在网关真实可达时渲染；未配置或探测失败一律不渲染——
 * 课堂大屏/中控绝不展示虚构的“已连通”（v0.6.0 审计 R-5）。
 */
export function SmartEduAlertBanner({ lessonId }: ClassroomAlertBannerSlotProps) {
  const [dismissed, setDismissed] = useState(false);
  const { status, loading } = useSmartEduStatus(120_000);

  if (dismissed || loading) return null;
  if (!status?.configured || !status.connected) return null;

  return (
    <div className="w-full bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 px-4 py-1.5 text-xs flex items-center justify-between text-amber-200">
      <div className="flex items-center space-x-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold text-amber-300">国家智慧教育公共服务平台</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-300">
          双师课堂数据通道已连通{lessonId ? `（课程 ${lessonId} 的学情归档将遵从 CELTS-3 规范）` : ''}
        </span>
      </div>

      <div className="flex items-center space-x-3 text-[11px]">
        {status.rttMs != null && (
          <span className="text-emerald-400 flex items-center gap-1 font-mono">{Math.round(status.rttMs)}ms</span>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="text-slate-400 hover:text-white p-0.5"
          title="收起通知"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
