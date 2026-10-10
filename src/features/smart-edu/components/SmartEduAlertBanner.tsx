import React, { useState } from 'react';
import { ShieldCheck, X, Wifi } from 'lucide-react';
import type { ClassroomAlertBannerSlotProps } from '../../../plugin-host/types';

export function SmartEduAlertBanner({ lessonId }: ClassroomAlertBannerSlotProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="w-full bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 px-4 py-1.5 text-xs flex items-center justify-between text-amber-200">
      <div className="flex items-center space-x-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold text-amber-300">国家智慧教育公共服务平台</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-300">
          双师课堂数据通道已连通，授课学情与探究轨迹自动遵从 CELTS-3 规范离线暂存并同步
        </span>
      </div>

      <div className="flex items-center space-x-3 text-[11px]">
        <span className="text-emerald-400 flex items-center gap-1 font-mono">
          <Wifi className="w-3 h-3" /> 延迟: 16ms
        </span>
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
