import React, { useState } from 'react';
import {
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Columns,
  Sparkles,
} from 'lucide-react';
import type { WidgetSize, DashboardWidgetId } from '../types/dashboardLayout';
import { SIZE_TO_COL_SPAN, SIZE_LABELS } from '../types/dashboardLayout';

export interface DashboardWidgetCardProps {
  id: DashboardWidgetId;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size: WidgetSize;
  onResize: (newSize: WidgetSize) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  lang?: 'zh' | 'en';
  children: React.ReactNode;
  onDragStart?: (e: React.DragEvent, id: DashboardWidgetId) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, id: DashboardWidgetId) => void;
  isDragging?: boolean;
  headerRightExtra?: React.ReactNode;
}

export function DashboardWidgetCard({
  id,
  title,
  subtitle,
  icon,
  size,
  onResize,
  onMoveLeft,
  onMoveRight,
  isFirst = false,
  isLast = false,
  collapsed = false,
  onToggleCollapse,
  lang = 'zh',
  children,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging = false,
  headerRightExtra,
}: DashboardWidgetCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Cycle sizes: third -> half -> two-thirds -> full -> third
  const handleCycleSize = () => {
    const cycleMap: Record<WidgetSize, WidgetSize> = {
      third: 'half',
      half: 'two-thirds',
      'two-thirds': 'full',
      full: 'half',
    };
    onResize(cycleMap[size]);
  };

  const colSpanClass = SIZE_TO_COL_SPAN[size] || 'lg:col-span-6 col-span-1';

  return (
    <div
      id={`widget-${id}`}
      data-widget-id={id}
      data-widget-size={size}
      draggable
      onDragStart={(e) => onDragStart?.(e, id)}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
        onDragOver?.(e);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDrop?.(e, id);
      }}
      className={`group/widget relative flex flex-col bg-white rounded-2xl border transition-all duration-200 ${colSpanClass} ${
        isDragOver
          ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-[1.008] shadow-md z-10'
          : isDragging
            ? 'opacity-40 border-dashed border-indigo-400'
            : 'border-slate-200/90 shadow-2xs hover:shadow-xs hover:border-slate-300'
      }`}
    >
      {/* Widget Control Bar / Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/70 rounded-t-2xl select-none">
        {/* Left: Drag Handle & Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded hover:bg-slate-200/60"
            title={lang === 'zh' ? '按住可拖动排序' : 'Drag to reorder'}
          >
            <GripVertical size={16} />
          </div>
          {icon && <div className="text-indigo-600 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight truncate flex items-center gap-2">
              <span>{title}</span>
              {size === 'full' && (
                <span className="hidden sm:inline-block text-2xs font-semibold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-100/80">
                  {lang === 'zh' ? '全宽' : 'Full'}
                </span>
              )}
            </h3>
            {subtitle && <p className="text-2xs text-slate-450 truncate">{subtitle}</p>}
          </div>
        </div>

        {/* Right: Quick Resize, Reorder Buttons & Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {headerRightExtra}

          {/* Quick Size Switcher Button Group */}
          <div className="hidden sm:flex items-center bg-slate-200/60 p-0.5 rounded-lg border border-slate-200 text-2xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => onResize('third')}
              title={lang === 'zh' ? '缩放为 1/3 窄栏' : 'Set to 1/3 width'}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                size === 'third' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-slate-900'
              }`}
            >
              1/3
            </button>
            <button
              type="button"
              onClick={() => onResize('half')}
              title={lang === 'zh' ? '缩放为 1/2 半宽' : 'Set to 1/2 width'}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                size === 'half' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-slate-900'
              }`}
            >
              1/2
            </button>
            <button
              type="button"
              onClick={() => onResize('two-thirds')}
              title={lang === 'zh' ? '缩放为 2/3 宽栏' : 'Set to 2/3 width'}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                size === 'two-thirds' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-slate-900'
              }`}
            >
              2/3
            </button>
            <button
              type="button"
              onClick={() => onResize('full')}
              title={lang === 'zh' ? '缩放为整行全宽' : 'Set to full width'}
              className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                size === 'full' ? 'bg-white text-indigo-700 shadow-2xs' : 'hover:text-slate-900'
              }`}
            >
              Full
            </button>
          </div>

          {/* Mobile/Compact Resize Button */}
          <button
            type="button"
            onClick={handleCycleSize}
            title={lang === 'zh' ? `切换尺寸 (当前: ${SIZE_LABELS[size]?.zh})` : `Resize (Current: ${size})`}
            className="sm:hidden p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
          >
            <Columns size={14} />
          </button>

          {/* Reorder Buttons (Move Backward / Forward) */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onMoveLeft}
              disabled={isFirst}
              title={lang === 'zh' ? '向前移动卡片' : 'Move forward'}
              className="p-1.5 text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={onMoveRight}
              disabled={isLast}
              title={lang === 'zh' ? '向后移动卡片' : 'Move backward'}
              className="p-1.5 text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Collapse / Expand Toggle */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? (lang === 'zh' ? '展开卡片' : 'Expand') : (lang === 'zh' ? '收起卡片' : 'Collapse')}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
            >
              {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Widget Body Content */}
      {!collapsed && <div className="p-4 flex-1 flex flex-col">{children}</div>}

      {/* Collapsed State Bar */}
      {collapsed && (
        <div
          onClick={onToggleCollapse}
          className="p-3 text-center text-xs font-semibold text-slate-400 hover:text-indigo-600 hover:bg-slate-50 transition-colors cursor-pointer rounded-b-2xl select-none"
        >
          {lang === 'zh' ? '卡片已收起 · 点击展开查看完整详情' : 'Card is collapsed · Click to expand'}
        </div>
      )}
    </div>
  );
}
