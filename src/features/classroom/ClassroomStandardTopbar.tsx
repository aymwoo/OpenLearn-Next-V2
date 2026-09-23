import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Sparkles,
  Vote,
  BellRing,
  Timer,
  Trophy,
  Dices,
  ExternalLink,
  ShieldAlert,
  Shield,
  MonitorPlay,
  Presentation,
  Users,
  Wifi,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { ClassroomAttributionModal } from './ClassroomAttributionModal';
import { ClassroomLeaderboardModal } from './ClassroomLeaderboardModal';

export interface ClassroomStandardTopbarProps {
  lessonId: string | null;
  lessonTitle?: string;
  classId: string | null;
  className?: string;
  lessons?: Array<{ id: string; title: string }>;
  classes?: Array<{ id: string; name: string }>;
  onSelectLesson?: (lessonId: string | null) => void;
  onSelectClass?: (classId: string | null) => void;
  currentStage: string;
  onStageChange: (stage: string) => void;
  lang?: 'zh' | 'en';
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  isClassLocked?: boolean;
  onToggleClassLock?: (locked: boolean) => void;
  isStudentWindowOpen?: boolean;
  onOpenStudentWindow?: () => void;
  onOpenStageModal?: () => void;
  onOpenPollDialog?: () => void;
  activePoll?: any;
  activeBuzzer?: any;
  onTriggerBuzzer?: () => void;
  onClosePoll?: () => void;
  lockingClass?: boolean;
  students?: any[];
}

export function ClassroomStandardTopbar({
  lessonId,
  lessonTitle,
  classId,
  className,
  lessons = [],
  classes = [],
  onSelectLesson,
  onSelectClass,
  currentStage,
  onStageChange,
  lang = 'zh',
  addToast,
  isClassLocked = false,
  lockingClass = false,
  onToggleClassLock,
  isStudentWindowOpen = false,
  onOpenStudentWindow,
  onOpenStageModal,
  onOpenPollDialog,
  activePoll,
  activeBuzzer,
  onTriggerBuzzer,
  onClosePoll,
  students = [],
}: ClassroomStandardTopbarProps) {
  const [isAttributionModalOpen, setIsAttributionModalOpen] = useState(false);
  const [isLeaderboardModalOpen, setIsLeaderboardModalOpen] = useState(false);
  const [stageTimerSec, setStageTimerSec] = useState<number>(23 * 60 + 37);

  // Countdown timer for teaching phase
  useEffect(() => {
    const timer = setInterval(() => {
      setStageTimerSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAddTwoMinutes = () => {
    setStageTimerSec((prev) => prev + 120);
    addToast?.(
      lang === 'zh' ? '环节已补时' : 'Time Extended',
      lang === 'zh' ? '当前教学环节已延长 2 分钟' : 'Current stage extended by 2 minutes',
      'info',
    );
  };

  const stages = [
    { id: 'PRE_CLASS_READY', labelZh: '1. 预习', labelEn: '1. Prep' },
    { id: 'IN_CLASS_TEACHING', labelZh: '2. 核心讲解', labelEn: '2. Teaching' },
    { id: 'WRAP_UP_EXIT_TICKET', labelZh: '3. 实操通票', labelEn: '3. Practice' },
    { id: 'ARCHIVED_REPORT', labelZh: '4. 总结简报', labelEn: '4. Wrapup' },
  ];

  return (
    <>
      <header
        id="classroom-standard-topbar"
        className="w-full h-12 bg-surface/95 backdrop-blur-xl border-b border-border/80 px-3 py-1 flex items-center justify-between select-none text-xs gap-2 z-30 transition-colors shadow-3xs"
      >
        {/* Left Section: Brand & Teaching Phase Capsule (Stitch: h-7 capsule) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-1.5 pr-2 border-r border-border/70 h-7">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-3xs">
              <GraduationCap size={14} />
            </div>
            <div className="flex items-center gap-1 font-bold text-foreground">
              <span>OpenLearn</span>
              <span className="text-primary-theme">Next</span>
              <span className="text-[9px] font-mono text-muted bg-surface-secondary px-1 py-0.2 rounded border border-border">
                v0.4
              </span>
            </div>
          </div>

          {/* Plugin Anchor: before stages */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:stages"
            placement="before"
            slotProps={{ currentStage, lessonId, classId }}
          />

          {/* Phase Flow Pills */}
          <div className="flex items-center gap-0.5 bg-surface-secondary/70 p-0.5 rounded-xl border border-border/60 h-7">
            {stages.map((st) => {
              const isActive = currentStage === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => onStageChange(st.id)}
                  className={`h-6 px-2 flex items-center gap-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary-theme text-white shadow-3xs'
                      : 'text-muted hover:text-foreground hover:bg-surface'
                  }`}
                >
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  <span>{lang === 'zh' ? st.labelZh : st.labelEn}</span>
                  {isActive && currentStage === 'IN_CLASS_TEACHING' && (
                    <span className="font-mono text-[10px] text-indigo-100 pl-0.5 font-normal">
                      {formatTimer(stageTimerSec)}
                    </span>
                  )}
                </button>
              );
            })}

            {/* +2m quick time extension */}
            <button
              onClick={handleAddTwoMinutes}
              className="h-6 px-1.5 rounded-md bg-surface text-foreground hover:bg-surface-secondary text-[10px] font-mono font-bold border border-border/80 shadow-3xs transition flex items-center justify-center cursor-pointer ml-0.5"
              title={lang === 'zh' ? '延长当前环节 2 分钟' : 'Extend current phase by 2m'}
            >
              +2m
            </button>
          </div>

          {/* Plugin Anchor: after stages */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:stages"
            placement="after"
            slotProps={{ currentStage, lessonId, classId }}
          />
        </div>

        {/* Center Section: Course & Class Dropdown Context */}
        <div className="flex items-center gap-1.5 shrink-0 max-w-[340px]">
          {/* Plugin Anchor: before context */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:context"
            placement="before"
            slotProps={{ lessonId, classId }}
          />

          {lessons.length > 0 && onSelectLesson ? (
            <div className="relative flex items-center">
              <select
                value={lessonId || ''}
                onChange={(e) => onSelectLesson(e.target.value === '' ? null : e.target.value)}
                className="h-7 pl-2 pr-4 bg-surface-secondary/70 border border-border/80 rounded-xl text-xs font-semibold text-foreground hover:bg-surface outline-none cursor-pointer transition max-w-[150px] truncate"
              >
                <option value="">{lang === 'zh' ? '— 选择课节 —' : '— Select Lesson —'}</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            lessonTitle && (
              <span className="px-2 py-1 rounded-lg bg-surface-secondary font-semibold text-foreground text-xs truncate max-w-[150px]">
                {lessonTitle}
              </span>
            )
          )}

          <span className="text-border font-light text-xs">/</span>

          {classes.length > 0 && onSelectClass ? (
            <div className="relative flex items-center">
              <select
                value={classId || ''}
                onChange={(e) => onSelectClass(e.target.value === '' ? null : e.target.value)}
                className="h-7 pl-2 pr-4 bg-surface-secondary/70 border border-border/80 rounded-xl text-xs font-medium text-foreground hover:bg-surface outline-none cursor-pointer transition max-w-[140px] truncate"
              >
                <option value="">{lang === 'zh' ? '— 选择班级 —' : '— Select Class —'}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            className && (
              <span className="px-2 py-1 rounded-lg bg-surface-secondary text-muted text-xs truncate max-w-[140px]">
                {className}
              </span>
            )
          )}

          {/* Plugin Anchor: after context */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:context"
            placement="after"
            slotProps={{ lessonId, classId }}
          />
        </div>

        {/* Right Section: Compact Icon-First Quick Action Dock */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Plugin Anchor: before quick actions */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:actions"
            placement="before"
            slotProps={{ lessonId, classId, currentStage }}
          />

          {/* 极速投票 (Vote) */}
          <div className="relative group flex items-center">
            <button
              onClick={() => {
                if (activePoll && activePoll.status === 'ACTIVE' && onClosePoll) {
                  onClosePoll();
                } else if (onOpenPollDialog) {
                  onOpenPollDialog();
                }
              }}
              className={`relative w-7 h-7 rounded-xl flex items-center justify-center transition border shadow-3xs cursor-pointer ${
                activePoll && activePoll.status === 'ACTIVE'
                  ? 'bg-amber-500 text-white border-amber-600 animate-pulse'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-300/40'
              }`}
              title={lang === 'zh' ? '极速投票 (⌥V)' : 'Quick Poll'}
            >
              <Vote size={14} />
              {activePoll && activePoll.status === 'ACTIVE' && (
                <span className="absolute -top-1 -right-1 px-1 h-3.5 min-w-[14px] text-[8px] font-bold leading-none bg-rose-500 text-white rounded-full flex items-center justify-center border border-white">
                  {Object.values(activePoll.distribution || {}).reduce((a: any, b: any) => a + b, 0) as number}
                </span>
              )}
            </button>
          </div>

          {/* 随堂抢答 (Buzzer) */}
          <div className="relative group flex items-center">
            <button
              onClick={onTriggerBuzzer}
              className={`relative w-7 h-7 rounded-xl flex items-center justify-center transition border shadow-3xs cursor-pointer ${
                activeBuzzer && activeBuzzer.status === 'READY'
                  ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
                  : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-300/40'
              }`}
              title={lang === 'zh' ? '随堂抢答 (⌥B)' : 'Buzzer'}
            >
              <BellRing size={14} />
            </button>
          </div>

          {/* 随机抽问与加分 (Dices / Rollcall) -> Opens Attribution Modal */}
          <div className="relative group flex items-center">
            <button
              onClick={() => setIsAttributionModalOpen(true)}
              className="relative w-7 h-7 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-300/40 flex items-center justify-center transition shadow-3xs cursor-pointer"
              title={lang === 'zh' ? '随机抽问与归因表现激励' : 'Random Pick & Attribution Points'}
            >
              <Dices size={14} />
            </button>
          </div>

          {/* 班级积分榜 (Leaderboard) -> Opens Leaderboard Modal */}
          <div className="relative group flex items-center">
            <button
              onClick={() => setIsLeaderboardModalOpen(true)}
              className="relative w-7 h-7 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-300/40 flex items-center justify-center transition shadow-3xs cursor-pointer"
              title={lang === 'zh' ? '全班积分榜与小组联赛' : 'Class Points & Team Leaderboard'}
            >
              <Trophy size={14} />
            </button>
          </div>

          {/* 学生视角预览 (Student Preview Tab) */}
          {onOpenStudentWindow && (
            <button
              onClick={onOpenStudentWindow}
              className={`h-7 px-2.5 rounded-xl border flex items-center gap-1.5 text-[11px] font-bold transition shadow-3xs cursor-pointer ${
                isStudentWindowOpen
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/50'
                  : 'bg-surface hover:bg-surface-secondary text-foreground border-border'
              }`}
              title={
                lang === 'zh'
                  ? '在独立浏览器新Tab中打开学生端预览，可与当前教师端分屏实时操作联动'
                  : 'Open student preview in a new browser tab to sync with teacher operations side-by-side'
              }
            >
              {isStudentWindowOpen ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>🎓 {lang === 'zh' ? '学生端已联动 (激活Tab)' : 'Student Linked (Focus Tab)'}</span>
                  <ExternalLink size={11} className="opacity-80" />
                </>
              ) : (
                <>
                  <span>🎓 {lang === 'zh' ? '学生视角预览 (独立Tab)' : 'Student Preview (New Tab)'}</span>
                  <ExternalLink size={11} className="opacity-80" />
                </>
              )}
            </button>
          )}

          {/* 一键全班锁屏管控 */}
          {onToggleClassLock && (
            <button
              onClick={() => onToggleClassLock(!isClassLocked)}
              disabled={lockingClass || !lessonId || !classId}
              className={`h-7 px-2.5 rounded-xl flex items-center gap-1.5 text-[11px] font-bold transition border shadow-3xs cursor-pointer disabled:opacity-50 ${
                isClassLocked
                  ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-600'
                  : 'bg-surface hover:bg-surface-secondary text-foreground border-border'
              }`}
              title={
                isClassLocked
                  ? lang === 'zh'
                    ? '一键解锁全班'
                    : 'Unlock Entire Class'
                  : lang === 'zh'
                    ? '全班专注锁定'
                    : 'Lock Class Screen'
              }
            >
              {isClassLocked ? <ShieldAlert size={13} className="text-white" /> : <Shield size={13} className="text-indigo-600 dark:text-indigo-400" />}
              <span>
                {isClassLocked
                  ? lang === 'zh'
                    ? '一键解锁全班'
                    : 'Unlock Entire Class'
                  : lang === 'zh'
                    ? '全班专注锁定'
                    : 'Lock Class Screen'}
              </span>
            </button>
          )}

          {/* 大屏展台模式 */}
          {onOpenStageModal && (
            <button
              onClick={onOpenStageModal}
              className="w-7 h-7 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-300/40 flex items-center justify-center transition shadow-3xs cursor-pointer"
              title={lang === 'zh' ? '打开大屏展台' : 'Open Stage Display'}
            >
              <MonitorPlay size={14} />
            </button>
          )}

          {/* Live broadcast status pill */}
          <div className="flex items-center gap-1 pl-1">
            <span className="h-6 px-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-300/30 text-[9px] font-mono font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>HD</span>
            </span>
          </div>

          {/* Plugin Extension Slots in Right Dock */}
          <ExtensionPointRenderer
            slot="classroom.topbar.action"
            slotProps={{ lessonId, classId, currentStage }}
          />
          <ExtensionPointRenderer
            slot="classroom.topbar.pill"
            slotProps={{ lessonId, classId, currentStage }}
          />

          {/* Plugin Anchor: after quick actions */}
          <ExtensionPointRenderer
            slot="anchor:classroom-topbar:actions"
            placement="after"
            slotProps={{ lessonId, classId, currentStage }}
          />
        </div>
      </header>

      {/* Attribution Award Modal */}
      <ClassroomAttributionModal
        isOpen={isAttributionModalOpen}
        onClose={() => setIsAttributionModalOpen(false)}
        classId={classId}
        lessonId={lessonId}
        students={students}
        lang={lang}
        addToast={addToast}
        onOpenLeaderboard={() => setIsLeaderboardModalOpen(true)}
      />

      {/* Class Points & Team Leaderboard Modal */}
      <ClassroomLeaderboardModal
        isOpen={isLeaderboardModalOpen}
        onClose={() => setIsLeaderboardModalOpen(false)}
        classId={classId}
        lessonId={lessonId}
        students={students}
        lang={lang}
        addToast={addToast}
        onSelectStudentToAward={(student) => {
          setIsLeaderboardModalOpen(false);
          setIsAttributionModalOpen(true);
        }}
      />
    </>
  );
}
