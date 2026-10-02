import React from 'react';
import { EdgeLanStatusIndicator } from './ecosystem';
import { ClassroomCountdownWidget } from './ClassroomCountdownWidget';
import type { ClassroomSyncChannel } from '../../services/classroom-sync-channel';

export interface ClassroomToolbarQuickActionsProps {
  lang: 'zh' | 'en';
  onOpenDiagnosticCenter: () => void;
  onOpenMasteryPrediction: () => void;
  onOpenGroupCollab: () => void;
  onOpenShowcaseDiff: () => void;
  onOpenParentNotification: () => void;
  onOpenMacroRunner: () => void;
  onOpenHardwareSettings: () => void;
  selectedLesson: string | null;
  syncChannel: ClassroomSyncChannel | null;
  onlineStudentCount: number;
  onTimeRemainingChange: (timeRemaining: number, isRunning: boolean) => void;
}

export function ClassroomToolbarQuickActions({
  lang,
  onOpenDiagnosticCenter,
  onOpenMasteryPrediction,
  onOpenGroupCollab,
  onOpenShowcaseDiff,
  onOpenParentNotification,
  onOpenMacroRunner,
  onOpenHardwareSettings,
  selectedLesson,
  syncChannel,
  onlineStudentCount,
  onTimeRemainingChange,
}: ClassroomToolbarQuickActionsProps) {
  return (
    <div className="flex items-center gap-1.5 ml-auto border-l border-theme pl-2.5 shrink-0">
      <button
        onClick={onOpenDiagnosticCenter}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? '课堂异常告警中心' : 'Diagnostic Center'}
        aria-label={lang === 'zh' ? '课堂异常告警中心' : 'Diagnostic Center'}
      >
        ⚠️
      </button>
      <button
        onClick={onOpenMasteryPrediction}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? 'AI 实时学情预测' : 'AI Mastery Prediction'}
        aria-label={lang === 'zh' ? 'AI 实时学情预测' : 'AI Mastery Prediction'}
      >
        🧠
      </button>
      <button
        onClick={onOpenGroupCollab}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? '随堂小组协作与画廊互评展台 (Jigsaw & Gallery Walk)' : 'Group Collab & Gallery Walk'}
        aria-label={lang === 'zh' ? '随堂小组协作与画廊互评展台 (Jigsaw & Gallery Walk)' : 'Group Collab & Gallery Walk'}
      >
        👥
      </button>
      <button
        onClick={onOpenShowcaseDiff}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={
          lang === 'zh'
            ? '优秀作业 / 屏幕一键多屏对比投屏批注 (Showcase & Dual-Screen Diff)'
            : 'Showcase & Multi-Screen Diff'
        }
        aria-label={
          lang === 'zh'
            ? '优秀作业 / 屏幕一键多屏对比投屏批注 (Showcase & Dual-Screen Diff)'
            : 'Showcase & Multi-Screen Diff'
        }
      >
        🔍
      </button>
      <button
        onClick={onOpenParentNotification}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? '家校通知生成器（课中预生成可在下课期间直接复制）' : 'Parent Notification'}
        aria-label={lang === 'zh' ? '家校通知生成器（课中预生成可在下课期间直接复制）' : 'Parent Notification'}
      >
        ✉️
      </button>
      <button
        id="btn-open-classroom-macros"
        onClick={onOpenMacroRunner}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? '课堂宏动作编排中枢 (Classroom Action Macros)' : 'Action Macros'}
        aria-label={lang === 'zh' ? '课堂宏动作编排中枢 (Classroom Action Macros)' : 'Action Macros'}
      >
        ⚡
      </button>
      <button
        id="btn-open-hardware-bridge"
        onClick={onOpenHardwareSettings}
        className="w-7 h-7 sm:w-8 sm:h-8 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 transition-all flex items-center justify-center cursor-pointer shadow-2xs hover:scale-105 active:scale-95 shrink-0"
        title={lang === 'zh' ? '硬件教具生态标准化网关设置' : 'Hardware Bridge'}
        aria-label={lang === 'zh' ? '硬件教具生态标准化网关设置' : 'Hardware Bridge'}
      >
        🎛️
      </button>
      <EdgeLanStatusIndicator className="ml-1 shrink-0" />
      <ClassroomCountdownWidget
        variant="header"
        lessonId={selectedLesson}
        lang={lang}
        syncChannel={syncChannel}
        onlineStudentCount={onlineStudentCount}
        onTimeRemainingChange={onTimeRemainingChange}
      />
    </div>
  );
}
