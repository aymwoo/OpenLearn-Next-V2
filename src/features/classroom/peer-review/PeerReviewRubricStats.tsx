import React from 'react';
import { Wifi, Heart, Lightbulb, Compass, Plus } from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { RubricDimensionItem } from './types';

export interface ReactionCountItem {
  id: string;
  emoji: string;
  label: string;
  count: number;
  colorClass: string;
}

export interface PeerReviewRubricStatsProps {
  dimensions: RubricDimensionItem[];
  averagePercentage: number;
  reactions: ReactionCountItem[];
  onReactionClick?: (reactionId: string) => void;
  syncedStudentsCount?: number;
}

export const PeerReviewRubricStats: React.FC<PeerReviewRubricStatsProps> = ({
  dimensions,
  averagePercentage,
  reactions,
  onReactionClick,
  syncedStudentsCount = 32,
}) => {
  return (
    <div
      id="peer-review-rubric-stats"
      className="bg-[#131b2e] rounded-xl p-4 flex flex-col gap-4 border border-[#2d3449]/60 shadow-md select-none w-full"
    >
      {/* 1. Rubric Stats Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#dae2fd]">全班三维量规综合达标率</span>
        <span className="text-[11px] font-mono text-[#4edea3] font-semibold">
          AVERAGE: {averagePercentage.toFixed(1)}%
        </span>
      </div>

      {/* 2. Dimensions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {dimensions.map((dim) => (
          <div
            key={dim.id}
            className="bg-[#171f33] p-2.5 rounded-lg flex flex-col gap-1.5 border border-[#2d3449]/50"
          >
            <div className="flex justify-between text-xs">
              <span className="text-[#908fa0] truncate">{dim.label}</span>
              <span className={`font-mono font-medium ${dim.colorClass}`}>
                {dim.percentage}%
              </span>
            </div>
            <div className="w-full bg-[#2d3449] h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${dim.barColorClass}`}
                style={{ width: `${dim.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Third-Party Custom Rubric Dimension Slot */}
      <ExtensionPointRenderer slot="peer_review.rubric.dimension" />

      {/* 3. Live Reaction Dynamic Ticker Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#2d3449]/40">
        <div className="flex items-center gap-2">
          {reactions.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onReactionClick?.(r.id)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449]/60 transition-all text-xs text-[#dae2fd] active:scale-95 group"
            >
              <span>{r.emoji}</span>
              <span className="font-medium group-hover:text-white">{r.label}</span>
              <span className={`font-mono font-semibold ${r.colorClass}`}>
                +{r.count}
              </span>
            </button>
          ))}
        </div>

        <span className="text-[10px] font-mono text-[#908fa0] flex items-center gap-1">
          <Wifi size={13} className="text-[#4edea3]" />
          {syncedStudentsCount}台学生端已同步点赞动画
        </span>
      </div>
    </div>
  );
};
