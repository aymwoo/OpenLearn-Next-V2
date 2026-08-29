import React from 'react';
import { Star } from 'lucide-react';
import { COLOR_THEME, PaletteItemConfig } from './paletteConfig';

interface PaletteCardProps {
  key?: React.Key;
  config: PaletteItemConfig;
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (type: string, e: React.MouseEvent) => void;
}

export function PaletteCard({ config, lang, onActivate, isFavorite = false, onToggleFavorite }: PaletteCardProps) {
  const Icon = config.icon;
  const theme = COLOR_THEME[config.color] || COLOR_THEME.indigo;

  return (
    <div
      draggable
      onDragStart={(e) => {
        const payload = { type: config.type, ...config.defaultData };
        const dataStr = JSON.stringify(payload);
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/json', dataStr);
        e.dataTransfer.setData('text/plain', dataStr);
      }}
      onClick={() => onActivate(config.type)}
      title={lang === 'zh' ? '点击编辑并添加到画板，或拖拽到画板' : 'Click to edit & add, or drag onto the board'}
      className={`group relative bg-white border border-slate-200/80 rounded-xl p-2.5 shadow-sm transition-all duration-200 cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 ${theme.cardHoverBorder} ${theme.cardHoverRing} ${theme.cardHoverShadow} flex flex-col justify-between min-h-[92px]`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className={`p-2 rounded-lg ${theme.iconBg} ${theme.iconText} transition-transform group-hover:scale-105 shrink-0`}>
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
              isFavorite ? 'text-amber-400 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-slate-100'
            }`}
            title={isFavorite ? (lang === 'zh' ? '取消收藏' : 'Remove favorite') : (lang === 'zh' ? '收藏组件' : 'Add favorite')}
          >
            <Star size={13} className={isFavorite ? 'fill-amber-400' : ''} />
          </button>
        )}
      </div>

      <div className="flex flex-col min-w-0 mt-1.5">
        <span className="font-semibold text-xs text-slate-800 truncate group-hover:text-indigo-600 transition-colors">
          {lang === 'zh' ? config.labelZh : config.labelEn}
        </span>
        <span className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate">
          {lang === 'zh' ? config.descriptionZh : config.descriptionEn}
        </span>
      </div>

      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">
          + Drag
        </span>
      </div>
    </div>
  );
}

