import React from 'react';
import {
  Trophy,
  Award,
  BookOpen,
  Mic,
  Cast,
  ArrowRight,
  Sparkles,
  CheckCircle,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { NominatedStudent } from './types';

export interface PeerReviewLeaderboardPanelProps {
  podiumStudents: NominatedStudent[];
  isAnonymous?: boolean;
  onAwardPeerReviewPoints: () => void;
  onArchiveTopWorks: () => void;
  onCallStudentMic: (studentName: string) => void;
  onInviteScreenShare: (studentName: string) => void;
  onAdvanceToStage3: () => void;
}

export const PeerReviewLeaderboardPanel: React.FC<PeerReviewLeaderboardPanelProps> = ({
  podiumStudents,
  isAnonymous = false,
  onAwardPeerReviewPoints,
  onArchiveTopWorks,
  onCallStudentMic,
  onInviteScreenShare,
  onAdvanceToStage3,
}) => {
  const maskName = (name: string, isAnon: boolean) => {
    if (!isAnon) return name;
    if (name.length <= 1) return name;
    return `${name[0]}**`;
  };

  return (
    <div
      id="peer-review-leaderboard-panel"
      className="flex flex-col gap-4 w-full select-none"
    >
      {/* 1. Top Nominated Podium */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-3 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-[#ffb95f]" />
            <h2 className="text-sm font-semibold text-[#dae2fd]">互评推荐先锋榜</h2>
          </div>
          <span className="text-[10px] font-mono text-[#908fa0] font-semibold">TOP NOMINATED</span>
        </div>

        <div className="flex flex-col gap-2.5">
          {podiumStudents.map((st) => (
            <div
              key={st.rank}
              className={`p-3 rounded-lg border transition-all ${
                st.rank === 1
                  ? 'bg-[#222a3d] border-[#ffb95f]/40 shadow-sm'
                  : 'bg-[#171f33] border-[#2d3449]/50 hover:bg-[#222a3d]'
              } flex flex-col gap-1.5`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 rounded-full font-mono text-[11px] font-bold flex items-center justify-center ${st.rankBadgeClass}`}
                  >
                    {st.rank}
                  </span>
                  <span className="text-xs font-semibold text-[#dae2fd]">
                    {maskName(st.name, isAnonymous)}
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-[#ffb95f]">
                  {st.votes} 票推荐
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#c7c4d7] truncate max-w-[140px]">{st.workTitle}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${st.tagBadgeClass}`}>
                  {st.honorTitle}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Instant Micro-Badge Dispatcher Box */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-3 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#dae2fd]">随堂微勋章即时分发箱</span>
          <Award size={15} className="text-[#4edea3]" />
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onAwardPeerReviewPoints}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449]/50 text-[#dae2fd] transition-colors text-xs text-left"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-[#ffb95f]" />
              <span>为全员互评认真学生 +2 积分</span>
            </span>
            <span className="font-mono text-[10px] text-[#4edea3] font-semibold bg-[#00a572]/20 px-1.5 py-0.5 rounded">
              一键发放
            </span>
          </button>

          <button
            type="button"
            onClick={onArchiveTopWorks}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449]/50 text-[#dae2fd] transition-colors text-xs text-left"
          >
            <span className="flex items-center gap-2">
              <BookOpen size={14} className="text-[#c0c1ff]" />
              <span>TOP 2 优秀代码入库数字馆</span>
            </span>
            <span className="font-mono text-[10px] text-[#c0c1ff] font-semibold bg-[#8083ff]/20 px-1.5 py-0.5 rounded">
              入库归档
            </span>
          </button>
        </div>
      </div>

      {/* 3. Teacher Quick Broadcast Control Deck */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-col gap-3 shadow-md">
        <span className="text-[10px] font-mono text-[#908fa0] font-semibold">
          TEACHER BROADCAST &amp; STAGE TRANSITION
        </span>

        {/*
          快捷连线/投屏 —— 目标来自**真实提名榜**（podiumStudents，按真实票数排序）。
          此前硬编码「陈子墨 / 张子豪」，导致任何班级、任何课节都出现同一对姓名。
          无真实提名数据时按钮禁用并说明原因。
        */}
        <div className="flex flex-col gap-2">
          {(() => {
            const top = podiumStudents[0]?.name;
            const second = podiumStudents[1]?.name ?? top;
            return (
              <>
                <button
                  type="button"
                  disabled={!top}
                  onClick={() => top && onCallStudentMic(top)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449]/50 text-[#dae2fd] transition-colors text-xs text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <Mic size={14} className="text-[#c0c1ff]" />
                    <span>
                      {top ? `连麦作者 ${maskName(top, isAnonymous)} (分享思路)` : '暂无提名，无法连麦'}
                    </span>
                  </span>
                  <span className="text-[#908fa0] text-[10px] font-mono">连线</span>
                </button>

                <button
                  type="button"
                  disabled={!second}
                  onClick={() => second && onInviteScreenShare(second)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449]/50 text-[#dae2fd] transition-colors text-xs text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <Cast size={14} className="text-[#4edea3]" />
                    <span>
                      {second ? `邀请 ${maskName(second, isAnonymous)} 投屏分享` : '暂无提名，无法投屏'}
                    </span>
                  </span>
                  <span className="text-[#908fa0] text-[10px] font-mono">邀请</span>
                </button>
              </>
            );
          })()}
        </div>

        {/* Third-Party Actions Slot */}
        <ExtensionPointRenderer slot="peer_review.action" />

        {/* High-Impact Primary Proceed Action Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onAdvanceToStage3}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#c0c1ff] text-[#1000a9] hover:bg-[#8083ff] hover:text-white transition-all shadow-md group font-semibold text-xs text-center"
          >
            <span>结束互评，公布全堂总积分榜与学情报告</span>
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <div className="text-center mt-2">
            <span className="text-[10px] font-mono text-[#908fa0]">
              HOTKEY: PRESS ENTER TO ADVANCE TO STAGE 03
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
