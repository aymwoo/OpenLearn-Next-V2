import React from 'react';
import {
  Shuffle,
  Activity,
  AlertTriangle,
  Send,
  Shield,
  ShieldAlert,
  Unlock,
  Pin,
  X,
  FileEdit,
  MessageSquare,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mars,
  Venus,
  UserRound,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { errorStore } from '../../../store/errorStore';
import type { StudentType, StudentProgressType, LockMode } from '../../../types/app';
import type { ComponentProps } from 'react';
import type { TopPerformersWidget } from '../../teacher/TopPerformersWidget';

type MonitorAddToast = NonNullable<ComponentProps<typeof TopPerformersWidget>['addToast']>;

type StudentProgressWithQuiz = StudentProgressType & { quiz_score?: number | null };

/**
 * 学生头像内容：优先用本人照片（students.avatar），没有照片时按性别渲染，
 * 性别未设置则退到中性人像 —— 不再把姓名塞进 34px 的圆里（必然被省略号截断）。
 */
export function StudentAvatarVisual({
  avatar,
  gender,
  name,
}: {
  avatar?: string | null;
  gender?: string | null;
  name: string;
}) {
  if (avatar) {
    return <img src={avatar} alt={name} className="w-full h-full object-cover" draggable={false} />;
  }
  const normalized = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
  if (normalized === 'male' || normalized === 'm' || normalized === '男') {
    return <Mars size={16} className="text-sky-600" aria-hidden="true" />;
  }
  if (normalized === 'female' || normalized === 'f' || normalized === '女') {
    return <Venus size={16} className="text-rose-500" aria-hidden="true" />;
  }
  return <UserRound size={16} className="text-slate-400" aria-hidden="true" />;
}

export type LiveClassFeedItem = {
  id: string;
  time: string;
  type: string;
  message: string;
};

export type LiveStudentMonitorPanelProps = {
  lang: string;
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  students: StudentType[];
  onlineStudentIds: string[];
  liveClassAcknowledgedMap: Map<string, boolean | undefined>;
  activeStudentLessons: Record<string, string | undefined>;
  liveClassStudentProgress: StudentProgressType[];
  timelineSegments: { id: string; title?: string }[];
  activeSegmentId: string | null;
  studentErrors: { studentId?: string; title?: string; message?: string }[];
  hoveredStudentId: string | null;
  setHoveredStudentId: (id: string | null) => void;
  pinnedStudentId: string | null;
  setPinnedStudentId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDrawStudentIds: string[];
  activeDrawStudentId: string | null;
  isDrawing: boolean;
  onRandomPick: () => void;
  onPingStudent?: (studentId: string, message?: string) => void;
  addToast: MonitorAddToast;
  onOverrideSegmentGate: (studentId: string) => void;
  onToggleStudentLock: (
    studentId: string,
    lockedLessonId: string | null | undefined,
    lockMode: LockMode | null | undefined,
    nextMode?: LockMode | null,
  ) => void | Promise<void>;
  isFeedCollapsed: boolean;
  setIsFeedCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  liveClassFeed: LiveClassFeedItem[];
  setLiveClassFeed: React.Dispatch<React.SetStateAction<LiveClassFeedItem[]>>;
  /** 收起为右侧窄条，给白板 / 大纲让出空间。 */
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
};

export function LiveStudentMonitorPanel(props: LiveStudentMonitorPanelProps) {
  const {
    lang,
    selectedLesson,
    liveClassSelectedClassId,
    students,
    onlineStudentIds,
    liveClassAcknowledgedMap,
    activeStudentLessons,
    liveClassStudentProgress,
    timelineSegments,
    activeSegmentId,
    studentErrors,
    hoveredStudentId,
    setHoveredStudentId,
    pinnedStudentId,
    setPinnedStudentId,
    selectedDrawStudentIds,
    activeDrawStudentId,
    isDrawing,
    onRandomPick,
    onPingStudent,
    addToast,
    onOverrideSegmentGate,
    onToggleStudentLock,
    isFeedCollapsed,
    setIsFeedCollapsed,
    liveClassFeed,
    setLiveClassFeed,
    isCollapsed = false,
    onToggleCollapse,
  } = props;

  // 收起态：只保留一条可展开的窄栏，避免长期占用 264px 挤占白板与大纲。
  if (isCollapsed) {
    return (
      <div
        data-testid="live-student-monitor-collapsed"
        className="w-10 shrink-0 bg-surface border-l border-theme flex flex-col items-center gap-2 py-3 select-none"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg border border-theme text-muted hover:text-primary-ink hover:bg-surface-secondary transition-colors cursor-pointer"
          aria-label={lang === 'zh' ? '展开学生专注面板' : 'Expand student focus panel'}
          title={lang === 'zh' ? '展开学生专注面板' : 'Expand student focus panel'}
        >
          <ChevronLeft size={14} />
        </button>
        <span
          className="text-[11px] font-black tracking-[0.2em] text-muted"
          style={{ writingMode: 'vertical-rl' }}
          aria-hidden="true"
        >
          {lang === 'zh' ? '学生专注' : 'Student Focus'}
        </span>
        <span className="text-[10px] font-mono font-bold text-muted">
          {onlineStudentIds.length}/{students.length}
        </span>
      </div>
    );
  }

  return (
    <div className="w-[264px] shrink-0 bg-surface p-3 border-l border-theme flex flex-col gap-2.5 overflow-hidden transition-all duration-300">
      {/* Student attendance grid */}
      <div className="flex-1 flex flex-col min-h-0 gap-2">
        <div className="flex items-center justify-between shrink-0 select-none pb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-black uppercase tracking-wider text-muted truncate">
              {lang === 'zh' ? '学生专注力监控' : 'Student Focus Console'}
            </span>
            {liveClassSelectedClassId && (
              <button
                onClick={onRandomPick}
                disabled={students.length === 0 || isDrawing}
                className="text-[11px] font-bold bg-primary-theme/10 text-primary-ink hover:bg-primary-theme/20 border border-primary-theme/25 px-2 py-0.5 rounded-full transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer shadow-2xs shrink-0"
                title={lang === 'zh' ? '随机抽取一名学生提问' : 'Pick a student randomly'}
              >
                <Shuffle size={10} className={isDrawing ? 'animate-spin' : ''} />
                <span>{lang === 'zh' ? '抽问' : 'Pick'}</span>
              </button>
            )}
            <ExtensionPointRenderer
              slot="classroom.monitor.header_action"
              slotProps={{
                lessonId: selectedLesson,
                classId: liveClassSelectedClassId,
                studentCount: students.length,
                onlineCount: onlineStudentIds.length,
                lang,
              }}
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-xs font-mono font-bold px-2 py-0.5 rounded-full border border-theme bg-surface-secondary text-muted shrink-0 flex items-center gap-1"
              title={lang === 'zh' ? '已锁定学生屏幕人数 (专注 / 答题)' : 'Locked count (Focus / Answer)'}
            >
              <span>
                🔒 {students.filter((s) => s.locked_lesson_id === selectedLesson).length}/{students.length}
              </span>
              {students.some((s) => s.locked_lesson_id === selectedLesson && s.lock_mode === 'navigation') && (
                <span className="text-amber-600 text-[11px] font-semibold font-sans">✏️答题</span>
              )}
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1 rounded-md text-muted hover:text-primary-ink hover:bg-surface-secondary border border-theme/60 transition-colors cursor-pointer shrink-0"
              aria-label={lang === 'zh' ? '收起学生专注面板' : 'Collapse student focus panel'}
              title={lang === 'zh' ? '收起学生专注面板' : 'Collapse student focus panel'}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {liveClassSelectedClassId ? (
          <div
            onClick={() => setPinnedStudentId(null)}
            className="overflow-y-auto flex-1 pr-1 grid grid-cols-3 gap-1.5 justify-items-center auto-rows-max scrollbar-thin py-1"
          >
            {students.map((st) => {
              const isStudentLocked = st.locked_lesson_id === selectedLesson;
              const studentLockMode = st.lock_mode || 'full';
              const isCheckedIn = liveClassAcknowledgedMap.get(st.id);
              const isOnline = onlineStudentIds.includes(st.id);
              const activeLessonId = activeStudentLessons[st.id];
              const isInLesson = activeLessonId === selectedLesson;

              const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id) as
                StudentProgressWithQuiz | undefined;
              const progPercent = studentProg?.progress_percent ?? 0;
              const teacherActiveIdx = activeSegmentId
                ? timelineSegments.findIndex((s) => s.id === activeSegmentId)
                : -1;
              const expectedProgress =
                timelineSegments.length > 0 ? Math.round(((teacherActiveIdx + 1) / timelineSegments.length) * 100) : 0;
              const isBehind = teacherActiveIdx >= 0 && progPercent < expectedProgress;

              const isSelectedDraw = selectedDrawStudentIds.includes(st.id);
              const isActiveDraw = activeDrawStudentId === st.id;
              const isPinned = pinnedStudentId === st.id;

              // SVG ring calculation
              const radius = 19.5;
              const strokeWidth = 3;
              const circumference = 2 * Math.PI * radius; // 122.52
              const strokeDashoffset = circumference - (progPercent / 100) * circumference;

              // Circular color system
              let ringColor = 'stroke-primary-theme'; // normal progress / in class
              if (isSelectedDraw) {
                ringColor = 'stroke-amber-500 stroke-[3.5px]'; // jackpot winner!
              } else if (isActiveDraw) {
                ringColor = 'stroke-indigo-500 stroke-[3.5px] animate-pulse'; // flickering drawer
              } else if (!isOnline) {
                ringColor = 'stroke-slate-200 dark:stroke-slate-700'; // offline
              } else if (isStudentLocked) {
                ringColor =
                  studentLockMode === 'navigation' ? 'stroke-amber-500 animate-pulse' : 'stroke-rose-500 animate-pulse'; // focus locked vs answer locked
              } else if (isBehind) {
                ringColor = 'stroke-amber-500 animate-pulse'; // behind progress
              } else if (!isInLesson) {
                ringColor = 'stroke-blue-400'; // not entered lesson but online
              } else if (progPercent === 100) {
                ringColor = 'stroke-emerald-500'; // completed
              }

              const stErrors = studentErrors.filter((e) => e.studentId === st.id);

              return (
                <div
                  key={st.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isPinned}
                  aria-label={`学生 ${st.name}，学习进度 ${progPercent}%${isPinned ? '，已固定概况' : ''}`}
                  onMouseEnter={() => setHoveredStudentId(st.id)}
                  onMouseLeave={() => setHoveredStudentId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinnedStudentId((prev) => (prev === st.id ? null : st.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setPinnedStudentId((prev) => (prev === st.id ? null : st.id));
                    }
                  }}
                  className={`group relative flex flex-col items-center justify-center p-1.5 rounded-xl transition-all cursor-pointer w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-theme ${
                    isSelectedDraw
                      ? 'z-20 duration-300 bg-amber-500/10 ring-2 ring-amber-400 shadow-md scale-105'
                      : isActiveDraw
                        ? 'z-20 ring-1 ring-primary-theme bg-primary-theme/5 scale-102'
                        : isPinned
                          ? 'z-10 bg-primary-theme/10 ring-2 ring-primary-theme shadow-xs scale-102'
                          : 'hover:bg-surface-secondary/70'
                  }`}
                >
                  {/* Main Circular Widget */}
                  <div
                    className={`relative w-12 h-12 flex items-center justify-center rounded-full transition-all duration-300 ${
                      isSelectedDraw
                        ? 'shadow-[0_0_15px_#f59e0b] scale-105 z-10 bg-amber-50 ring-2 ring-amber-400'
                        : isActiveDraw
                          ? 'shadow-[0_0_10px_#6366f1] scale-105 z-10 bg-indigo-50 ring-1 ring-indigo-400'
                          : isPinned
                            ? 'shadow-xs bg-primary-theme/5 ring-1 ring-primary-theme/30'
                            : ''
                    }`}
                  >
                    {/* Student Exception Alert Badge */}
                    {stErrors.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          errorStore.getState().setActiveTab('student');
                          errorStore.getState().setIsErrorCenterOpen(true);
                        }}
                        className="absolute -top-1 -right-1 z-30 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md cursor-pointer hover:scale-125 transition-transform"
                        title={`该学生端捕获到 ${stErrors.length} 处异常: ${stErrors[0].title || stErrors[0].message}`}
                      >
                        <AlertTriangle size={9} className="animate-pulse" />
                      </button>
                    )}

                    {/* Pinned indicator badge */}
                    {isPinned && !isSelectedDraw && (
                      <span
                        className="absolute -top-1 -left-1 z-20 text-[9px] bg-primary-theme text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold shadow-xs"
                        title="已固定选中"
                      >
                        <Pin size={7} />
                      </span>
                    )}

                    {/* Golden glow aura for selected draw */}
                    {isSelectedDraw && (
                      <div
                        className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping"
                        style={{ animationDuration: '2s' }}
                      />
                    )}

                    {/* Circular Progress Ring */}
                    <svg className="absolute w-full h-full transform -rotate-90" viewBox="0 0 46 46">
                      {/* Inner circle background */}
                      <circle
                        cx="23"
                        cy="23"
                        r={radius}
                        className="stroke-slate-100 dark:stroke-slate-800 fill-white dark:fill-slate-900"
                        strokeWidth={strokeWidth}
                      />
                      {/* Outer circle progress indicator */}
                      <circle
                        cx="23"
                        cy="23"
                        r={radius}
                        className={`fill-transparent transition-all duration-300 ${ringColor}`}
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                      />
                    </svg>

                    {/* Name (Static) or Controls (Hover) */}
                    <div
                      className={`relative z-10 w-8.5 h-8.5 rounded-full flex items-center justify-center overflow-hidden transition-colors ${
                        isSelectedDraw ? 'bg-amber-100/90' : ''
                      }`}
                    >
                      {/* 头像：照片 → 性别图标 → 中性人像；悬停时让位给操作按钮 */}
                      <span
                        className={`flex items-center justify-center w-full h-full group-hover:scale-0 group-hover:opacity-0 transition-all duration-200 select-none ${
                          !isOnline ? 'opacity-60' : ''
                        }`}
                      >
                        <StudentAvatarVisual avatar={st.avatar} gender={st.gender} name={st.name} />
                      </span>

                      {/* Hover action overlay */}
                      {/* 圆头像只有 34px：三个按钮必须零内边距 + 极小间距，否则会被 overflow-hidden 裁掉 */}
                      <div className="absolute inset-0 flex items-center justify-center gap-0.5 opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 bg-surface/95 rounded-full shadow-inner">
                        {/* Alert / Warning button */}
                        {selectedLesson && onPingStudent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const msg =
                                lang === 'zh'
                                  ? `⚠️ 学习进度预警：您当前的进度 (${progPercent}%) 落后于老师的讲解进度。请专注课堂，跟上讲解！`
                                  : `⚠️ Progress Alert: Your progress (${progPercent}%) is behind.`;
                              onPingStudent(st.id, msg);
                              addToast(
                                lang === 'zh' ? '🔔 已发送提醒' : '🔔 Alert Sent',
                                `已向学生 ${st.name} 发送进度提醒。`,
                                'success',
                              );
                            }}
                            className={`p-0 leading-none rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer ${
                              isBehind
                                ? 'text-amber-500 hover:text-amber-600 animate-pulse'
                                : 'text-slate-400 hover:text-primary-ink'
                            }`}
                            title="提醒"
                          >
                            <Send size={9} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOverrideSegmentGate(st.id);
                          }}
                          disabled={!selectedLesson || !activeSegmentId}
                          className="p-0 leading-none rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer text-slate-400 hover:text-emerald-600"
                          title={lang === 'zh' ? '放行当前环节' : 'Allow this segment'}
                        >
                          <Unlock size={9} />
                        </button>
                        {/* Focus / Answer Lock controller */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStudentLock(st.id, st.locked_lesson_id, st.lock_mode);
                          }}
                          disabled={!selectedLesson}
                          className={`p-0 leading-none rounded-md hover:bg-surface-secondary transition-colors shrink-0 cursor-pointer ${
                            isStudentLocked
                              ? studentLockMode === 'navigation'
                                ? 'text-amber-500 hover:text-amber-600'
                                : 'text-rose-500 hover:text-rose-600'
                              : 'text-slate-400 hover:text-rose-500'
                          }`}
                          title={
                            isStudentLocked
                              ? studentLockMode === 'navigation'
                                ? '解除答题锁定'
                                : '解除专注锁定'
                              : '开启专注锁定'
                          }
                        >
                          {isStudentLocked ? (
                            studentLockMode === 'navigation' ? (
                              <FileEdit size={9} />
                            ) : (
                              <ShieldAlert size={9} />
                            )
                          ) : (
                            <Shield size={9} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Top-Right Online/Lesson Badge Indicator or Jackpot winner target badge */}
                    {isSelectedDraw ? (
                      <span className="absolute -top-1.5 -right-1.5 z-20 text-[10px] bg-amber-700 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-md animate-bounce">
                        🎯
                      </span>
                    ) : (
                      isOnline && (
                        <span
                          className={`absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface shrink-0 ${
                            isInLesson ? 'bg-emerald-500' : 'bg-blue-400'
                          }`}
                          title={isInLesson ? '正在上课' : '在线(但未进课堂)'}
                        />
                      )
                    )}

                    {/* Bottom-Right Acknowledged/Ready Indicator */}
                    {isCheckedIn === true && !isSelectedDraw && (
                      <span
                        className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface bg-amber-500 shrink-0 animate-bounce"
                        title="已确认/就位"
                      />
                    )}
                  </div>

                  {/* 完整姓名：不截断、不加省略号，超长名字自然换行 */}
                  <span
                    className={`mt-1 w-full px-0.5 text-center text-xs font-semibold leading-tight break-words select-none ${
                      isSelectedDraw
                        ? 'text-amber-800 dark:text-amber-300'
                        : !isOnline
                          ? 'text-slate-400'
                          : 'text-slate-700 dark:text-slate-200'
                    }`}
                    title={st.name}
                  >
                    {st.name}
                  </span>

                  {/* Small Progress Label or Draw Winner Label */}
                  <span
                    className={`text-[11px] font-mono mt-0.5 truncate max-w-[54px] select-none font-bold ${
                      isSelectedDraw
                        ? 'text-amber-700 dark:text-amber-400 font-extrabold animate-bounce'
                        : !isOnline
                          ? 'text-slate-400'
                          : progPercent === 100
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : isBehind
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-muted'
                    }`}
                  >
                    {isSelectedDraw ? '🎯 抽中' : `${progPercent}%`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-subtle italic py-4 text-center flex-1 flex items-center justify-center">
            {lang === 'zh' ? '请选择班级以显示学生' : 'Select class to show student monitors.'}
          </div>
        )}
      </div>

      {/* Hover Details / Class Summary Panel */}
      <div className="bg-surface-secondary border border-theme rounded-xl p-3 flex flex-col gap-1.5 h-[128px] shrink-0 shadow-xs select-none justify-center">
        {(() => {
          const activeInspectStudentId = hoveredStudentId ?? pinnedStudentId;
          if (!activeInspectStudentId) {
            return (
              // Class summary state when no inspect
              <div className="flex flex-col gap-1 text-xs text-main h-full justify-center">
                <div className="font-extrabold text-main border-b border-theme pb-1.5 flex items-center gap-1.5 shrink-0">
                  <Activity size={12} className="text-primary-ink animate-pulse" />
                  <span>{lang === 'zh' ? '班级学情概况' : 'Class Overview'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-xs leading-tight mt-1 shrink-0">
                  <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                    <span className="text-muted font-medium text-xs">在线/总数</span>
                    <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-xs mt-0.5">
                      {students.filter((s) => onlineStudentIds.includes(s.id)).length}/{students.length}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                    <span className="text-muted font-medium text-xs">屏幕锁定</span>
                    <span className="font-bold font-mono text-xs mt-0.5">
                      <span className="text-rose-600" title="专注锁定">
                        {
                          students.filter((s) => s.locked_lesson_id === selectedLesson && s.lock_mode !== 'navigation')
                            .length
                        }
                      </span>
                      <span className="text-muted">/</span>
                      <span className="text-amber-600" title="答题锁定">
                        {
                          students.filter((s) => s.locked_lesson_id === selectedLesson && s.lock_mode === 'navigation')
                            .length
                        }
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-surface py-1 px-0.5 rounded-lg border border-theme">
                    <span className="text-muted font-medium text-xs">平均进度</span>
                    <span className="font-bold font-mono text-primary-ink text-xs mt-0.5">
                      {(() => {
                        const inClassStudents = students.filter((s) => onlineStudentIds.includes(s.id));
                        if (inClassStudents.length === 0) return '0%';
                        const total = inClassStudents.reduce((sum, s) => {
                          const p = liveClassStudentProgress.find((prog) => prog.student_id === s.id);
                          return sum + (p?.progress_percent ?? 0);
                        }, 0);
                        return `${Math.round(total / inClassStudents.length)}%`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          const st = students.find((s) => s.id === activeInspectStudentId);
          if (!st) return null;
          const isPinned = pinnedStudentId === st.id;
          const isHoverPreview = hoveredStudentId === st.id && pinnedStudentId !== null && pinnedStudentId !== st.id;
          const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id) as
            StudentProgressWithQuiz | undefined;
          const progPercent = studentProg?.progress_percent ?? 0;
          const completedSegIds = (() => {
            if (!studentProg || !studentProg.completed_segments) return [];
            try {
              return typeof studentProg.completed_segments === 'string'
                ? JSON.parse(studentProg.completed_segments)
                : studentProg.completed_segments;
            } catch {
              return [];
            }
          })();

          const stErrors = studentErrors.filter((e) => e.studentId === st.id);

          return (
            <div className="flex flex-col gap-1.5 text-xs text-main">
              <div className="font-extrabold text-main border-b border-theme pb-1 flex justify-between items-center shrink-0">
                <span className="flex items-center gap-1.5 truncate">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${onlineStudentIds.includes(st.id) ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}
                  />
                  <span className="truncate max-w-[120px]">
                    {st.name} ({st.student_number || 'N/A'})
                  </span>
                  {st.locked_lesson_id === selectedLesson && (
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-bold border shrink-0 ${
                        st.lock_mode === 'navigation'
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 border-amber-200 dark:border-amber-800'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {st.lock_mode === 'navigation' ? '✏️答题锁' : '🔒专注锁'}
                    </span>
                  )}
                  {isPinned && !isHoverPreview && (
                    <span
                      className="text-[11px] font-semibold text-primary-ink bg-primary-theme/10 border border-primary-theme/20 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0"
                      title="已固定显示该学生概况，点击空白处或 Esc 取消"
                    >
                      <Pin size={8} className="rotate-45" />
                      <span>固定</span>
                    </span>
                  )}
                  {isHoverPreview && (
                    <span
                      className="text-[11px] font-semibold text-amber-700 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0"
                      title="临时悬浮预览中，鼠标移开后恢复已固定学生"
                    >
                      预览
                    </span>
                  )}
                  {stErrors.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        errorStore.getState().setActiveTab('student');
                        errorStore.getState().setIsErrorCenterOpen(true);
                      }}
                      className="flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-1.5 py-0.5 rounded hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
                      title={`学生端存在 ${stErrors.length} 处异常: ${stErrors[0].title || stErrors[0].message}`}
                    >
                      <AlertTriangle size={10} className="text-rose-700 dark:text-rose-400 animate-pulse" />
                      <span>{stErrors.length} 异常</span>
                    </button>
                  )}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedLesson &&
                    (st.locked_lesson_id === selectedLesson ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStudentLock(
                            st.id,
                            st.locked_lesson_id,
                            st.lock_mode,
                            st.lock_mode === 'navigation' ? 'full' : 'navigation',
                          );
                        }}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-surface hover:bg-surface-secondary border border-theme text-primary-ink font-bold transition-colors cursor-pointer"
                        title={st.lock_mode === 'navigation' ? '切换为专注锁定' : '切换为答题锁定'}
                      >
                        {st.lock_mode === 'navigation' ? '切专注' : '切答题'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStudentLock(st.id, null, null, 'navigation');
                        }}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-600 border border-amber-200 dark:border-amber-800 font-bold transition-colors cursor-pointer"
                        title="对该学生开启答题锁定"
                      >
                        答题锁
                      </button>
                    ))}
                  <span className="text-xs text-primary-ink font-mono font-black">{progPercent}%</span>
                  {isPinned && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPinnedStudentId(null);
                      }}
                      className="text-muted hover:text-main p-0.5 rounded hover:bg-surface transition-colors cursor-pointer"
                      title="取消固定"
                      aria-label="取消固定学生概况"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-xs leading-tight shrink-0">
                <div className="flex flex-col gap-0.5 bg-surface p-1 rounded-lg border border-theme">
                  <span className="text-muted font-bold text-xs">随堂测验</span>
                  <span
                    className={`font-bold font-mono text-xs ${studentProg != null && studentProg.quiz_score !== null ? 'text-primary-ink' : 'text-muted'}`}
                  >
                    {studentProg != null && studentProg.quiz_score !== null
                      ? `${studentProg.quiz_score} / 100`
                      : '未提交'}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 bg-surface p-1 rounded-lg border border-theme">
                  <span className="text-muted font-bold text-xs">教学环节进度</span>
                  <span className="font-bold text-main text-xs">
                    {Array.isArray(completedSegIds) ? completedSegIds.length : 0} / {timelineSegments.length}
                  </span>
                </div>
              </div>

              <div className="text-xs text-muted leading-relaxed truncate mt-0.5 shrink-0">
                环节:{' '}
                {timelineSegments.length > 0 ? (
                  timelineSegments.map((seg, sIdx) => {
                    const isSegCompleted = Array.isArray(completedSegIds) && completedSegIds.includes(seg.id);
                    return (
                      <span
                        key={seg.id}
                        className={`mr-1 px-1.5 py-0.5 rounded font-mono text-[11px] ${isSegCompleted ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-surface text-muted border border-theme'}`}
                        title={seg.title}
                      >
                        {sIdx + 1}:{isSegCompleted ? '✓' : '✗'}
                      </span>
                    );
                  })
                ) : (
                  <span className="italic text-muted">暂无步骤</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Feedback log feed (Collapsible) */}
      <div
        className={`flex flex-col border-t border-theme pt-2 min-h-0 gap-1.5 shrink-0 transition-all duration-300 ease-in-out ${
          isFeedCollapsed ? 'h-[36px]' : 'h-[165px]'
        }`}
      >
        <div
          onClick={() => setIsFeedCollapsed((prev) => !prev)}
          className="flex items-center justify-between text-xs font-black uppercase text-muted tracking-wider select-none cursor-pointer hover:text-main transition-colors px-0.5 group"
          title={
            isFeedCollapsed
              ? lang === 'zh'
                ? '点击展开课堂互动反馈流'
                : 'Click to expand feed'
              : lang === 'zh'
                ? '点击收起课堂互动反馈流'
                : 'Click to collapse feed'
          }
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <ChevronDown
              size={13}
              className={`text-muted group-hover:text-primary-ink transition-transform duration-200 shrink-0 ${
                isFeedCollapsed ? '-rotate-90' : 'rotate-0'
              }`}
            />
            <MessageSquare size={12} className="text-primary-ink shrink-0" />
            <span className="font-extrabold text-main text-xs truncate">
              {lang === 'zh' ? '课堂互动反馈流' : 'Live Feed'}
            </span>
            <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded-full bg-surface-secondary border border-theme text-muted shrink-0">
              {liveClassFeed.length}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {!isFeedCollapsed && (
              <button
                onClick={() =>
                  setLiveClassFeed([
                    {
                      id: 'clear',
                      time: new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      }),
                      type: 'info',
                      message: '反馈流已清空。',
                    },
                  ])
                }
                className="text-xs font-semibold hover:text-rose-700 dark:hover:text-rose-400 text-muted transition-colors flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-surface-secondary cursor-pointer"
                title={lang === 'zh' ? '清空互动反馈记录' : 'Clear feed'}
              >
                <Trash2 size={10} />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsFeedCollapsed((prev) => !prev)}
              className="text-xs text-muted hover:text-primary-ink font-medium cursor-pointer"
            >
              {isFeedCollapsed ? (lang === 'zh' ? '展开' : 'Expand') : lang === 'zh' ? '收起' : 'Collapse'}
            </button>
          </div>
        </div>

        {!isFeedCollapsed && (
          <div className="flex-1 bg-surface-secondary/70 border border-theme rounded-xl p-2 font-mono text-xs leading-relaxed overflow-y-auto space-y-1.5 select-text text-left text-main shadow-inner scrollbar-thin">
            {liveClassFeed.map((f) => (
              <div key={f.id} className="border-b border-theme pb-1 last:border-b-0">
                <div className="flex justify-between items-center text-muted font-bold mb-0.5">
                  <span className="text-[11px] font-mono">{f.time}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded uppercase tracking-wide text-[11px] ${
                      f.type === 'success'
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : f.type === 'warning'
                          ? 'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-surface text-muted border border-theme'
                    }`}
                  >
                    {f.type}
                  </span>
                </div>
                <p
                  className={
                    f.type === 'success'
                      ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                      : f.type === 'warning'
                        ? 'text-amber-700 dark:text-amber-300 font-medium'
                        : 'text-main'
                  }
                >
                  {f.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
