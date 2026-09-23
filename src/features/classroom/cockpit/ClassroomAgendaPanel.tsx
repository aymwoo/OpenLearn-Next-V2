import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Hourglass,
  Clock,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Check,
  Radio,
  FileText,
  FastForward,
  Info,
  X,
  Sparkles,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export interface TimelineSegment {
  id: string;
  title: string;
  duration: string | number; // e.g. "5m", "20m", 300
  notes?: string;
  completed?: boolean;
}

function parseDurationMinutes(dur: any): number {
  if (typeof dur === 'number') {
    return dur >= 60 ? Math.round(dur / 60) : dur;
  }
  const str = String(dur || '');
  const parsed = parseInt(str.replace(/\D/g, '') || '10', 10);
  return isNaN(parsed) ? 10 : parsed;
}

export function formatDurationLabel(dur: any): string {
  if (typeof dur === 'number') {
    if (dur >= 60) {
      return `${Math.round(dur / 60)}m`;
    }
    return `${dur}s`;
  }
  return String(dur || '');
}

export interface ClassroomAgendaPanelProps {
  timelineSegments: TimelineSegment[];
  activeSegmentId: string | null;
  onSelectSegment: (segment: TimelineSegment) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  lang?: 'zh' | 'en';
  timeRemaining: number;
  setTimeRemaining: (seconds: number) => void;
  isActive: boolean;
  setIsActive: (active: boolean) => void;
  syncChannel?: any;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomAgendaPanel({
  timelineSegments = [],
  activeSegmentId,
  onSelectSegment,
  isCollapsed,
  onToggleCollapse,
  lang = 'zh',
  timeRemaining,
  setTimeRemaining,
  isActive,
  setIsActive,
  syncChannel,
  addToast,
}: ClassroomAgendaPanelProps) {
  const [selectedNotesSegment, setSelectedNotesSegment] = useState<TimelineSegment | null>(null);

  // Default demo segments if empty
  const defaultSegments: TimelineSegment[] = useMemo(
    () => [
      {
        id: 'seg-1',
        title: lang === 'zh' ? '1. 开场引入与预习反馈' : '1. Introduction & Review',
        duration: '5m',
        notes: lang === 'zh' ? '已同步温习上一节条件分支代码与签到情况。重点关注昨夜作业提交错误率较高的第3题。' : 'Review previous conditional branching concepts.',
        completed: true,
      },
      {
        id: 'seg-2',
        title: lang === 'zh' ? '2. 讲授新课：循环嵌套结构' : '2. Concept: Nested Loops',
        duration: '20m',
        notes: lang === 'zh' ? '核心概念剖析：双重 for 循环与矩阵绘制语法示例。演示外层控制行数、内层控制列数的几何对应原理。' : 'Core concept: dual for loop and matrix coordinate mapping.',
        completed: false,
      },
      {
        id: 'seg-3',
        title: lang === 'zh' ? '3. 随堂编程互动练习' : '3. Interactive Coding Practice',
        duration: '15m',
        notes: lang === 'zh' ? '学生个人动手在沙箱中完成彩色螺旋网格绘制任务，巡回指导并关注后进生。' : 'Hands-on rainbow spiral coding practice in sandbox.',
        completed: false,
      },
      {
        id: 'seg-4',
        title: lang === 'zh' ? '4. 课堂总结与互评作业' : '4. Wrap-up & Peer Review',
        duration: '5m',
        notes: lang === 'zh' ? '学情数据回收、课堂优秀作业投屏大榜与布置课后拓展。完成 60 秒下课通票打卡。' : 'Class summary, leaderboard honors, and exit ticket collection.',
        completed: false,
      },
    ],
    [lang],
  );

  const displaySegments = timelineSegments.length > 0 ? timelineSegments : defaultSegments;
  const currentActiveSegment = displaySegments.find((s) => s.id === activeSegmentId) || displaySegments[1] || displaySegments[0];
  const activeSegmentIndex = displaySegments.findIndex((s) => s.id === (activeSegmentId || currentActiveSegment?.id));

  // Parse total duration
  const totalDurationMinutes = useMemo(() => {
    return displaySegments.reduce((sum, s) => {
      const mins = parseDurationMinutes(s.duration);
      return sum + mins;
    }, 0);
  }, [displaySegments]);

  // Segment duration total in seconds
  const segmentDurationSeconds = useMemo(() => {
    const mins = parseDurationMinutes(currentActiveSegment?.duration);
    return mins * 60;
  }, [currentActiveSegment]);

  // Timer formatted strings
  const formatTime = (secs: number) => {
    const m = Math.floor(Math.max(secs, 0) / 60)
      .toString()
      .padStart(2, '0');
    const s = (Math.max(secs, 0) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const currentDisplayTime = formatTime(timeRemaining > 0 ? timeRemaining : 8 * 60 + 45);
  const totalDisplayTime = formatTime(segmentDurationSeconds);

  const progressPercent = Math.min(
    Math.max(Math.round(((segmentDurationSeconds - (timeRemaining || 8 * 60 + 45)) / segmentDurationSeconds) * 100), 0),
    100,
  );

  // Timer Controls
  const handleToggleTimer = () => {
    setIsActive(!isActive);
    syncChannel?.broadcastSyncTimer(timeRemaining, !isActive);
  };

  const handleResetTimer = () => {
    setTimeRemaining(segmentDurationSeconds);
    setIsActive(true);
    syncChannel?.broadcastSyncTimer(segmentDurationSeconds, true);
    addToast?.(lang === 'zh' ? '倒计时已重置' : 'Timer Reset', lang === 'zh' ? '当前教学环节倒计时已重置' : 'Reset timer', 'info');
  };

  const handleAddCompensation = () => {
    const newRemaining = timeRemaining + 120;
    setTimeRemaining(newRemaining);
    syncChannel?.broadcastSyncTimer(newRemaining, isActive);
    addToast?.(
      lang === 'zh' ? '已补时 +2 分钟' : '+2m Extra Time',
      lang === 'zh' ? '为当前教学环节额外增加 120 秒' : 'Added 120 seconds',
      'success',
    );
  };

  if (isCollapsed) {
    return (
      <aside className="w-10 bg-surface border-r border-border flex flex-col items-center py-3 shrink-0 select-none">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition cursor-pointer"
          title={lang === 'zh' ? '展开教学步骤与时间管理' : 'Expand Agenda'}
        >
          <ChevronRight size={16} />
        </button>
        <div className="mt-8 [writing-mode:vertical-lr] text-xs font-bold text-muted tracking-widest flex items-center gap-2">
          <Hourglass size={12} className="text-indigo-600 dark:text-indigo-400 rotate-90" />
          <span>{lang === 'zh' ? '教学环节与时间' : 'Agenda & Timer'}</span>
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside
        className="w-72 bg-surface border-r border-border flex flex-col shrink-0 select-none shadow-3xs"
        data-purpose="agenda-and-timer-panel"
      >
        {/* ── Section Header (Stitch Screen 1219a481) ── */}
        <div className="p-3.5 border-b border-border/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hourglass size={16} className="text-indigo-600 dark:text-indigo-400 stroke-[2.5]" />
            <h2 className="font-bold text-foreground text-xs tracking-wide">
              {lang === 'zh' ? '教学步骤与时间管理' : 'Lesson Schedule & Timer'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-surface-secondary transition cursor-pointer"
            title={lang === 'zh' ? '收起面板' : 'Collapse Panel'}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* ── Live Digital Countdown Widget (Stitch Screen 1219a481) ── */}
        <div className="p-3.5 bg-surface-secondary/50 border-b border-border/80">
          <div className="bg-surface rounded-xl p-3.5 border border-border shadow-3xs">
            <div className="flex items-center justify-between text-xs text-muted mb-1">
              <span className="flex items-center gap-1 font-medium text-[11px]">
                <Clock size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span>{lang === 'zh' ? '当前环节剩余时间' : 'Segment Time Left'}</span>
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800'
                    : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800'
                }`}
              >
                {isActive ? (lang === 'zh' ? '进行中' : 'Active') : lang === 'zh' ? '已暂停' : 'Paused'}
              </span>
            </div>

            {/* Timer Display */}
            <div className="text-center my-2.5">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground">
                {currentDisplayTime}
              </span>
              <span className="text-xs text-muted ml-1.5 font-mono">/ {totalDisplayTime}</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-surface-secondary rounded-full h-1.5 mb-3 overflow-hidden border border-border/40">
              <div
                className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Timer Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleTimer}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {isActive ? <Pause size={12} className="fill-white" /> : <Play size={12} className="fill-white" />}
                <span>{isActive ? (lang === 'zh' ? '暂停' : 'Pause') : lang === 'zh' ? '开始' : 'Start'}</span>
              </button>

              <button
                type="button"
                onClick={handleResetTimer}
                className="px-3 py-1.5 bg-surface-secondary hover:bg-surface text-muted hover:text-foreground border border-border rounded-lg text-xs font-medium transition cursor-pointer"
                title={lang === 'zh' ? '重置本环节倒计时' : 'Reset Timer'}
              >
                <RotateCcw size={12} />
              </button>

              <button
                type="button"
                onClick={handleAddCompensation}
                className="px-3 py-1.5 bg-surface-secondary hover:bg-surface text-foreground border border-border rounded-lg text-xs font-bold transition cursor-pointer"
                title={lang === 'zh' ? '+2分钟补时' : '+2m Extra Time'}
              >
                +2m
              </button>
            </div>
          </div>
        </div>

        {/* ── Agenda Step Cards List (Stitch Screen 1219a481) ── */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 custom-scrollbar">
          <div className="flex items-center justify-between text-[11px] font-bold text-muted uppercase tracking-wider px-1">
            <span>{lang === 'zh' ? '教学环节进度表' : 'Agenda Timeline'}</span>
            <span className="font-mono">{lang === 'zh' ? `总时长 ${totalDurationMinutes}m` : `Total ${totalDurationMinutes}m`}</span>
          </div>

          {displaySegments.map((seg, idx) => {
            const isCompleted = idx < activeSegmentIndex;
            const isActive = idx === activeSegmentIndex;

            if (isCompleted) {
              // State 1: Completed Step (Stitch Screen 1219a481)
              return (
                <div
                  key={seg.id}
                  className="p-3 rounded-xl border border-border bg-surface-secondary/40 opacity-75 hover:opacity-100 transition"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center justify-center">
                        <Check size={9} className="stroke-[3]" />
                      </span>
                      <h3 className="text-xs font-bold text-foreground truncate max-w-[170px]">{seg.title}</h3>
                    </div>
                    <span className="text-[11px] text-muted font-mono">{formatDurationLabel(seg.duration)}</span>
                  </div>
                  <p className="text-[11px] text-muted pl-5 mb-2 leading-relaxed line-clamp-2">
                    {seg.notes || '环节顺利完成'}
                  </p>
                  <div className="pl-5 flex items-center gap-2">
                    <span className="text-[10px] bg-surface-secondary text-muted px-2 py-0.5 rounded font-medium border border-border/60">
                      {lang === 'zh' ? '已完成' : 'Completed'}
                    </span>
                  </div>
                </div>
              );
            }

            if (isActive) {
              // State 2: Active Step (Indigo border-2, current sync pill, notes button)
              return (
                <div
                  key={seg.id}
                  className="p-3 rounded-xl border-2 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-xs relative"
                >
                  <div className="absolute -top-2 right-2 bg-indigo-600 text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shadow-xs">
                    {lang === 'zh' ? '当前同步中' : 'Broadcasting'}
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <h3 className="text-xs font-bold text-indigo-950 dark:text-indigo-100 truncate max-w-[170px]">
                        {seg.title}
                      </h3>
                    </div>
                    <span className="text-[11px] text-indigo-700 dark:text-indigo-300 font-mono font-semibold">
                      {formatDurationLabel(seg.duration)}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/80 pl-5 mb-2.5 leading-relaxed line-clamp-2">
                    {seg.notes || '核心概念讲解与师生互动。'}
                  </p>
                  <div className="pl-5 flex items-center gap-2">
                    <button
                      type="button"
                      className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold flex items-center gap-1 shadow-xs hover:bg-indigo-700 cursor-pointer"
                    >
                      <Radio size={11} className="animate-pulse" />
                      <span>{lang === 'zh' ? '同步演示中' : 'Broadcasting'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedNotesSegment(seg)}
                      className="px-2 py-1 rounded bg-surface border border-border text-foreground hover:bg-surface-secondary text-[11px] font-medium transition cursor-pointer"
                    >
                      {lang === 'zh' ? '课件附注' : 'Notes'}
                    </button>
                  </div>
                </div>
              );
            }

            // State 3: Upcoming Steps (Stitch Screen 1219a481)
            return (
              <div
                key={seg.id}
                className="p-3 rounded-xl border border-border bg-surface hover:border-indigo-300 dark:hover:border-indigo-700 transition group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-surface-secondary text-muted text-[10px] font-bold flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900 group-hover:text-indigo-600">
                      {idx + 1}
                    </span>
                    <h3 className="text-xs font-semibold text-foreground truncate max-w-[170px]">{seg.title}</h3>
                  </div>
                  <span className="text-[11px] text-muted font-mono">{formatDurationLabel(seg.duration)}</span>
                </div>
                <p className="text-[11px] text-muted pl-5 mb-2 line-clamp-2">{seg.notes || '待进行的教学环节。'}</p>
                <div className="pl-5">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSegment(seg);
                      addToast?.(
                        lang === 'zh' ? '已转入新环节' : 'Advanced to Step',
                        lang === 'zh' ? `已将教学环节切换为【${seg.title}】` : `Switched to ${seg.title}`,
                        'info',
                      );
                    }}
                    className="px-2 py-0.5 rounded border border-border text-muted hover:border-indigo-400 hover:text-indigo-600 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer"
                  >
                    <FastForward size={11} />
                    <span>{lang === 'zh' ? '提前广播此环节' : 'Broadcast Step'}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Third-Party Plugin Agenda Action Slot */}
          <ExtensionPointRenderer slot="classroom.agenda.action" />
        </div>
      </aside>

      {/* ── Teaching Notes Modal (课件附注详情) ── */}
      {selectedNotesSegment && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedNotesSegment(null);
          }}
        >
          <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-indigo-600" />
                <h3 className="font-bold text-sm text-foreground">
                  {lang === 'zh' ? '课件备课附注与教学指导' : 'Teaching Notes & Guide'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNotesSegment(null)}
                className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {selectedNotesSegment.title}
              </span>
              <p className="mt-2 text-xs text-foreground/80 leading-relaxed bg-surface-secondary p-3 rounded-xl border border-border">
                {selectedNotesSegment.notes || (lang === 'zh' ? '该环节暂无额外备课笔记。' : 'No notes available.')}
              </p>
            </div>

            <div className="text-[11px] text-muted flex items-center gap-1.5">
              <Sparkles size={12} className="text-amber-500" />
              <span>{lang === 'zh' ? '提示：课件附注仅教师端可见，不会投射至大屏展台与学生机。' : 'Private teacher notes.'}</span>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setSelectedNotesSegment(null)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold"
              >
                {lang === 'zh' ? '关闭' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
