import React from 'react';
import { ShieldCheck, Cloud, CheckCircle, Database } from 'lucide-react';
import type { AdminDashboardCardSlotProps } from '../../../plugin-host/types';

export function SmartEduAdminCard({ siteInfo }: AdminDashboardCardSlotProps) {
  return (
    <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
      <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">国家智慧教育公共服务平台 · 接入看板</h4>
            <p className="text-[11px] text-slate-400">教育部教育信息化行业标准数据交换通道</p>
          </div>
        </div>

        <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          已直连 (双向同步)
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div className="text-[11px] text-slate-400">示范课引流</div>
          <div className="text-lg font-bold text-amber-400 mt-1">3 门</div>
          <div className="text-[10px] text-slate-500 mt-0.5">普通高中新课标精品库</div>
        </div>
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div className="text-[11px] text-slate-400">通道合规率</div>
          <div className="text-lg font-bold text-emerald-400 mt-1">100%</div>
          <div className="text-[10px] text-slate-500 mt-0.5">CELTS-3 数据格式校验</div>
        </div>
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div className="text-[11px] text-slate-400">网络往返</div>
          <div className="text-lg font-bold text-cyan-400 mt-1">16 ms</div>
          <div className="text-[10px] text-slate-500 mt-0.5">骨干专网低延迟通道</div>
        </div>
      </div>
    </div>
  );
}
