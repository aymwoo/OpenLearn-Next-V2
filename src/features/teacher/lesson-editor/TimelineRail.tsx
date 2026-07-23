import React from 'react';
import { Plus, Settings2, ChevronRight, FileText, CalendarClock } from 'lucide-react';
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
    <div className="relative flex items-center gap-2 px-3 py-1 border-b border-gray-100 bg-white shrink-0 overflow-x-auto">
      {/* Label */}
      <div className="flex items-center gap-2 shrink-0">
        <CalendarClock size={14} className="text-indigo-600" />
        <span className="text-[13px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
          {lang === 'zh' ? '课程时间线' : 'Lesson Timeline'}
        </span>
      </div>

      {/* Rail + nodes */}
      <div className="relative flex items-center gap-1 py-1 pl-1 pr-1">
        {/* background rail */}
        <div className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 bg-gray-200 rounded-full" />
        {/* progress rail */}
        {activeIdx >= 0 && (
          <div
            className={`absolute left-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-all duration-300 ${activeColorMeta?.rail}`}
            style={{ width: `calc(${progressPct * 100}% - 0.5rem)` }}
          />
        )}

        {segments.map((seg, idx) => {
          const isActive = seg.id === activeSegmentId;
          const isDragging = draggedSegmentIdx === idx;
          const typeMeta = getSegmentType(seg.type);
          const colorMeta = getSegmentColor(seg.color);
          const Icon = typeMeta.icon;
          const nodeCls = isActive
            ? colorMeta.solid
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
                className={`relative z-10 group flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border text-[13px] font-medium cursor-grab active:cursor-grabbing transition-all duration-200 ${isDragging ? 'opacity-40 border-dashed' : ''} ${nodeCls}`}
              >
                {/* sequence number */}
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-full text-[11px] font-bold shrink-0 ${
                    isActive ? 'bg-white/25 text-white' : 'bg-white text-gray-500 border border-gray-200'
                  }`}
                >
                  {idx + 1}
                </span>
                <Icon size={13} className="shrink-0" />
                {seg.notes && (
                  <FileText
                    size={10}
                    className={`shrink-0 ${isActive ? 'text-white/80' : 'text-amber-500'}`}
                  />
                )}
                {isActive && (
                  <span className="flex items-center gap-0.5 ml-0 pl-1 border-l border-white/40 text-[10px] font-bold uppercase tracking-wide shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {lang === 'zh' ? '演示中' : 'LIVE'}
                  </span>
                )}
              </button>
              {idx < segments.length - 1 && (
                <ChevronRight size={12} className="text-gray-300 shrink-0 z-10" />
              )}
            </React.Fragment>
          );
        })}

        {selectedLesson && (
          <button
            onClick={handleAdd}
            className="relative z-10 shrink-0 ml-1 px-2 py-1 rounded-full border border-dashed border-gray-300 text-[11px] font-semibold text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 transition-colors flex items-center gap-1 cursor-pointer"
            title={lang === 'zh' ? '新增环节' : 'Add segment'}
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {/* Settings toggle */}
      <button
        onClick={() => setEditorPanelsExpanded((p) => !p)}
        className="ml-auto shrink-0 px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-gray-600 text-[11px] font-semibold rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
      >
        <Settings2 size={12} className={editorPanelsExpanded ? 'text-indigo-600' : 'text-gray-500'} />
        <span>
          {editorPanelsExpanded
            ? lang === 'zh'
              ? '隐藏设置'
              : 'Hide'
            : lang === 'zh'
              ? '展开设置'
              : 'Show'}
        </span>
      </button>
    </div>
  );
}
