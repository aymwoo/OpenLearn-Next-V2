import type { Dispatch, SetStateAction } from 'react';
import type { StudentType, Lesson } from '../../types/app';
import { Activity, BookOpen, Minimize2, Maximize2 } from 'lucide-react';
import Markdown from 'react-markdown';

export interface StudentLessonContentPanelProps {
  students: StudentType[];
  activeStudentId: string | null;
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
}

export function StudentLessonContentPanel(props: StudentLessonContentPanelProps) {
  const {
    students,
    activeStudentId,
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
  } = props;
  return (
    <div className={`${
      isStudentLessonContentCollapsed 
        ? 'hidden' 
        : studentFullscreenPanel === 'left' 
          ? 'w-full' 
          : 'w-1/3 md:block hidden'
    } border-gray-100 pr-4 overflow-y-auto ${
      studentFullscreenPanel === 'right' ? 'hidden' : ''
    } ${
      studentFullscreenPanel === 'left' ? '' : 'border-r'
    } transition-all duration-300`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4 flex items-center justify-between pointer-events-auto shrink-0 select-none border-b border-gray-100 pb-2">
        <span className="flex items-center gap-1">
          <BookOpen size={14} className="text-indigo-500" /> Lesson Content (课程内容)
        </span>
        <button
          onClick={() => setStudentFullscreenPanel(p => p === 'left' ? 'none' : 'left')}
          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
          title={studentFullscreenPanel === 'left' ? "退出全屏" : "全屏"}
        >
          {studentFullscreenPanel === 'left' ? (
            <>
              <Minimize2 size={13} />
              <span className="text-[10px] font-medium">退出全屏</span>
            </>
          ) : (
            <>
              <Maximize2 size={13} />
              <span className="text-[10px] font-medium">全屏</span>
            </>
          )}
        </button>
      </div>
      <div className="prose prose-sm prose-indigo max-w-none">
        {/* Timeline Segments (Only when student is unlocked) */}
        {!students.find(s => s.id === activeStudentId)?.locked_lesson_id && timelineSegments.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/50 rounded-xl shadow-3xs text-left" onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-1 select-none">
              <Activity size={12} className="text-indigo-500" />
              {lang === 'zh' ? '教学环节 (点击切换)' : 'Timeline Segments'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {timelineSegments.map((seg, idx) => (
                <button
                  key={seg.id || idx}
                  onClick={() => setActiveSegmentId(seg.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer shadow-3xs ${seg.color} ${activeSegmentId === seg.id ? 'ring-2 ring-indigo-500 scale-[1.02] shadow-sm border-indigo-400 font-bold' : 'opacity-85 hover:opacity-100'}`}
                >
                  {seg.title} ({seg.duration})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Learning Progress Slider Feedback Widget */}
        <div className="mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 shadow-3xs flex flex-col gap-1.5 text-left select-none">
          <div className="flex justify-between items-center text-[10px] font-bold text-gray-500">
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
              className={`text-[9px] font-bold rounded-lg px-2 py-1 transition-all ${
                localProgressPercent === 100 
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : 'bg-white hover:bg-slate-50 text-slate-650 border border-slate-200 hover:border-indigo-200 shadow-3xs cursor-pointer'
              }`}
            >
              {lang === 'zh' ? '已完成' : 'Done'}
            </button>
          </div>
        </div>

        <Markdown>{lessons.find(l => l.id === selectedLesson)?.content || ''}</Markdown>
      </div>
    </div>
  );
}
