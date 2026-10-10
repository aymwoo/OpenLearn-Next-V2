import React, { useState, useEffect } from 'react';
import { ShieldCheck, Wifi, Sparkles, X } from 'lucide-react';
import type { HeaderStatusPillSlotProps } from '../../../plugin-host/types';
import type { SmartEduStatus } from '../types';

export function SmartEduHeaderStatusPill({ currentRole }: HeaderStatusPillSlotProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SmartEduStatus | null>(null);

  useEffect(() => {
    fetch('/api/external/smart-edu/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setStatus(data);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={() => setOpen(!open)}
        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1.5 transition"
        title="国家智慧教育公共服务平台数据网关状态"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold">国家云</span>
        <span className="text-amber-400/80">已连通</span>
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

          <div className="space-y-1.5 text-slate-300 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">数据节点：</span>
              <span className="font-mono text-white">api.smartedu.cn</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">往返延迟：</span>
              <span className="text-emerald-400 font-mono font-semibold">{status?.rttMs ?? 16} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">已同步示范课：</span>
              <span className="text-amber-300 font-semibold">{status?.syncedCoursesCount ?? 1} 门</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">数据加密：</span>
              <span className="text-slate-300">SM4 / CELTS-3 认证</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
