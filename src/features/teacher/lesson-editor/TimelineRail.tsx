import React from 'react';
import {
  Plus,
  Settings2,
  CalendarClock,
  Clock,
  CheckCircle2,
  GripVertical,
} from 'lucide-react';
import { DEFAULT_SEGMENT_COLOR, getSegmentType, getSegmentColor } from './timelineConfig';

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
  const progressPct = segments.length > 1 ? (activeIdx >= 0 ? activeIdx / (segments.length - 1) : 0) : 0;
  const activeColorMeta = activeIdx >= 0 ? getSegmentColor(segments[activeIdx].color) : null;

  // 计算总时长
  const totalMinutes = segments.reduce((sum, seg) => {
    const raw = String(seg.duration || '10m');
    const num = parseInt(raw.replace(/[^\d]/g, ''), 10) || 10;
    return sum + num;
  }, 0);

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
    <div className="relative flex items-center justify-between gap-3 px-3.5 py-2 border-b border-theme bg-surface-secondary/50 backdrop-blur-xs shrink-0 select-none overflow-x-auto text-main">
      {/* 左侧流程标签与总时长 */}
      <div className="flex items-center gap-2 shrink-0 border-r border-theme pr-3">
        <div className="w-6 h-6 rounded-lg bg-primary-theme/10 text-primary-theme flex items-center justify-center">
          <CalendarClock size={14} />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-black uppercase tracking-wider text-main whitespace-nowrap">
            {lang === 'zh' ? '教学流程' : 'Lesson Flow'}
          </span>
          <span className="text-[10px] font-mono text-muted flex items-center gap-0.5">
            <Clock size={9} />
            <span>{totalMinutes} min</span>
          </span>
        </div>
      </div>

      {/* 中间流程导轨与节点 */}
      <div className="relative flex items-center gap-2 py-0.5 min-w-0 flex-1">
        {/* 背景底轨 */}
        <div className="absolute left-3 right-3 top-1/2 h-0.5 -translate-y-1/2 bg-border/80 rounded-full" />
        {/* 活动进度轨 */}
        {activeIdx >= 0 && (
          <div
            className={`absolute left-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-all duration-300 ${activeColorMeta?.rail || 'bg-primary-theme'}`}
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
            ? colorMeta.solid + ' shadow-md ring-2 ring-primary-theme/30 scale-105'
            : isCompleted
              ? 'bg-surface-secondary/90 text-main/80 border-primary-theme/30'
              : colorMeta.color;

          return (
            <div
              key={seg.id}
              draggable
              onDragStart={(e) => {
                setDraggedSegmentIdx(idx);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleReorder(idx)}
              onClick={() => setActiveSegmentId(seg.id)}
              className={`relative z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 border border-theme/60 shadow-2xs group ${nodeCls} ${
                isDragging ? 'opacity-40 scale-95' : 'hover:scale-102'
              }`}
            >
              <GripVertical
                size={11}
                className="opacity-0 group-hover:opacity-60 -ml-0.5 text-muted cursor-grab"
              />
              <span className="text-[10px] font-mono font-bold opacity-75">{idx + 1}</span>
              <Icon size={12} className="shrink-0" />
              <span className="truncate max-w-[90px]">{seg.title}</span>
              <span className="text-[10px] font-mono opacity-60">({seg.duration || '10m'})</span>
              {isCompleted && <CheckCircle2 size={11} className="text-emerald-500 shrink-0 ml-0.5" />}
            </div>
          );
        })}

        {/* 添加新环节按钮 */}
        {selectedLesson && (
          <button
            type="button"
            onClick={handleAdd}
            className="relative z-10 flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-medium text-muted hover:text-primary-theme bg-surface hover:bg-surface-secondary border border-dashed border-theme hover:border-primary-theme transition-all cursor-pointer shadow-2xs"
            title={lang === 'zh' ? '追加新环节' : 'Add new segment'}
          >
            <Plus size={12} />
            <span className="hidden sm:inline">{lang === 'zh' ? '加环节' : 'Add'}</span>
          </button>
        )}
      </div>

      {/* 右侧抽屉展开控制 */}
      <button
        type="button"
        onClick={() => setEditorPanelsExpanded((prev) => !prev)}
        className={`px-3 py-1 text-xs font-bold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
          editorPanelsExpanded
            ? 'bg-primary-theme text-white border-primary-theme shadow-md shadow-primary-theme/30 ring-2 ring-primary-theme/30 scale-102'
            : 'bg-surface hover:bg-surface-secondary text-muted hover:text-main border-theme shadow-2xs'
        }`}
        title={lang === 'zh' ? '展开/收起环节设置面板' : 'Toggle Segment Settings'}
      >
        <Settings2 size={13} className={editorPanelsExpanded ? 'rotate-90 transition-transform text-white' : ''} />
        <span>{lang === 'zh' ? '环节参数' : 'Settings'}</span>
        {editorPanelsExpanded && (
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping ml-0.5" />
        )}
      </button>
    </div>
  );
}
