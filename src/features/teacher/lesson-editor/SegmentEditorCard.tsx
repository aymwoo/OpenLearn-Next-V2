import React from 'react';
import { Trash2, FileText } from 'lucide-react';
import { SEGMENT_TYPES, SEGMENT_COLORS } from './timelineConfig';

interface SegmentEditorCardProps {
  lang: 'zh' | 'en';
  segment: any;
  onPatch: (patch: Record<string, any>) => void;
  onDelete: () => void;
}

export function SegmentEditorCard({ lang, segment, onPatch, onDelete }: SegmentEditorCardProps) {
  return (
    <div className="flex flex-col gap-2 p-2 bg-slate-50/80 border-b border-gray-100 shrink-0">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        <span className="text-xs font-bold text-gray-700">
          {lang === 'zh' ? `环节设置：${segment.title}` : `Segment: ${segment.title}`}
        </span>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {lang === 'zh' ? '名称' : 'Title'}
          </span>
          <input
            type="text"
            value={segment.title || ''}
            onChange={(e) => onPatch({ title: e.target.value })}
            className="border border-gray-200 px-2 py-1 rounded-lg bg-white text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {lang === 'zh' ? '时长' : 'Duration'}
          </span>
          <input
            type="text"
            value={segment.duration || '10m'}
            onChange={(e) => onPatch({ duration: e.target.value })}
            className="border border-gray-200 px-2 py-1 rounded-lg bg-white text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {lang === 'zh' ? '类型' : 'Type'}
          </span>
          <select
            value={segment.type || 'lecture'}
            onChange={(e) => onPatch({ type: e.target.value })}
            className="border border-gray-200 px-2 py-1 rounded-lg bg-white text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            {SEGMENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {lang === 'zh' ? t.labelZh : t.labelEn}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {lang === 'zh' ? '配色' : 'Color'}
          </span>
          <div className="flex items-center gap-1.5 pt-1">
            {SEGMENT_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => onPatch({ color: c.color })}
                className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                  c.color.split(' ')[0]
                } ${segment.color === c.color ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                title={c.name}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
          <FileText size={12} className="text-amber-500" />
          {lang === 'zh' ? '环节备注 & 教学提示' : 'Instructional Notes'}
        </span>
        <textarea
          rows={2}
          value={segment.notes || ''}
          onChange={(e) => onPatch({ notes: e.target.value })}
          placeholder={
            lang === 'zh'
              ? '教学要点、学生互动提示、教学设计分配…'
              : 'Teaching points, student interaction hints…'
          }
          className="w-full border border-gray-200 px-2 py-1 rounded-lg bg-white text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 placeholder:text-gray-400 placeholder:italic resize-y"
        />
      </div>

      {/* Delete */}
      <div className="flex justify-end">
        <button
          onClick={onDelete}
          className="text-red-500 hover:text-red-700 font-semibold hover:underline flex items-center gap-1 cursor-pointer text-xs"
        >
          <Trash2 size={12} /> {lang === 'zh' ? '删除此环节' : 'Delete segment'}
        </button>
      </div>
    </div>
  );
}
