import React from 'react';
import { Plus, Settings2, ChevronRight, FileText, CalendarClock, Clock, CheckCircle2, GripVertical } from 'lucide-react';
import {
  SEGMENT_COLORS,
  DEFAULT_SEGMENT_COLOR,
  getSegmentType,
  getSegmentColor,
} from './timelineConfig';

interface TimelineRailProps {
  lang: 'zh' | 'en';
  segments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string | null) => void;
  draggedSegmentIdx: number | null;
  setDraggedSegmentIdx: (idx: number | null) => void;
  selectedLesson: string | null;
  saveTimeline: (lessonId: string, segments: any[]) => void;
  editorPanelsExpanded: boolean;
  setEditorPanelsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

export function TimelineRail({
  lang,
  segments,
  activeSegmentId,
  setActiveSegmentId,
  draggedSegmentIdx,
  setDraggedSegmentIdx,
  selectedLesson,
  saveTimeline,
  editorPanelsExpanded,
  setEditorPanelsExpanded,
}: TimelineRailProps) {
  const activeIdx = segments.findIndex((s) => s.id === activeSegmentId);
  const progressPct =
    segments.length > 1 ? (activeIdx >= 0 ? activeIdx / (segments.length - 1) : 0) : 0;
  const activeColorMeta = activeIdx >= 0 ? getSegmentColor(segments[activeIdx].color) : null;

  const handleReorder = (toIdx: number) => {
    if (draggedSegmentIdx === null || draggedSegmentIdx === toIdx) {
      setDraggedSegmentIdx(null);
      return;
    }
    const next = [...segments];
    const [removed] = next.splice(draggedSegmentIdx, 1);
    next.splice(toIdx, 0, removed);
    setDraggedSegmentIdx(null);
    if (selectedLesson) saveTimeline(selectedLesson, next);
  };

  const handleAdd = () => {
    if (!selectedLesson) return;
    const newSegId = 'seg-' + Math.random().toString(36).slice(2, 9);
    const newSeg = {
      id: newSegId,
      title: lang === 'zh' ? `新环节 ${segments.length + 1}` : `Segment ${segments.length + 1}`,
      notes: '',
      type: 'lecture',
      duration: '10m',
      color: DEFAULT_SEGMENT_COLOR,
    };
    saveTimeline(selectedLesson, [...segments, newSeg]);
    setActiveSegmentId(newSegId);
  };

  return (
    <div className="relative flex items-center gap-3 px-3 py-1.5 border-b border-slate-200/80 bg-slate-50/70 shrink-0 overflow-x-auto select-none">
      {/* Label */}
      <div className="flex items-center gap-1.5 shrink-0 pl-1 border-r border-slate-200/80 pr-2.5">
        <CalendarClock size={15} className="text-indigo-600 shrink-0" />
        <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 whitespace-nowrap">
          {lang === 'zh' ? '教学流程' : 'Lesson Flow'}
        </span>
      </div>

      {/* Rail + nodes */}
      <div className="relative flex items-center gap-1.5 py-0.5 min-w-0 flex-1">
        {/* background rail */}
        <div className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 bg-slate-200 rounded-full" />
        {/* progress rail */}
        {activeIdx >= 0 && (
          <div
            className={`absolute left-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-all duration-300 ${activeColorMeta?.rail || 'bg-indigo-500'}`}
            style={{ width: `calc(${progressPct * 100}% - 0.5rem)` }}
          />
        )}

        {segments.map((seg, idx) => {
          const isActive = seg.id === activeSegmentId;
          const isCompleted = activeIdx >= 0 && idx < activeIdx;
          const isDragging = draggedSegmentIdx === idx;
          const typeMeta = getSegmentType(seg.type);
          const colorMeta = getSegmentColor(seg.color);
          const Icon = typeMeta.icon;
          const nodeCls = isActive
            ? colorMeta.solid + ' shadow-md shadow-indigo-500/20 ring-2 ring-indigo-400/30'
            : isCompleted
            ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200/80'
            : `${seg.color} hover:shadow-sm hover:brightness-105`;

          return (
            <React.Fragment key={seg.id}>
              <button
                draggable
                onDragStart={(e) => {
                  setDraggedSegmentIdx(idx);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', idx.toString());
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleReorder(idx);
                }}
                onClick={() => setActiveSegmentId(seg.id)}
                title={
                  `${seg.title} · ${seg.duration}${seg.notes ? ' · 📝' : ''}` +
                  (lang === 'zh' ? '（点击编辑 / 拖拽排序）' : ' (click to edit / drag to reorder)')
                }
                className={`relative z-10 group flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-xs font-semibold cursor-grab active:cursor-grabbing transition-all duration-200 ${isDragging ? 'opacity-40 border-dashed scale-95' : ''} ${nodeCls}`}
              >
                <GripVertical size={11} className={`opacity-0 group-hover:opacity-60 transition-opacity -mr-1 ${isActive ? 'text-white' : 'text-slate-400'}`} />

                {/* sequence number or check */}
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${
                    isActive
                      ? 'bg-white/25 text-white'
                      : isCompleted
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 size={11} /> : idx + 1}
                </span>

                <Icon size={13} className="shrink-0" />

                {/* Segment Title */}
                <span className="max-w-[110px] truncate font-medium">{seg.title}</span>

                {/* Duration Badge */}
                {seg.duration && (
                  <span className={`text-[10px] px-1 py-0.2 rounded font-mono font-normal flex items-center gap-0.5 ${isActive ? 'bg-black/20 text-white' : 'bg-black/5 text-slate-500'}`}>
                    <Clock size={9} />
                    {seg.duration}
                  </span>
                )}

                {seg.notes && (
                  <FileText
                    size={10}
                    className={`shrink-0 ${isActive ? 'text-white/90' : 'text-amber-500'}`}
                  />
                )}

                {/* Status indicator */}
                {isActive && (
                  <span className="flex items-center gap-1 ml-0.5 pl-1.5 border-l border-white/30 text-[10px] font-extrabold uppercase tracking-wide shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {lang === 'zh' ? '进行中' : 'LIVE'}
                  </span>
                )}
              </button>
              {idx < segments.length - 1 && (
                <ChevronRight size={12} className="text-slate-300 shrink-0 z-10" />
              )}
            </React.Fragment>
          );
        })}

        {selectedLesson && (
          <button
            onClick={handleAdd}
            className="relative z-10 shrink-0 ml-1 px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
            title={lang === 'zh' ? '新增教学环节' : 'Add flow segment'}
          >
            <Plus size={13} />
            <span className="text-[11px]">{lang === 'zh' ? '添加环节' : 'Add Step'}</span>
          </button>
        )}
      </div>

      {/* Settings toggle */}
      <button
        onClick={() => setEditorPanelsExpanded((p) => !p)}
        className="ml-auto shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
      >
        <Settings2 size={13} className={editorPanelsExpanded ? 'text-indigo-600' : 'text-slate-400'} />
        <span>
          {editorPanelsExpanded
            ? lang === 'zh'
              ? '隐藏环节编辑'
              : 'Hide Details'
            : lang === 'zh'
              ? '展开环节编辑'
              : 'Edit Step'}
        </span>
      </button>
    </div>
  );
}

