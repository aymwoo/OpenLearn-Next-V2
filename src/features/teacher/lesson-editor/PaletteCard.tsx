import React from 'react';
import { COLOR_THEME, PaletteItemConfig } from './paletteConfig';

interface PaletteCardProps {
  config: PaletteItemConfig;
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
}

export function PaletteCard({ config, lang, onActivate }: PaletteCardProps) {
  const Icon = config.icon;
  const theme = COLOR_THEME[config.color];

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
      className={`group relative bg-white border border-gray-200/80 rounded-2xl p-3 shadow-sm transition-all duration-200 cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 ${theme.cardHoverBorder} ${theme.cardHoverRing} ${theme.cardHoverShadow} flex flex-col gap-2`}
    >
      <div className={`self-start p-2 rounded-xl ${theme.iconBg} ${theme.iconText} transition-colors`}>
        <Icon size={18} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-bold text-xs text-gray-800 truncate">
          {lang === 'zh' ? config.labelZh : config.labelEn}
        </span>
        <span className="text-[10px] text-gray-400 leading-tight mt-0.5 truncate">
          {lang === 'zh' ? config.descriptionZh : config.descriptionEn}
        </span>
      </div>
      <div
        className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider ${theme.groupText} opacity-0 group-hover:opacity-100 transition-opacity`}
      >
        {lang === 'zh' ? '点击+' : '+ click'}
      </div>
    </div>
  );
}
