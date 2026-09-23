import React, { useState, useRef, useEffect } from 'react';
import {
  GraduationCap,
  Lock,
  Unlock,
  BookOpen,
  Radio,
  Sun,
  Moon,
  ExternalLink,
  ChevronDown,
  Users,
  Presentation,
  Check,
  Activity,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { useThemeStore } from '../../../store/themeStore';

export interface ClassroomCockpitHeaderProps {
  lessonId: string | null;
  lessonTitle?: string;
  classId: string | null;
  className?: string;
  lessons: Array<{ id: string; title: string }>;
  classes: Array<{ id: string; name: string }>;
  onSelectLesson: (id: string | null) => void;
  onSelectClass: (id: string | null) => void;
  isClassLocked: boolean;
  lockingClass?: boolean;
  onToggleClassLock: (locked: boolean) => void;
  isStudentWindowOpen: boolean;
  onOpenStudentWindow: () => void;
  studentCount?: number;
  onlineCount?: number;
  lang?: 'zh' | 'en';
  teacherName?: string;
  onOpenResourceLibrary?: () => void;
  onOpenNetworkDiagnostics?: () => void;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomCockpitHeader({
  lessonId,
  lessonTitle,
  classId,
  className,
  lessons = [],
  classes = [],
  onSelectLesson,
  onSelectClass,
  isClassLocked,
  lockingClass = false,
  onToggleClassLock,
  isStudentWindowOpen,
  onOpenStudentWindow,
  studentCount = 32,
  onlineCount = 1,
  lang = 'zh',
  teacherName = '陈老师',
  onOpenResourceLibrary,
  onOpenNetworkDiagnostics,
  addToast,
}: ClassroomCockpitHeaderProps) {
  const { theme, setTheme } = useThemeStore();
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const [isLessonMenuOpen, setIsLessonMenuOpen] = useState(false);
  const [isClassMenuOpen, setIsClassMenuOpen] = useState(false);

  const lessonDropdownRef = useRef<HTMLDivElement>(null);
  const classDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (lessonDropdownRef.current && !lessonDropdownRef.current.contains(event.target as Node)) {
        setIsLessonMenuOpen(false);
      }
      if (classDropdownRef.current && !classDropdownRef.current.contains(event.target as Node)) {
        setIsClassMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLessonDisplay =
    lessonTitle || lessons.find((l) => l.id === lessonId)?.title || (lang === 'zh' ? '请选择授课课程' : 'Select Lesson');
  const currentClassDisplay =
    className || classes.find((c) => c.id === classId)?.name || (lang === 'zh' ? '请选择授课班级' : 'Select Class');

  return (
    <header
      className="h-14 bg-surface border-b border-border/80 px-4 flex items-center justify-between z-30 shrink-0 shadow-2xs select-none"
      data-purpose="global-header"
    >
      {/* ── Left: Brand, Version & Mode Breadcrumb ── */}
      <div className="flex items-center gap-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-sm shadow-indigo-300 dark:shadow-none">
            <GraduationCap size={18} className="stroke-[2.5]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-foreground tracking-tight text-base">
              OpenLearn <span className="text-indigo-600 dark:text-indigo-400">Next</span>
            </span>
            <span className="text-[10px] font-mono text-muted bg-surface-secondary px-1.5 py-0.5 rounded border border-border">
              v0.3.21
            </span>
          </div>
        </div>

        <div className="h-4 w-px bg-border mx-0.5" />

        {/* Mode Breadcrumb (Stitch Screen 1219a481) */}
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 font-semibold text-indigo-700 dark:text-indigo-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{lang === 'zh' ? '智能授课工作流控制中心' : 'Smart Teaching Cockpit'}</span>
          </span>
        </div>
      </div>

      {/* ── Center: Global Class & Curriculum Context Selector ── */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-surface-secondary/70 p-1 rounded-xl border border-border text-xs shadow-3xs">
          {/* Lesson selector dropdown */}
          <div className="relative" ref={lessonDropdownRef}>
            <button
              type="button"
              onClick={() => {
                setIsLessonMenuOpen(!isLessonMenuOpen);
                setIsClassMenuOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-surface hover:bg-surface-secondary text-foreground rounded-lg shadow-3xs font-semibold transition border border-border/60 cursor-pointer max-w-[220px]"
              title={lang === 'zh' ? '切换授课课节' : 'Switch Lesson'}
            >
              <Presentation size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="truncate">{currentLessonDisplay}</span>
              <ChevronDown size={12} className="text-muted shrink-0 ml-0.5" />
            </button>

            {isLessonMenuOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 bg-surface border border-border rounded-xl shadow-xl z-50 py-1 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-border/50">
                  {lang === 'zh' ? '可选课节列表' : 'Available Lessons'}
                </div>
                {lessons.map((l) => {
                  const isSelected = l.id === lessonId;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        onSelectLesson(l.id);
                        setIsLessonMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-surface-secondary transition ${
                        isSelected ? 'bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 font-bold' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate pr-2">{l.title}</span>
                      {isSelected && <Check size={13} className="text-indigo-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <span className="text-border px-1.5 font-light">/</span>

          {/* Class selector dropdown */}
          <div className="relative" ref={classDropdownRef}>
            <button
              type="button"
              onClick={() => {
                setIsClassMenuOpen(!isClassMenuOpen);
                setIsLessonMenuOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-muted hover:text-foreground hover:bg-surface/80 rounded-lg cursor-pointer font-medium transition max-w-[230px]"
              title={lang === 'zh' ? '切换教学班级' : 'Switch Class'}
            >
              <Users size={13} className="text-slate-500 shrink-0" />
              <span className="truncate">
                {currentClassDisplay} {classId ? `(${studentCount}人)` : ''}
              </span>
              <ChevronDown size={12} className="text-muted shrink-0 ml-0.5" />
            </button>

            {isClassMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 bg-surface border border-border rounded-xl shadow-xl z-50 py-1 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-border/50">
                  {lang === 'zh' ? '授课班级选择' : 'Select Class'}
                </div>
                {classes.map((c) => {
                  const isSelected = c.id === classId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelectClass(c.id);
                        setIsClassMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-surface-secondary transition ${
                        isSelected ? 'bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 font-bold' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate pr-2">{c.name}</span>
                      {isSelected && <Check size={13} className="text-indigo-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: Student View, Screen Lock & Utilities Dock ── */}
      <div className="flex items-center gap-2">
        {/* Student View (Pink Button with Popout Icon - Stitch Screen 1219a481) */}
        <div className="relative group">
          <button
            type="button"
            onClick={onOpenStudentWindow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 active:bg-pink-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            title={lang === 'zh' ? '学生视角预览 (新标签页广播视窗)' : 'Student View Preview'}
          >
            <span className="w-2 h-2 rounded-full bg-pink-200 animate-ping mr-0.5" />
            <span>
              {isStudentWindowOpen
                ? lang === 'zh'
                  ? '学生端已联动 (激活Tab)'
                  : 'Student Linked (Focus)'
                : lang === 'zh'
                  ? '学生视角预览 (独立Tab)'
                  : 'Student View'}
            </span>
            <ExternalLink size={12} className="opacity-80" />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
            <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
              {lang === 'zh' ? '学生视角预览 (独立Tab跨屏实时联动)' : 'Student Tab Live Sync'}
            </div>
          </div>
        </div>

        {/* Lock Class Screen Toggle (Rose Button - Stitch Screen 1219a481) */}
        <div className="relative group">
          <button
            type="button"
            disabled={!lessonId || lockingClass}
            onClick={() => onToggleClassLock(!isClassLocked)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition border cursor-pointer ${
              isClassLocked
                ? 'bg-rose-500 text-white border-rose-600 shadow-xs'
                : 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
            }`}
            title={lang === 'zh' ? '一键锁屏/解锁全班学生机' : 'Lock/Unlock All Student Screens'}
          >
            {isClassLocked ? <Lock size={15} /> : <Unlock size={15} />}
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
            <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
              {isClassLocked
                ? lang === 'zh'
                  ? '点击解除全班学生端锁定'
                  : 'Unlock All Student Screens'
                : lang === 'zh'
                  ? '一键全班屏幕强行锁定专注'
                  : 'Lock All Student Screens'}
            </div>
          </div>
        </div>

        <div className="h-4 w-px bg-border mx-0.5" />

        {/* Digital Resource Library Shortcut */}
        <div className="relative group">
          <button
            type="button"
            onClick={onOpenResourceLibrary}
            className="p-1.5 rounded-lg text-muted hover:bg-surface-secondary hover:text-foreground transition cursor-pointer"
            title={lang === 'zh' ? '校本数字教学资源库' : 'Resource Library'}
          >
            <BookOpen size={16} />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
            <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2 rounded shadow-lg whitespace-nowrap">
              {lang === 'zh' ? '校本数字教学资源库' : 'Resource Library'}
            </div>
          </div>
        </div>

        {/* Network Diagnostics and Stream Health */}
        <div className="relative group">
          <button
            type="button"
            onClick={onOpenNetworkDiagnostics}
            className="p-1.5 rounded-lg text-muted hover:bg-surface-secondary hover:text-foreground transition cursor-pointer"
            title={lang === 'zh' ? '网络诊断与推流状态' : 'Stream & Network Status'}
          >
            <Radio size={16} className="text-emerald-500 animate-pulse" />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
            <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2 rounded shadow-lg whitespace-nowrap">
              {lang === 'zh' ? '网络诊断与推流状态 (稳定在线)' : 'Stream Health: Live'}
            </div>
          </div>
        </div>

        {/* Theme Preference Toggle */}
        <div className="relative group">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-muted hover:bg-surface-secondary hover:text-foreground transition cursor-pointer"
            title={lang === 'zh' ? '明暗偏好设置' : 'Toggle Theme'}
          >
            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
            <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2 rounded shadow-lg whitespace-nowrap">
              {lang === 'zh' ? '明暗主题偏好切换' : 'Toggle Theme'}
            </div>
          </div>
        </div>

        {/* Third-Party Plugin Actions Slot */}
        <ExtensionPointRenderer slot="classroom.header.action" />

        {/* Teacher Online Profile Avatar (Stitch Screen 1219a481) */}
        <div className="flex items-center gap-2 pl-1.5 border-l border-border">
          <div className="relative cursor-pointer group">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-sky-400 p-0.5 shadow-xs">
              <div className="w-full h-full rounded-full bg-surface flex items-center justify-center overflow-hidden">
                <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {teacherName.slice(0, 2)}
                </span>
              </div>
            </div>
            <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-surface" />
            <div className="absolute right-0 top-full mt-1.5 z-40 hidden group-hover:flex flex-col pointer-events-none">
              <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-lg whitespace-nowrap">
                {teacherName} ({lang === 'zh' ? '授课讲师在线' : 'Teacher Online'})
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
