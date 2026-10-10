import React from 'react';
import { Sparkles, Radio } from 'lucide-react';
import type { ClassroomStageDisplayTickerSlotProps } from '../../../plugin-host/types';

export function SmartEduStageTicker({ lessonTitle }: ClassroomStageDisplayTickerSlotProps) {
  return (
    <div className="w-full bg-slate-950/80 backdrop-blur-md border-t border-amber-500/20 px-4 py-1.5 flex items-center justify-between text-xs text-slate-300">
      <div className="flex items-center space-x-2">
        <span className="flex items-center gap-1 text-amber-400 font-bold text-[11px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
          <Radio className="w-3 h-3 animate-pulse text-amber-400" />
          国家教育云·大屏示范广播
        </span>
        <span className="text-slate-400 text-xs truncate max-w-xl">
          正在执教：{lessonTitle || '新课标教学示范课'} · 同步连接国家中小学智慧教育平台教研专区
        </span>
      </div>

      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
        <span>smartedu.cn</span>
        <span className="text-emerald-400">● 连通正常</span>
      </div>
    </div>
  );
}
