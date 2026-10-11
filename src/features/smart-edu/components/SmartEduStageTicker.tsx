import React from 'react';
import { Radio } from 'lucide-react';
import type { ClassroomStageDisplayTickerSlotProps } from '../../../plugin-host/types';

/**
 * 大屏展台跑马灯。仅播报本堂课程信息，不做任何连通性断言——
 * 展台是全班可见的最高置信度界面，虚构“连通正常”会误导整个班级
 * （v0.6.0 审计 R-5/N-4：此前恒显“● 连通正常”）。
 */
export function SmartEduStageTicker({ lessonTitle, lang }: ClassroomStageDisplayTickerSlotProps) {
  const zh = lang !== 'en';
  return (
    <div className="w-full bg-slate-950/80 backdrop-blur-md border-t border-amber-500/20 px-4 py-1.5 flex items-center justify-between text-xs text-slate-300">
      <div className="flex items-center space-x-2">
        <span className="flex items-center gap-1 text-amber-400 font-bold text-[11px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
          <Radio className="w-3 h-3 animate-pulse text-amber-400" />
          {zh ? '国家教育云·大屏示范广播' : 'National Cloud · Stage Broadcast'}
        </span>
        <span className="text-slate-400 text-xs truncate max-w-xl">
          {zh ? '正在执教：' : 'Now teaching: '}
          {lessonTitle || (zh ? '新课标教学示范课' : 'New curriculum demo lesson')}
        </span>
      </div>

      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
        <span>smartedu.cn</span>
      </div>
    </div>
  );
}
