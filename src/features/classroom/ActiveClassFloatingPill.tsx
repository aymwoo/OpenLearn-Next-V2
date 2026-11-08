import React, { useState } from 'react';
import {
  Radio,
  ArrowRight,
  Clock,
  Users,
  Shield,
  ShieldAlert,
  MonitorPlay,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useLiveClassStore } from '../../store/liveClassStore';
import { useOptionalAppData } from '../../context/AppDataContext';
import { useStageDisplayWindow } from './stage-display/useStageDisplayWindow';

export interface ActiveClassFloatingPillProps {
  className?: string;
}

export function ActiveClassFloatingPill({ className = '' }: ActiveClassFloatingPillProps) {
  const appData = useOptionalAppData();
  const lang = useAppStore((s) => s.lang);
  const teacherTab = useAppStore((s) => s.teacherTab);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const lessons = useAppStore((s) => s.lessons);
  const classes = useAppStore((s) => s.classes);

  const liveClassIsActive = useLiveClassStore((s) => s.liveClassIsActive);
  const liveClassTimeRemaining = useLiveClassStore((s) => s.liveClassTimeRemaining);
  const liveClassSelectedClassId = useLiveClassStore((s) => s.liveClassSelectedClassId);
  const onlineStudentIds = useLiveClassStore((s) => s.onlineStudentIds);

  const [isMinimized, setIsMinimized] = useState(false);
  const [lockingClass, setLockingClass] = useState(false);
  const { openStageWindow } = useStageDisplayWindow();

  // 仅当不在互动课堂页面（teacherTab !== 'live_class'）且存在正在进行的课节时显示
  const hasActiveSession = Boolean(selectedLesson && (liveClassIsActive || liveClassTimeRemaining > 0));
  if (teacherTab === 'live_class' || !hasActiveSession) {
    return null;
  }

  const currentLesson = lessons.find((l) => l.id === selectedLesson);
  const currentClass = classes.find((c) => c.id === liveClassSelectedClassId);

  const students = appData?.students || [];
  const lockedStudents = students.filter((s: any) => s.locked_lesson_id === selectedLesson);
  const isClassLocked = Boolean(liveClassSelectedClassId && lockedStudents.length > 0);

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleToggleClassLock = async () => {
    if (!liveClassSelectedClassId || !selectedLesson) return;
    setLockingClass(true);
    try {
      const endpoint = isClassLocked
        ? `/api/classes/${liveClassSelectedClassId}/unlock_lesson`
        : `/api/classes/${liveClassSelectedClassId}/lock_lesson`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isClassLocked ? JSON.stringify({ lessonId: selectedLesson, mode: 'full' }) : undefined,
      });
      if (res.ok && appData?.fetchStudents) {
        await appData.fetchStudents();
      }
    } catch (err) {
      console.error('Failed to toggle class lock from pill:', err);
    } finally {
      setLockingClass(false);
    }
  };

  const handleOpenStage = () => {
    if (!selectedLesson) return;
    openStageWindow({
      lessonId: selectedLesson,
      lessonTitle: currentLesson?.title,
      lang: lang === 'en' ? 'en' : 'zh',
    });
  };

  return (
    <div
      id="active-class-floating-pill"
      data-testid="active-class-floating-pill"
      className={`fixed top-18 right-6 z-40 transition-all duration-200 select-none ${className}`}
    >
      <div className="bg-slate-900/90 dark:bg-slate-950/95 text-white backdrop-blur-md border border-indigo-500/40 rounded-2xl shadow-2xl p-2.5 sm:px-4 sm:py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
        {/* Live indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
          </span>
          <span className="text-xs font-black tracking-wide text-rose-300 uppercase shrink-0">
            {lang === 'zh' ? '正在授课' : 'LIVE'}
          </span>
        </div>

        {/* Lesson & Class Info */}
        {!isMinimized && (
          <div className="flex items-center gap-2 max-w-[200px] sm:max-w-[260px] truncate border-l border-slate-700/80 pl-2.5">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-100 truncate" title={currentLesson?.title || '授课中'}>
                {currentLesson?.title || (lang === 'zh' ? '当前课程' : 'Current Lesson')}
              </div>
              <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                <span>{currentClass?.name || (lang === 'zh' ? '班级授课中' : 'In Class')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Countdown & Online count */}
        {!isMinimized && (
          <div className="hidden md:flex items-center gap-2.5 border-l border-slate-700/80 pl-2.5 text-xs font-mono font-bold">
            {liveClassTimeRemaining > 0 && (
              <span
                className="flex items-center gap-1 text-amber-300"
                title={lang === 'zh' ? '环节剩余时间' : 'Time Remaining'}
              >
                <Clock size={12} className="text-amber-400" />
                <span>{formatTime(liveClassTimeRemaining)}</span>
              </span>
            )}
            <span
              className="flex items-center gap-1 text-emerald-300"
              title={lang === 'zh' ? '在线学生人数' : 'Online Students'}
            >
              <Users size={12} className="text-emerald-400" />
              <span>{onlineStudentIds.length}</span>
            </span>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5 shrink-0 pl-1">
          {/* Quick Lock/Unlock Button */}
          {!isMinimized && liveClassSelectedClassId && (
            <button
              type="button"
              disabled={lockingClass}
              onClick={handleToggleClassLock}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                isClassLocked
                  ? 'bg-rose-600/80 hover:bg-rose-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
              }`}
              title={
                isClassLocked
                  ? lang === 'zh'
                    ? '全班专注锁定中，点击一键解锁'
                    : 'Class is locked. Click to unlock'
                  : lang === 'zh'
                    ? '一键全班专注锁定'
                    : 'Class Focus Lock'
              }
            >
              {isClassLocked ? <ShieldAlert size={13} /> : <Shield size={13} />}
            </button>
          )}

          {/* Open Stage Window in background */}
          {!isMinimized && (
            <button
              type="button"
              onClick={handleOpenStage}
              className="p-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer shrink-0"
              title={lang === 'zh' ? '独立展台投屏到副屏' : 'Stage Display on Second Screen'}
            >
              <MonitorPlay size={13} />
            </button>
          )}

          {/* Return to Live Class Button */}
          <button
            type="button"
            onClick={() => setTeacherTab('live_class')}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 active:scale-95 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-indigo-900/30 transition-all cursor-pointer shrink-0"
            title={lang === 'zh' ? '返回互动课堂白板（瞬时秒切）' : 'Return to Live Classroom'}
          >
            <span>{lang === 'zh' ? '返回白板' : 'Back to Whiteboard'}</span>
            <ArrowRight size={13} />
          </button>

          {/* Minimize / Expand Toggle */}
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={isMinimized ? (lang === 'zh' ? '展开' : 'Expand') : lang === 'zh' ? '折叠' : 'Minimize'}
          >
            {isMinimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
