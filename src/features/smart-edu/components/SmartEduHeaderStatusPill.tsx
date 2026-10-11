import React, { useState } from 'react';
import { ShieldCheck, X, RefreshCw } from 'lucide-react';
import type { HeaderStatusPillSlotProps } from '../../../plugin-host/types';
import { useSmartEduStatus } from '../useSmartEduStatus';

/**
 * 顶栏国家平台连通胶囊 —— 诚实三态：
 * 未配置（灰） / 在线（绿 + 真实 rtt） / 离线或异常（红 + 原因）。
 * 故障态绝不渲染为健康态（v0.6.0 审计 R-5：此前 fetch 失败被吞、恒显“已连通”）。
 */
export function SmartEduHeaderStatusPill({ lang = 'zh' }: HeaderStatusPillSlotProps) {
  const [open, setOpen] = useState(false);
  const { status, loading, refetch } = useSmartEduStatus(60_000);

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const zh = lang === 'zh';

  const dotClass = !configured
    ? 'bg-slate-400'
    : connected
      ? 'bg-emerald-400 animate-pulse'
      : 'bg-rose-500';
  const stateText = loading
    ? zh
      ? '检测中'
      : 'Checking'
    : !configured
      ? zh
        ? '未配置'
        : 'Not configured'
      : connected
        ? zh
          ? '已连通'
          : 'Connected'
        : zh
          ? '连接异常'
          : 'Offline';

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={() => setOpen(!open)}
        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1.5 transition"
        title={zh ? '国家智慧教育公共服务平台数据网关状态' : 'National smart education gateway status'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="font-semibold">国家云</span>
        <span className={connected ? 'text-emerald-400/90' : 'text-slate-400/80'}>{stateText}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-amber-500/30 rounded-xl shadow-xl p-3 z-50 text-xs animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
            <span className="font-bold text-white flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              国家智慧教育平台网关
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!configured ? (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              尚未配置国家平台网关。请在服务端环境变量 <code className="text-amber-300">SMARTEDU_API_BASE</code>{' '}
              中填写平台数据网关地址后重启服务。
            </p>
          ) : (
            <div className="space-y-1.5 text-slate-300 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">网关地址：</span>
                <span className="font-mono text-white truncate max-w-[10rem]" title={status?.endpoint}>
                  {status?.endpoint || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">往返延迟：</span>
                <span className={connected ? 'text-emerald-400 font-mono font-semibold' : 'text-slate-500 font-mono'}>
                  {connected && status?.rttMs != null ? `${Math.round(status.rttMs)} ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">已同步课程：</span>
                <span className="text-amber-300 font-semibold">{status?.syncedCoursesCount ?? 0} 门</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">最近心跳：</span>
                <span className="font-mono text-slate-300">
                  {status?.lastHeartbeat ? new Date(status.lastHeartbeat).toLocaleTimeString() : '—'}
                </span>
              </div>
              {!connected && status?.error && <p className="text-rose-400 pt-1">{status.error}</p>}
              <button
                onClick={() => void refetch()}
                className="mt-1 w-full py-1 text-[11px] text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 rounded-md flex items-center justify-center gap-1 transition"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {zh ? '重新探测' : 'Re-probe'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
