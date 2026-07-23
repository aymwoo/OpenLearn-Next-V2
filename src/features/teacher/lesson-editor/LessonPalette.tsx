import { Blocks } from 'lucide-react';
import { PaletteCard } from './PaletteCard';
import { PALETTE_GROUPS, PALETTE_ITEMS, COLOR_THEME } from './paletteConfig';

interface LessonPaletteProps {
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
}

export function LessonPalette({ lang, onActivate }: LessonPaletteProps) {
  return (
    <div className="w-1/4 min-w-[210px] max-w-[260px] border-r border-gray-200 bg-slate-50/75 p-4 overflow-y-auto flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <Blocks size={14} className="text-indigo-600" />
          {lang === 'zh' ? '备课画板组件' : 'Drag Components'}
        </h3>
        <p className="text-[10px] text-gray-500 leading-tight mt-1">
          {lang === 'zh'
            ? '点击下方组件可编辑内容后添加到画板，或拖拽到右侧白板中。'
            : 'Click a component to edit & add, or drag it onto the board.'}
        </p>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto">
        {PALETTE_GROUPS.map((group) => {
          const items = PALETTE_ITEMS.filter((i) => i.group === group.id);
          if (items.length === 0) return null;
          const accent = COLOR_THEME[items[0].color];
          return (
            <div key={group.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <span className={`w-1.5 h-1.5 rounded-full ${accent.groupAccent}`} />
                <span className={`text-[10px] font-black uppercase tracking-wider ${accent.groupText}`}>
                  {lang === 'zh' ? group.labelZh : group.labelEn}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {items.map((item) => (
                  <PaletteCard key={item.type} config={item} lang={lang} onActivate={onActivate} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
