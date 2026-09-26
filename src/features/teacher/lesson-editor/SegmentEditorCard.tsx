import React from 'react';
import { Trash2, FileText, Sliders, Palette, Sparkles, Clock, Layers } from 'lucide-react';
import { SEGMENT_TYPES, SEGMENT_COLORS } from './timelineConfig';

interface SegmentEditorCardProps {
  lang: 'zh' | 'en';
  segment: any;
  onPatch: (patch: Record<string, any>) => void;
  onDelete: () => void;
}

export function SegmentEditorCard({ lang, segment, onPatch, onDelete }: SegmentEditorCardProps) {
  return (
    <div className="relative mx-3 sm:mx-4 my-3 rounded-2xl bg-surface/98 backdrop-blur-xl border-2 border-primary-theme/50 dark:border-primary-theme/60 shadow-2xl shadow-primary-theme/20 ring-4 ring-primary-theme/15 overflow-hidden shrink-0 text-main animate-in fade-in-0 zoom-in-[0.98] slide-in-from-top-3 duration-300 ease-out transition-all">
      {/* 聚光灯柔光背景与装饰光斑 */}
      <div className="pointer-events-none absolute -top-12 -left-12 w-64 h-32 bg-primary-theme/15 rounded-full blur-2xl opacity-60" />
      <div className="pointer-events-none absolute -bottom-12 -right-12 w-64 h-32 bg-indigo-500/10 rounded-full blur-2xl opacity-60" />

      {/* 顶部彩色微光焦点线条与流光扫光 */}
      <div className="relative h-1.5 w-full bg-gradient-to-r from-primary-theme via-indigo-500 to-sky-400 shadow-sm shadow-primary-theme/30">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse" />
      </div>

      <div className="p-3.5 sm:p-4 flex flex-col gap-3.5 relative z-1">
        {/* 头部指示与删除操作 */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-primary-theme/15">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* 带有双层动态呼吸脉冲光斑的图标卡 */}
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-primary-theme/25 to-primary-theme/10 text-primary-theme flex items-center justify-center shrink-0 border border-primary-theme/40 shadow-xs">
              <Sliders size={15} />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-theme opacity-80" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-theme ring-2 ring-surface shadow-xs" />
              </span>
            </div>
            <div className="flex items-center gap-2 truncate">
              <span className="text-xs sm:text-sm font-black text-main tracking-tight truncate flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-primary-theme animate-pulse" />
                {lang === 'zh' ? `环节参数配置：${segment.title}` : `Segment Config: ${segment.title}`}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-primary-theme text-white shadow-xs shadow-primary-theme/30 animate-pulse">
                <Sparkles size={10} />
                {lang === 'zh' ? '正在聚焦编辑' : 'Active Editing'}
              </span>
              <span className="text-[10px] text-muted font-mono opacity-80 bg-surface-secondary/80 px-1.5 py-0.5 rounded-md border border-theme/50">
                ID: {segment.id}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onDelete}
            className="px-2.5 py-1 text-xs text-rose-600 hover:text-white bg-rose-500/10 hover:bg-rose-600 border border-rose-500/25 rounded-xl flex items-center gap-1.5 transition-all hover:scale-102 cursor-pointer shadow-2xs shrink-0"
            title={lang === 'zh' ? '删除当前环节' : 'Delete Segment'}
          >
            <Trash2 size={12} />
            <span>{lang === 'zh' ? '删除环节' : 'Delete'}</span>
          </button>
        </div>

        {/* 参数表单网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted flex items-center gap-1">
              <FileText size={11} className="text-primary-theme" />
              <span>{lang === 'zh' ? '环节名称' : 'Title'}</span>
            </span>
            <input
              type="text"
              value={segment.title || ''}
              onChange={(e) => onPatch({ title: e.target.value })}
              className="border border-theme/80 px-2.5 py-1.5 rounded-xl bg-surface-secondary/80 focus:bg-surface text-xs text-main font-medium outline-none focus:border-primary-theme focus:ring-2 focus:ring-primary-theme/25 transition-all shadow-2xs"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted flex items-center gap-1">
              <Clock size={11} className="text-primary-theme" />
              <span>{lang === 'zh' ? '预计用时' : 'Duration'}</span>
            </span>
            <input
              type="text"
              value={segment.duration || '10m'}
              onChange={(e) => onPatch({ duration: e.target.value })}
              placeholder="例如: 10m"
              className="border border-theme/80 px-2.5 py-1.5 rounded-xl bg-surface-secondary/80 focus:bg-surface text-xs text-main font-mono outline-none focus:border-primary-theme focus:ring-2 focus:ring-primary-theme/25 transition-all shadow-2xs"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted flex items-center gap-1">
              <Layers size={11} className="text-primary-theme" />
              <span>{lang === 'zh' ? '教学形态' : 'Instructional Type'}</span>
            </span>
            <select
              value={segment.type || 'lecture'}
              onChange={(e) => onPatch({ type: e.target.value })}
              className="border border-theme/80 px-2.5 py-1.5 rounded-xl bg-surface-secondary/80 focus:bg-surface text-xs text-main font-medium outline-none focus:border-primary-theme focus:ring-2 focus:ring-primary-theme/25 transition-all shadow-2xs cursor-pointer"
            >
              {SEGMENT_TYPES.map((t) => (
                <option key={t.id} value={t.id} className="bg-surface text-main">
                  {lang === 'zh' ? t.labelZh : t.labelEn}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted flex items-center gap-1">
              <Palette size={11} className="text-primary-theme" />
              <span>{lang === 'zh' ? '环节标识色' : 'Accent Color'}</span>
            </span>
            <div className="flex items-center gap-1.5 pt-1">
              {SEGMENT_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => onPatch({ color: c.color })}
                  className={`w-5 h-5 rounded-full border border-theme/60 transition-all hover:scale-115 cursor-pointer ${
                    c.color.split(' ')[0]
                  } ${segment.color === c.color ? 'ring-2 ring-primary-theme ring-offset-2 scale-110 shadow-xs' : ''}`}
                  title={c.name}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 环节备课小抄 / 教学提示 */}
        <div className="flex flex-col gap-1 rounded-xl p-2.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20">
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <FileText size={12} className="text-amber-500" />
            <span>{lang === 'zh' ? '教师备课备忘 & 教学设计要点' : 'Instructional Notes'}</span>
          </span>
          <textarea
            rows={2}
            value={segment.notes || ''}
            onChange={(e) => onPatch({ notes: e.target.value })}
            placeholder={
              lang === 'zh'
                ? '写给自己的教学小抄：本环节核心提问、白板板书重点、容易卡壳的步骤…'
                : 'Teaching points, blackboard highlights, key student friction points…'
            }
            className="w-full border border-theme/70 px-3 py-1.5 rounded-xl bg-surface/90 focus:bg-surface text-xs text-main placeholder-muted outline-none focus:border-primary-theme focus:ring-2 focus:ring-primary-theme/20 transition-all resize-y shadow-2xs leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
