import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  Zap,
  Bell,
  Timer,
  Tv,
  Activity,
  Lightbulb,
  HelpCircle,
  MessageSquare,
  Trophy,
  Shuffle,
  Award,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { StageDisplayModal } from '../StageDisplayModal';
import { ClassroomAttributionModal } from '../ClassroomAttributionModal';
import { ClassroomLeaderboardModal } from '../ClassroomLeaderboardModal';

export interface ClassroomWorkflowSubHeaderProps {
  currentStage: string;
  onStageChange: (stage: string) => void;
  lang?: 'zh' | 'en';
  lessonId?: string | null;
  lessonTitle?: string;
  classId?: string | null;
  className?: string;
  students?: any[];
  pollSubmissionsCount?: number;
  buzzerReadyCount?: number;
  countdownSeconds?: number;
  focusRate?: number;
  doubtCount?: number;
  interactionCount?: number;
  onOpenPoll?: () => void;
  onOpenBuzzer?: () => void;
  onOpenCountdownChallenge?: () => void;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomWorkflowSubHeader({
  currentStage = 'IN_CLASS_TEACHING',
  onStageChange,
  lang = 'zh',
  lessonId,
  lessonTitle,
  classId,
  className,
  students = [],
  pollSubmissionsCount = 24,
  buzzerReadyCount = 2,
  countdownSeconds = 60,
  focusRate = 94,
  doubtCount = 2,
  interactionCount = 28,
  onOpenPoll,
  onOpenBuzzer,
  onOpenCountdownChallenge,
  addToast,
}: ClassroomWorkflowSubHeaderProps) {
  const [isStageDisplayOpen, setIsStageDisplayOpen] = useState(false);
  const [isAttributionOpen, setIsAttributionOpen] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);

  // Workflow Stages configuration (Stitch Screen 1219a481)
  const stages = [
    { key: 'PRE_CLASS_READY', index: 1, label: lang === 'zh' ? '1. 课前就绪' : '1. Pre-Class' },
    { key: 'IN_CLASS_TEACHING', index: 2, label: lang === 'zh' ? '2. 课中授课' : '2. Teaching' },
    { key: 'WRAP_UP_EXIT_TICKET', index: 3, label: lang === 'zh' ? '3. 结课巡查' : '3. Wrap-up' },
    { key: 'ARCHIVED_REPORT', index: 4, label: lang === 'zh' ? '4. 学情简报' : '4. Report' },
  ];

  const currentStageIndex = stages.find((s) => s.key === currentStage)?.index || 2;

  const handleStageClick = (targetStage: string) => {
    if (targetStage === currentStage) return;
    onStageChange(targetStage);
    addToast?.(
      lang === 'zh' ? '课堂环节已切换' : 'Stage Transitioned',
      lang === 'zh' ? `已切换至【${stages.find((s) => s.key === targetStage)?.label}】` : `Switched to ${targetStage}`,
      'info',
    );
  };

  return (
    <>
      <section
        className="bg-surface border-b border-border/80 px-4 h-10 flex items-center justify-between shrink-0 z-20 select-none shadow-3xs"
        data-purpose="lesson-workflow-toolbar"
      >
        {/* ── Left: Lesson Stages Stepper (Stitch Screen 1219a481) ── */}
        <div className="flex items-center gap-1.5 overflow-hidden shrink-0" data-purpose="lesson-stages-stepper">
          {stages.map((stage, idx) => {
            const isCompleted = stage.index < currentStageIndex;
            const isActive = stage.key === currentStage;

            return (
              <React.Fragment key={stage.key}>
                {idx > 0 && <ChevronRight size={12} className="text-border shrink-0" />}
                <button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white font-bold shadow-xs ring-2 ring-indigo-200 dark:ring-indigo-900/60'
                      : isCompleted
                        ? 'bg-surface-secondary hover:bg-surface text-foreground font-medium'
                        : 'text-muted hover:bg-surface-secondary font-medium'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                      isActive
                        ? 'bg-white text-indigo-600'
                        : isCompleted
                          ? 'bg-emerald-500 text-white'
                          : 'bg-surface-secondary text-muted border border-border'
                    }`}
                  >
                    {isCompleted ? <Check size={9} className="stroke-[3]" /> : stage.index}
                  </span>
                  <span>{stage.label}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Right: Quick Actions Matrix & Classroom Rhythm Barometer ── */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Quick Actions Bar (Stitch Screen 1219a481) */}
          <div className="flex items-center gap-1.5 bg-surface-secondary/70 border border-border p-0.5 rounded-lg" data-purpose="quick-actions-bar">
            {/* Quick Poll */}
            <div className="relative group">
              <button
                type="button"
                onClick={onOpenPoll}
                className="w-7 h-7 rounded-md bg-surface border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer relative"
                title={lang === 'zh' ? `极速投票 (${pollSubmissionsCount}人已投)` : 'Quick Poll'}
              >
                <Zap size={14} />
                {pollSubmissionsCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 min-w-3.5 h-3.5 bg-amber-500 text-white font-mono text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {pollSubmissionsCount}
                  </span>
                )}
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? `极速单选投票 (${pollSubmissionsCount}人已投)` : 'Quick Poll'}
                </div>
              </div>
            </div>

            {/* Quick Buzzer */}
            <div className="relative group">
              <button
                type="button"
                onClick={onOpenBuzzer}
                className="w-7 h-7 rounded-md bg-surface border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer relative"
                title={lang === 'zh' ? `随堂抢答 (${buzzerReadyCount}人就绪)` : 'Class Buzzer'}
              >
                <Bell size={14} />
                {buzzerReadyCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 min-w-3.5 h-3.5 bg-rose-500 text-white font-mono text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs animate-pulse">
                    {buzzerReadyCount}
                  </span>
                )}
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? `发起毫秒级抢答 (${buzzerReadyCount}人就绪)` : 'Buzzer'}
                </div>
              </div>
            </div>

            {/* 60s Challenge */}
            <div className="relative group">
              <button
                type="button"
                onClick={onOpenCountdownChallenge}
                className="w-7 h-7 rounded-md bg-surface border border-sky-200 dark:border-sky-800 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer relative"
                title={lang === 'zh' ? '60s 限时互动冲刺' : '60s Challenge'}
              >
                <Timer size={14} />
                <span className="absolute -top-1 -right-1 px-1 min-w-3.5 h-3.5 bg-sky-600 text-white font-mono text-[8px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {countdownSeconds}s
                </span>
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? '60s 限时解题挑战' : '60s Timed Challenge'}
                </div>
              </div>
            </div>

            {/* Stage Display Projector */}
            <div className="relative group">
              <button
                type="button"
                onClick={() => setIsStageDisplayOpen(true)}
                className="w-7 h-7 rounded-md bg-surface border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer"
                title={lang === 'zh' ? '打开大屏幕台 (双屏广播)' : 'Projector Stage View'}
              >
                <Tv size={14} />
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? '多媒体大屏教学展台 (高对比度双屏模式)' : 'Projector Display'}
                </div>
              </div>
            </div>

            {/* Roll Call & Attribution Award Modal */}
            <div className="relative group">
              <button
                type="button"
                onClick={() => setIsAttributionOpen(true)}
                className="w-7 h-7 rounded-md bg-surface border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer"
                title={lang === 'zh' ? '随机抽问与表现激励' : 'Attribution Roll Call'}
              >
                <Shuffle size={13} />
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? '随机抽选与多维归因表彰' : 'Roll Call & Attribution'}
                </div>
              </div>
            </div>

            {/* Class Leaderboard Modal */}
            <div className="relative group">
              <button
                type="button"
                onClick={() => setIsLeaderboardOpen(true)}
                className="w-7 h-7 rounded-md bg-surface border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center justify-center shadow-3xs transition cursor-pointer"
                title={lang === 'zh' ? '班级积分榜与小组联赛' : 'Class Leaderboard'}
              >
                <Trophy size={13} />
              </button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? '小组联赛与个人英雄榜' : 'Leaderboard'}
                </div>
              </div>
            </div>

            {/* Third-Party Plugin Quick Activity Slot */}
            <ExtensionPointRenderer slot="classroom.quick_activity" />
          </div>

          <div className="h-4 w-px bg-border" />

          {/* Classroom Rhythm Barometer (晴雨表 - Stitch Screen 1219a481) */}
          <div
            className="flex items-center gap-1.5 bg-surface-secondary/70 border border-border px-2 py-0.5 rounded-lg text-xs shrink-0 shadow-3xs"
            data-purpose="classroom-rhythm-barometer"
          >
            <span className="text-muted font-medium text-[11px] flex items-center gap-1">
              <Activity size={12} className="text-indigo-500" />
              <span>{lang === 'zh' ? '晴雨表:' : 'Rhythm:'}</span>
            </span>

            {/* Metric 1: Focus Rate */}
            <div className="relative group cursor-help">
              <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded text-[11px] font-bold">
                <Lightbulb size={11} className="text-emerald-500 fill-emerald-500" />
                <span>{focusRate}%</span>
              </span>
              <div className="absolute right-0 top-full mt-1.5 z-40 hidden group-hover:flex flex-col pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? `当前注意力集中率良好 (${focusRate}%)` : `Attention Focus Rate: ${focusRate}%`}
                </div>
              </div>
            </div>

            {/* Metric 2: Doubt / Explanation Requests */}
            <div className="relative group cursor-help">
              <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.2 rounded text-[11px] font-bold">
                <HelpCircle size={11} className="text-amber-500 fill-amber-500/20" />
                <span>{doubtCount}</span>
              </span>
              <div className="absolute right-0 top-full mt-1.5 z-40 hidden group-hover:flex flex-col pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? `${doubtCount}位学生反馈需要讲解` : `${doubtCount} students requested help`}
                </div>
              </div>
            </div>

            {/* Metric 3: Classroom Interactions */}
            <div className="relative group cursor-help">
              <span className="inline-flex items-center gap-0.5 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0.2 rounded text-[11px] font-bold">
                <MessageSquare size={11} className="text-indigo-500 fill-indigo-500/20" />
                <span>{interactionCount}</span>
              </span>
              <div className="absolute right-0 top-full mt-1.5 z-40 hidden group-hover:flex flex-col pointer-events-none">
                <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                  {lang === 'zh' ? `全班互动提交累计 ${interactionCount} 次` : `${interactionCount} student submissions`}
                </div>
              </div>
            </div>

            {/* Third-Party Plugin Barometer Metric Slot */}
            <ExtensionPointRenderer slot="classroom.barometer.metric" />
          </div>
        </div>
      </section>

      {/* ── Sub-Modals ── */}
      {isStageDisplayOpen && (
        <StageDisplayModal
          isOpen={isStageDisplayOpen}
          onClose={() => setIsStageDisplayOpen(false)}
          lessonId={lessonId || ''}
          lessonTitle={lessonTitle}
          lang={lang}
        />
      )}

      {isAttributionOpen && (
        <ClassroomAttributionModal
          isOpen={isAttributionOpen}
          onClose={() => setIsAttributionOpen(false)}
          lessonId={lessonId}
          classId={classId}
          students={students}
          lang={lang}
          addToast={addToast}
        />
      )}

      {isLeaderboardOpen && (
        <ClassroomLeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={() => setIsLeaderboardOpen(false)}
          lessonId={lessonId}
          classId={classId}
          students={students}
          lang={lang}
          addToast={addToast}
        />
      )}
    </>
  );
}
