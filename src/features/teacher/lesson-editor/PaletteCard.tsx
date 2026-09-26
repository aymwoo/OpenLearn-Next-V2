import React from 'react';
import { Star, Puzzle } from 'lucide-react';
import { COLOR_THEME, PaletteItemConfig } from './paletteConfig';

interface PaletteCardProps {
  key?: React.Key;
  config: PaletteItemConfig;
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
  disabled?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (type: string, e: React.MouseEvent) => void;
}

export function PaletteCard({
  config,
  lang,
  onActivate,
  disabled = false,
  isFavorite = false,
  onToggleFavorite,
}: PaletteCardProps) {
  const Icon = config.icon || Puzzle;
  const theme = COLOR_THEME[config.color] || COLOR_THEME.indigo;

  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        const payload = { type: config.type, ...config.defaultData };
        const dataStr = JSON.stringify(payload);
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/json', dataStr);
        e.dataTransfer.setData('text/plain', dataStr);
      }}
      onClick={() => !disabled && onActivate(config.type)}
      title={
        disabled
          ? lang === 'zh'
            ? '当前为只读模式'
            : 'Read-only mode'
          : lang === 'zh'
            ? '点击编辑并添加到画板，或拖拽到画板'
            : 'Click to edit & add, or drag onto the board'
      }
      aria-disabled={disabled}
      className={`group relative bg-surface border border-theme rounded-xl p-2.5 shadow-sm transition-all duration-200 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5'} ${theme.cardHoverBorder} ${theme.cardHoverRing} ${theme.cardHoverShadow} flex flex-col justify-between min-h-[92px]`}
    >
      <div className="flex items-center justify-between gap-1">
        <div
          className={`p-2 rounded-lg ${theme.iconBg} ${theme.iconText} transition-transform group-hover:scale-105 shrink-0`}
        >
          <Icon size={16} />
        </div>
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(config.type, e);
            }}
            className={`p-1 rounded-md transition-colors ${
              isFavorite
                ? 'text-amber-400 opacity-100'
                : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-surface-secondary'
            }`}
            title={
              isFavorite
                ? lang === 'zh'
                  ? '取消收藏'
                  : 'Remove favorite'
                : lang === 'zh'
                  ? '收藏组件'
                  : 'Add favorite'
            }
          >
            <Star size={13} className={isFavorite ? 'fill-amber-400' : ''} />
          </button>
        )}
      </div>

      <div className="flex flex-col min-w-0 mt-1.5">
        <span className="font-semibold text-xs text-main truncate group-hover:text-primary-theme transition-colors">
          {lang === 'zh' ? config.labelZh : config.labelEn}
        </span>
        <span className="text-xs text-muted leading-tight mt-0.5 truncate">
          {lang === 'zh' ? config.descriptionZh : config.descriptionEn}
        </span>
      </div>

      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="text-xs font-bold text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">
          + Drag
        </span>
      </div>
    </div>
  );
}
