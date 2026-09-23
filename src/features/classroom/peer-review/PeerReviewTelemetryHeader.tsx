import React from 'react';
import {
  ChevronRight,
  Cast,
  Timer,
  Heart,
  FileCheck2,
  Mic2,
  Award,
  Maximize2,
  Minimize2,
  X,
  Play,
  Pause,
  PlusCircle,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { PeerReviewState } from './types';

export interface PeerReviewTelemetryHeaderProps {
  state: PeerReviewState;
  onToggleAnonymous: () => void;
  onOpenRubricModal: () => void;
  onToggleVoiceDanmaku: () => void;
  onAdvanceStage: () => void;
  onAddMinute?: () => void;
  onTogglePauseTimer?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onClose?: () => void;
}

export const PeerReviewTelemetryHeader: React.FC<PeerReviewTelemetryHeaderProps> = ({
  state,
  onToggleAnonymous,
  onOpenRubricModal,
  onToggleVoiceDanmaku,
  onAdvanceStage,
  onAddMinute,
  onTogglePauseTimer,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.max(0, seconds) % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const progressPercent = Math.round((state.completedReviews / Math.max(1, state.totalStudents)) * 100);

  return (
    <div
      id="peer-review-telemetry-header"
      className="w-full bg-[#131b2e] border-b border-[#2d3449] px-6 py-3 flex flex-wrap items-center justify-between gap-4 select-none shrink-0"
    >
      {/* 1. Left Breadcrumb & Stage Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#171f33] text-[#908fa0] text-[10px] font-mono font-semibold tracking-wider">
            STAGE 02.4
          </span>
          <div className="flex items-center gap-1.5 text-xs text-[#c7c4d7]">
            <span>随堂巩固</span>
            <ChevronRight size={13} className="text-[#908fa0]" />
            <span>收卷归档</span>
            <ChevronRight size={13} className="text-[#908fa0]" />
            <span className="text-[#4edea3] font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-ping" />
              全班大屏协同互评阶段 {state.isLocked && '(已锁定全班终端)'}
            </span>
          </div>
        </div>

        <div className="h-4 w-[1px] bg-[#2d3449] hidden md:block" />

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#00a572]/20 text-[#4edea3] text-xs font-medium border border-[#00a572]/30">
          <Cast size={14} className="text-[#4edea3]" />
          <span>教室主大屏协同输出 {state.isDualScreen ? '(4K 双屏模式)' : '(投影模式)'}</span>
        </div>
      </div>

      {/* 2. Middle Live Telemetry KPI Metrics */}
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Countdown */}
        <div className="flex items-center gap-2 bg-[#060e20] px-3 py-1.5 rounded-xl border border-[#2d3449]/60">
          <Timer size={18} className="text-[#ffb95f] animate-pulse" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-[#908fa0] leading-none">COUNTDOWN</span>
              {onAddMinute && (
                <button
                  type="button"
                  onClick={onAddMinute}
                  className="text-[10px] text-[#ffb95f] hover:text-[#ffddb8] font-mono transition-colors"
                  title="加时 1 分钟"
                >
                  +1m
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-sm font-semibold font-mono text-[#dae2fd] leading-none">
                {formatTime(state.timeRemainingSeconds)}
                <span className="text-[#908fa0] text-xs font-normal"> / {formatTime(state.totalTimeSeconds)}</span>
              </span>
              {onTogglePauseTimer && (
                <button
                  type="button"
                  onClick={onTogglePauseTimer}
                  className="text-[#c7c4d7] hover:text-white transition-colors"
                  title={state.isPaused ? '恢复倒计时' : '暂停倒计时'}
                >
                  {state.isPaused ? <Play size={12} className="text-[#4edea3]" /> : <Pause size={12} />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Completion Progress Metric */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 flex items-center justify-center">
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-[#2d3449]"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
              />
              <path
                className="text-[#4edea3] transition-all duration-500"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeDasharray={`${progressPercent}, 100`}
                strokeLinecap="round"
                strokeWidth="3.5"
              />
            </svg>
            <span className="absolute text-[9px] font-mono text-[#dae2fd] font-semibold">{progressPercent}%</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-[#908fa0] leading-none">SUBMISSIONS</span>
            <span className="text-xs font-medium text-[#dae2fd] mt-0.5">
              {state.completedReviews} / {state.totalStudents} 人已评
            </span>
          </div>
        </div>

        {/* Engagement Reactions */}
        <div className="hidden lg:flex items-center gap-2 bg-[#171f33] px-3 py-1.5 rounded-xl border border-[#2d3449]/60">
          <Heart size={16} className="text-[#c0c1ff]" />
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-[#908fa0] leading-none">PEER REACTIONS</span>
            <span className="text-xs font-mono font-medium text-[#c0c1ff] mt-0.5">
              {state.totalLikes} 次点赞 · {state.totalNominations} 份提名
            </span>
          </div>
        </div>
      </div>

      {/* 3. Right Quick Action Deck */}
      <div className="flex items-center gap-2">
        {/* Toggle Anonymous Mode */}
        <label
          htmlFor="toggle-anon"
          className="flex items-center gap-2 cursor-pointer bg-[#171f33] px-2.5 py-1.5 rounded-xl hover:bg-[#222a3d] transition-colors border border-[#2d3449]/50"
          title="开启后隐藏学生真实姓名"
        >
          <input
            id="toggle-anon"
            type="checkbox"
            checked={state.isAnonymous}
            onChange={onToggleAnonymous}
            className="sr-only peer"
          />
          <div className="w-7 h-4 bg-[#2d3449] peer-checked:bg-[#4edea3] rounded-full relative transition-colors">
            <div
              className={`w-3 h-3 bg-white rounded-full absolute top-0.5 left-0.5 transition-transform ${
                state.isAnonymous ? 'translate-x-3' : ''
              }`}
            />
          </div>
          <span className="text-xs text-[#c7c4d7] font-medium">双盲匿名</span>
        </label>

        {/* Rubric Preview Button */}
        <button
          type="button"
          onClick={onOpenRubricModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#171f33] hover:bg-[#222a3d] text-[#c7c4d7] hover:text-[#dae2fd] transition-colors text-xs font-medium border border-[#2d3449]/50"
        >
          <FileCheck2 size={15} className="text-[#ffb95f]" />
          <span>互评量规</span>
        </button>

        {/* Voice / Danmaku Toggle Button */}
        <button
          type="button"
          onClick={onToggleVoiceDanmaku}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors text-xs font-medium border ${
            state.showDanmaku
              ? 'bg-[#00a572]/20 border-[#00a572]/40 text-[#4edea3]'
              : 'bg-[#171f33] border-[#2d3449]/50 text-[#c7c4d7] hover:text-[#dae2fd]'
          }`}
          title="开关大屏弹幕墙"
        >
          <Mic2 size={15} className="text-[#4edea3]" />
          <span>全员语音弹幕</span>
        </button>

        {/* End & Award Button */}
        <button
          type="button"
          onClick={onAdvanceStage}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#c0c1ff] text-[#1000a9] hover:bg-[#8083ff] hover:text-white transition-all shadow-sm text-xs font-semibold"
        >
          <Award size={15} />
          <span>揭晓勋章榜</span>
          <span className="font-mono text-[10px] bg-[#1000a9]/15 px-1 py-0.5 rounded leading-none">Enter</span>
        </button>

        {/* Third-Party Plugin Actions Slot */}
        <ExtensionPointRenderer slot="peer_review.action" />

        {/* Optional Fullscreen & Close */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="p-1.5 rounded-xl text-[#c7c4d7] hover:text-white hover:bg-[#222a3d] transition-colors ml-1"
            title={isFullscreen ? '退出全屏' : '全屏展示'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#ffb4ab] hover:text-white hover:bg-[#93000a]/50 transition-colors ml-1"
            title="关闭大屏互评"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
