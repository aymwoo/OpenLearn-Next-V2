import React from 'react';
import {
  Maximize2,
  Minus,
  Square,
  SlidersHorizontal,
  Trash2,
  Lock,
} from 'lucide-react';

export interface WidgetTitleBarProps {
  title: string;
  icon?: React.ReactNode;
  readOnly?: boolean;
  isMinimized?: boolean;
  isMaximized?: boolean;
  isPropertiesOpen?: boolean;
  themeColor?: 'indigo' | 'orange' | 'purple' | 'gray' | 'slate' | 'default';
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onOpenProperties?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onMaximize?: () => void;
  onDelete?: () => void;
  extraActions?: React.ReactNode;
}

export function WidgetTitleBar({
  title,
  icon,
  readOnly = false,
  isMinimized = false,
  isMaximized = false,
  isPropertiesOpen = false,
  themeColor = 'default',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onOpenProperties,
  onMinimize,
  onRestore,
  onMaximize,
  onDelete,
  extraActions,
}: WidgetTitleBarProps) {
  const getThemeStyles = () => {
    switch (themeColor) {
      case 'indigo':
        return 'bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 border-indigo-200/80 dark:border-indigo-800/60';
      case 'orange':
        return 'bg-orange-50/90 dark:bg-orange-950/60 text-orange-900 dark:text-orange-200 border-orange-200/80 dark:border-orange-800/60';
      case 'purple':
        return 'bg-purple-50/90 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 border-purple-200/80 dark:border-purple-800/60';
      case 'gray':
      case 'slate':
      case 'default':
      default:
        return 'bg-surface-secondary/90 text-main border-theme';
    }
  };

  return (
    <div
      className={`px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b select-none shrink-0 transition-colors ${getThemeStyles()} ${
        readOnly ? 'cursor-default' : 'cursor-move'
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* 左侧图标与标题 */}
      <div className="flex items-center gap-1.5 min-w-0 mr-2 truncate">
        {icon && <span className="shrink-0 opacity-80">{icon}</span>}
        <span className="truncate tracking-tight">{title}</span>
        {readOnly && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-semibold select-none flex items-center gap-0.5 shrink-0">
            🔒 只读锁定
          </span>
        )}
      </div>

      {/* 右侧控制栏（只读模式隐藏主要操作） */}
      {!readOnly && (
        <div className="flex items-center gap-0.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          {extraActions}

          {/* 属性配置图标 */}
          {onOpenProperties && (
            <button
              type="button"
              onClick={onOpenProperties}
              className={`p-1 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
                isPropertiesOpen
                  ? 'bg-primary-theme text-white shadow-2xs'
                  : 'text-muted hover:text-main hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="属性配置"
            >
              <SlidersHorizontal size={12} />
            </button>
          )}

          {/* 最小化按钮 */}
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              disabled={isMinimized}
              className={`p-1 rounded-lg transition-all flex items-center justify-center ${
                isMinimized
                  ? 'opacity-30 cursor-not-allowed text-muted'
                  : 'text-muted hover:text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer'
              }`}
              title="最小化组件"
            >
              <Minus size={12} />
            </button>
          )}

          {/* 还原按钮 */}
          {onRestore && (
            <button
              type="button"
              onClick={onRestore}
              className={`p-1 rounded-lg transition-all flex items-center justify-center ${
                isMinimized || isMaximized
                  ? 'text-primary-theme font-bold bg-primary-theme/15 hover:bg-primary-theme/25 cursor-pointer shadow-2xs ring-1 ring-primary-theme/30'
                  : 'text-muted hover:text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer'
              }`}
              title="还原组件"
            >
              <Square size={11} className={isMinimized || isMaximized ? 'stroke-[2.5]' : ''} />
            </button>
          )}

          {/* 最大化按钮 */}
          {onMaximize && (
            <button
              type="button"
              onClick={onMaximize}
              disabled={isMaximized}
              className={`p-1 rounded-lg transition-all flex items-center justify-center ${
                isMaximized
                  ? 'opacity-30 cursor-not-allowed text-muted'
                  : 'text-muted hover:text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer'
              }`}
              title="全屏"
            >
              <Maximize2 size={11} />
            </button>
          )}

          {/* 删除按钮 */}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-500/10 transition-all cursor-pointer flex items-center justify-center"
              title="删除组件"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
