import React from 'react';
import { RefreshCw, Maximize2 } from 'lucide-react';
import { useOptionalAppData } from '../context/AppDataContext';
import { FontSizeSelector } from './FontSizeSelector';

export interface StudentLiveHeaderProps {
  lang?: 'zh' | 'en';
  activeStudentId?: string | null;
  students?: any[];
  selectedLesson?: string | null;
  lessons?: any[];
  isStudentLocked?: boolean;
  isFollowingTeacher?: boolean;
  setIsFollowingTeacher?: (val: boolean | ((prev: boolean) => boolean)) => void;
  notifyLockedNavigation?: () => void;
}

export function StudentLiveHeader(props: StudentLiveHeaderProps) {
  const appData = useOptionalAppData();

  const lang = (props.lang ?? appData?.lang ?? 'zh') as 'zh' | 'en';
  const activeStudentId = props.activeStudentId !== undefined ? props.activeStudentId : (appData?.activeStudentId ?? null);
  const students = props.students ?? appData?.students ?? [];
  const selectedLesson = props.selectedLesson !== undefined ? props.selectedLesson : (appData?.selectedLesson ?? null);
  const lessons = props.lessons ?? appData?.lessons ?? [];
  const isStudentLocked = props.isStudentLocked ?? appData?.isStudentLocked ?? false;
  const isFollowingTeacher = props.isFollowingTeacher ?? appData?.isFollowingTeacher ?? false;
  const setIsFollowingTeacher = props.setIsFollowingTeacher ?? appData?.setIsFollowingTeacher ?? (() => {});
  const notifyLockedNavigation = props.notifyLockedNavigation ?? appData?.notifyLockedNavigation ?? (() => {});

  return (
    <header className="h-13 bg-surface/95 backdrop-blur-md border-b border-theme px-4 flex items-center justify-between z-20 shrink-0 select-none shadow-xs">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 to-rose-600 flex items-center justify-center text-white font-black shadow-sm text-sm">
          🎓
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-black text-main tracking-wide">
              {lang === 'zh' ? '互动课堂 · 学生端' : 'Interactive Classroom · Student Client'}
            </h1>
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {lang === 'zh' ? '已与教师中控台实时联动' : 'Synced with Teacher'}
            </span>
          </div>
          <div className="text-xs text-muted flex items-center gap-2">
            <span>
              {activeStudentId
                ? `学生: ${students.find((s) => s.id === activeStudentId)?.name || activeStudentId}`
                : '学生端'}
            </span>
            <span>•</span>
            <span>
              {selectedLesson
                ? `课节: ${lessons.find((l) => l.id === selectedLesson)?.title || selectedLesson}`
                : '等待教师推流课节...'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (isStudentLocked) {
              notifyLockedNavigation();
              return;
            }
            setIsFollowingTeacher(!isFollowingTeacher);
          }}
          disabled={isStudentLocked}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 shadow-2xs ${
            isStudentLocked ? 'cursor-not-allowed' : 'cursor-pointer'
          } ${
            isFollowingTeacher
              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
              : 'bg-surface text-muted border-theme hover:text-main'
          } ${isStudentLocked ? 'opacity-70' : ''}`}
          title={
            isStudentLocked
              ? lang === 'zh'
                ? '全班专注锁定中，已强制跟随教师步调'
                : 'Class focus is locked; following the teacher is enforced'
              : lang === 'zh'
                ? '开启后，教师端切换课节/环节/Tab时，学生端将自动同步跟随'
                : 'Follow teacher navigation'
          }
        >
          <RefreshCw size={12} className={isFollowingTeacher ? 'animate-spin' : ''} />
          <span>
            {lang === 'zh'
              ? `跟随教师步调: ${isFollowingTeacher ? '开' : '关'}`
              : `Follow Teacher: ${isFollowingTeacher ? 'ON' : 'OFF'}`}
          </span>
        </button>

        <FontSizeSelector lang={lang} />

        <button
          type="button"
          onClick={() => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }}
          className="p-1.5 text-muted hover:text-main rounded-lg border border-theme hover:bg-surface-secondary transition-colors cursor-pointer"
          title={lang === 'zh' ? '切换全屏' : 'Toggle Fullscreen'}
        >
          <Maximize2 size={14} />
        </button>

        <button
          type="button"
          onClick={() => window.close()}
          className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg transition-colors cursor-pointer"
          title={lang === 'zh' ? '关闭学生端Tab' : 'Close Tab'}
        >
          {lang === 'zh' ? '关闭Tab' : 'Close Tab'}
        </button>
      </div>
    </header>
  );
}

export default StudentLiveHeader;
