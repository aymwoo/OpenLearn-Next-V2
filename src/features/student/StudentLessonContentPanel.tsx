import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import type { StudentType, Lesson } from '../../types/app';
import { Activity, BookOpen, Minimize2, Maximize2, Lock, ShieldAlert, CheckCircle2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { useLessonEngineStore } from '../lesson-engine/lessonEngineStore.js';
import { frontendEventBus } from '../../services/event-bus.js';

export interface StudentLessonContentPanelProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** 全班专注锁定中：学生端进入只读跟随模式 */
  isStudentLocked?: boolean;
  studentFullscreenPanel: 'left' | 'right' | 'none';
  setStudentFullscreenPanel: Dispatch<SetStateAction<'left' | 'right' | 'none'>>;
  timelineSegments: any[];
  lang: 'zh' | 'en';
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string) => void;
  localProgressPercent: number;
  setLocalProgressPercent: (v: number) => void;
  updateStudentProgress: (percent: number) => void;
  selectedLesson: string | null;
  lessons: Lesson[];
  isStudentLessonContentCollapsed?: boolean;
  addToast?: (title: string, description: string, type: string) => void;
}

export function StudentLessonContentPanel(props: StudentLessonContentPanelProps) {
  const {
    students,
    activeStudentId,
    isStudentLocked = false,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    timelineSegments,
    lang,
    activeSegmentId,
    setActiveSegmentId,
    localProgressPercent,
    setLocalProgressPercent,
    updateStudentProgress,
    selectedLesson,
    lessons,
    isStudentLessonContentCollapsed,
    addToast,
  } = props;

  const checkStageAccess = useLessonEngineStore((s) => s.checkStageAccess);

  // 记录未满足门禁条件被拦截的提示状态
  const [blockedNotice, setBlockedNotice] = useState<{
    segmentId: string;
    segmentTitle: string;
    reason: string;
  } | null>(null);

  // 记录各环节访问权限缓存状态 (segmentId -> { allowed: boolean; reason?: string })
  const [accessStateMap, setAccessStateMap] = useState<Record<string, { allowed: boolean; reason?: string }>>({});

  // 批量异步预检查各环节门禁状态
  const refreshStageAccess = useCallback(async () => {
    if (!timelineSegments || timelineSegments.length === 0) return;
    const currentStudent = activeStudentId || undefined;

    const updates: Record<string, { allowed: boolean; reason?: string }> = {};
    for (const seg of timelineSegments) {
      if (!seg.id) continue;
      const res = await checkStageAccess(seg.id, currentStudent);
      updates[seg.id] = { allowed: res.allowed, reason: res.reason };
    }
    setAccessStateMap(updates);
  }, [timelineSegments, activeStudentId, checkStageAccess]);

  useEffect(() => {
    refreshStageAccess();
  }, [refreshStageAccess]);

  // 监听测验提交或作业提交事件，自动重新评估门禁状态
  useEffect(() => {
    const handleRevalidate = () => {
      refreshStageAccess();
    };

    const unsubQuiz = frontendEventBus.subscribe('QuizSubmitted', handleRevalidate);
    const unsubAssignment = frontendEventBus.subscribe('assignment.submitted', handleRevalidate);

    return () => {
      unsubQuiz();
      unsubAssignment();
    };
  }, [refreshStageAccess]);

  // 点击环节处理（带门禁拦截）
  const handleSegmentClick = async (seg: any) => {
    if (activeSegmentId === seg.id) return;

    const currentStudent = activeStudentId || undefined;
    const res = await checkStageAccess(seg.id, currentStudent);

    if (!res.allowed) {
      const reasonMsg = res.reason || (lang === 'zh' ? '尚未满足进入该环节的前置条件' : 'Prerequisite conditions not met');
      setBlockedNotice({
        segmentId: seg.id,
        segmentTitle: seg.title || seg.id,
        reason: reasonMsg,
      });

      if (addToast) {
        addToast(
          lang === 'zh' ? '暂未解锁该教学环节' : 'Stage Locked',
          reasonMsg,
          'warning',
        );
      }
      return;
    }

    // 达成条件，清除拦截提示并正常跳转
    setBlockedNotice(null);
    setActiveSegmentId(seg.id);
  };
  return (
    <div
      className={`${
        isStudentLessonContentCollapsed
          ? 'hidden'
          : studentFullscreenPanel === 'left'
            ? 'w-full'
            : 'w-1/3 md:block hidden'
      } border-gray-100 pr-4 overflow-y-auto ${studentFullscreenPanel === 'right' ? 'hidden' : ''} ${
        studentFullscreenPanel === 'left' ? '' : 'border-r'
      } transition-all duration-300`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4 flex items-center justify-between pointer-events-auto shrink-0 select-none border-b border-gray-100 pb-2">
        <span className="flex items-center gap-1">
          <BookOpen size={14} className="text-indigo-500" /> Lesson Content (课程内容)
        </span>
        <button
          onClick={() => setStudentFullscreenPanel((p) => (p === 'left' ? 'none' : 'left'))}
          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
          title={studentFullscreenPanel === 'left' ? '退出全屏' : '全屏'}
        >
          {studentFullscreenPanel === 'left' ? (
            <>
              <Minimize2 size={13} />
              <span className="text-xs font-medium">退出全屏</span>
            </>
          ) : (
            <>
              <Maximize2 size={13} />
              <span className="text-xs font-medium">全屏</span>
            </>
          )}
        </button>
      </div>
      <div className="prose prose-sm prose-indigo max-w-none">
        {/* Timeline Segments (Only when student is unlocked) */}
        {!isStudentLocked &&
          !students.find((s) => s.id === activeStudentId)?.locked_lesson_id &&
          timelineSegments.length > 0 && (
            <div
              className="mb-4 flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/50 rounded-xl shadow-3xs text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-1 select-none">
                <Activity size={12} className="text-indigo-500" />
                {lang === 'zh' ? '教学环节 (点击切换)' : 'Timeline Segments'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {timelineSegments.map((seg, idx) => {
                  const access = accessStateMap[seg.id];
                  const isLocked = access?.allowed === false;
                  const isActive = activeSegmentId === seg.id;

                  return (
                    <button
                      key={seg.id || idx}
                      onClick={() => handleSegmentClick(seg)}
                      title={isLocked ? `未解锁: ${access.reason || '未满足前置条件'}` : undefined}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer shadow-3xs flex items-center gap-1.5 ${
                        seg.color
                      } ${
                        isActive
                          ? 'ring-2 ring-indigo-500 scale-[1.02] shadow-sm border-indigo-400 font-bold'
                          : isLocked
                            ? 'opacity-70 hover:opacity-90 border-dashed border-amber-300'
                            : 'opacity-85 hover:opacity-100'
                      }`}
                    >
                      {isLocked && <Lock size={11} className="text-amber-600 shrink-0" />}
                      <span>
                        {seg.title} ({seg.duration})
                      </span>
                    </button>
                  );
                })}
              </div>

              {blockedNotice && (
                <div className="mt-2.5 p-2.5 bg-amber-50/90 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800 animate-in fade-in slide-in-from-top-1 duration-200">
                  <ShieldAlert size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 leading-snug">
                    <span className="font-bold">【{blockedNotice.segmentTitle}】暂未解锁：</span>
                    <span>{blockedNotice.reason}</span>
                  </div>
                  <button
                    onClick={() => setBlockedNotice(null)}
                    className="text-amber-500 hover:text-amber-700 font-bold text-xs cursor-pointer ml-1 px-1 rounded hover:bg-amber-100"
                    title={lang === 'zh' ? '关闭' : 'Dismiss'}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

        {/* Learning Progress Slider Feedback Widget */}
        <div className="mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 shadow-3xs flex flex-col gap-1.5 text-left select-none">
          <div className="flex justify-between items-center text-xs font-bold text-gray-500">
            <span className="flex items-center gap-1">
              <Activity size={12} className="text-indigo-500 animate-pulse" />
              {lang === 'zh' ? '自主学习进度反馈' : 'Learning Progress'}
            </span>
            <span className="font-mono text-indigo-600 font-extrabold">{localProgressPercent}%</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              value={localProgressPercent}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setLocalProgressPercent(val);
              }}
              onMouseUp={() => updateStudentProgress(localProgressPercent)}
              onTouchEnd={() => updateStudentProgress(localProgressPercent)}
              className="flex-grow h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <button
              onClick={() => {
                setLocalProgressPercent(100);
                updateStudentProgress(100);
              }}
              className={`text-xs font-bold rounded-lg px-2 py-1 transition-all ${
                localProgressPercent === 100
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : 'bg-white hover:bg-slate-50 text-slate-650 border border-slate-200 hover:border-indigo-200 shadow-3xs cursor-pointer'
              }`}
            >
              {lang === 'zh' ? '已完成' : 'Done'}
            </button>
          </div>
        </div>

        <Markdown>{lessons.find((l) => l.id === selectedLesson)?.content || ''}</Markdown>
      </div>
    </div>
  );
}
