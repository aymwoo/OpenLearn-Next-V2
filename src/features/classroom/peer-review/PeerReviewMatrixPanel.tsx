import React from 'react';
import {
  Shuffle,
  ArrowRight,
  Star,
  Activity,
  CheckCircle2,
  Sparkles,
  Lightbulb,
  Zap,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { PeerMatchingItem, LivePeerBadge } from './types';

export interface PeerReviewMatrixPanelProps {
  matchingItems: PeerMatchingItem[];
  badges: LivePeerBadge[];
  isAnonymous?: boolean;
  onSelectMatchingItem?: (item: PeerMatchingItem) => void;
}

export const PeerReviewMatrixPanel: React.FC<PeerReviewMatrixPanelProps> = ({
  matchingItems,
  badges,
  isAnonymous = false,
  onSelectMatchingItem,
}) => {
  const maskName = (name: string, isAnon: boolean) => {
    if (!isAnon) return name;
    if (name.length <= 1) return name;
    return `${name[0]}**`;
  };

  return (
    <div
      id="peer-review-matrix-panel"
      className="flex flex-col gap-4 w-full select-none"
    >
      {/* 1. Section Header: Smart Cross-Matching */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#c0c1ff]/15 flex items-center justify-center text-[#c0c1ff]">
              <Shuffle size={16} />
            </div>
            <h2 className="text-sm font-semibold text-[#dae2fd]">智能交叉互评</h2>
          </div>
          <span className="px-2 py-0.5 rounded bg-[#8083ff]/20 text-[#c0c1ff] font-mono text-[10px] font-semibold">
            1生评2份
          </span>
        </div>
        <p className="text-xs text-[#c7c4d7] leading-relaxed">
          分层对调机制：将满分逻辑范本与攻坚调试作业交叉分发，激发逆向审阅与自愈思考。
        </p>
      </div>

      {/* 2. Live Match Matrix Feed */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#908fa0] font-mono text-[10px] font-semibold">PEER MATCHING REALTIME</span>
          <span className="text-[#4edea3] font-mono text-[11px] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" /> 实时同步中
          </span>
        </div>

        <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-0.5">
          {matchingItems.map((item) => {
            const reviewerDisplay = maskName(item.reviewerName, isAnonymous);
            const targetDisplay = maskName(item.targetStudentName, isAnonymous);

            return (
              <div
                key={item.id}
                onClick={() => onSelectMatchingItem?.(item)}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  item.status === 'submitted'
                    ? 'bg-[#222a3d] border-[#4edea3]/40 shadow-sm'
                    : 'bg-[#171f33] border-[#2d3449]/60 hover:bg-[#222a3d] hover:border-[#464554]'
                }`}
              >
                {/* Top header row */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-[#ffb95f] font-semibold">{item.code}</span>
                    <span className="text-xs text-[#dae2fd] font-semibold truncate max-w-[130px]">
                      {reviewerDisplay} {item.reviewerGroup ? `(${item.reviewerGroup})` : ''}
                    </span>
                  </div>

                  {item.status === 'submitted' && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00a572]/20 text-[#4edea3]">
                      已提交评语
                    </span>
                  )}
                  {item.status === 'in_progress' && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#ca8100]/20 text-[#ffb95f] animate-pulse">
                      正在推导 (2/3)
                    </span>
                  )}
                  {item.status === 'completed' && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00a572]/20 text-[#4edea3] flex items-center gap-1">
                      <CheckCircle2 size={10} /> 已完成
                    </span>
                  )}
                  {item.status === 'improvement' && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#c0c1ff]/20 text-[#c0c1ff]">
                      提出改进建议 💡
                    </span>
                  )}
                </div>

                {/* Target work row */}
                <div className="flex items-center gap-1.5 text-xs text-[#c7c4d7] mb-1.5">
                  <ArrowRight size={12} className="text-[#908fa0] shrink-0" />
                  <span className="text-[#c0c1ff] font-medium truncate">
                    {targetDisplay} · {item.targetWorkTitle}
                  </span>
                </div>

                {/* Optional comment */}
                {item.comment && (
                  <div className="bg-[#060e20] p-2 rounded text-xs text-[#c7c4d7] italic border border-[#2d3449]/40 mb-1.5 leading-relaxed">
                    "{item.comment}"
                  </div>
                )}

                {/* Progress bar if in progress */}
                {item.progressPercent !== undefined && item.status === 'in_progress' && (
                  <div className="w-full bg-[#2d3449] h-1 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-[#ffb95f] h-full rounded-full transition-all duration-300"
                      style={{ width: `${item.progressPercent}%` }}
                    />
                  </div>
                )}

                {/* Score and stars if completed/submitted */}
                {item.stars !== undefined && (
                  <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-[#2d3449]/50">
                    <div className="flex text-[#ffb95f]">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={13}
                          className={i < item.stars! ? 'text-[#ffb95f] fill-[#ffb95f]' : 'text-[#464554]'}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-[#908fa0]">
                      {item.score?.toFixed(1) || '5.0'} / {item.maxScore || '5.0'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Realtime Student Interaction Badge Feed */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold text-[#908fa0]">LIVE PEER BADGE STREAM</span>
          <Activity size={14} className="text-[#908fa0]" />
        </div>

        <div className="flex flex-col gap-2 overflow-hidden">
          {badges.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-[#171f33] border border-[#2d3449]/50 text-xs text-[#dae2fd]"
            >
              <span className="text-sm shrink-0">{b.emoji}</span>
              <div className="truncate">
                <span className="text-[#4edea3] font-medium">{maskName(b.senderName, isAnonymous)}</span>
                <span className="text-[#c7c4d7] mx-1">为</span>
                <span className="text-[#c0c1ff] font-medium">{maskName(b.receiverName, isAnonymous)}</span>
                <span className="ml-1 px-1.5 py-0.5 bg-[#222a3d] rounded text-[10px] font-mono text-[#ffb95f]">
                  {b.badgeTitle}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Third-Party Plugin Badges Slot */}
        <ExtensionPointRenderer slot="peer_review.badge" />
      </div>
    </div>
  );
};
