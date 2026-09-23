import React, { useState } from 'react';
import {
  MousePointer2,
  Pen,
  Highlighter,
  Eraser,
  Shapes,
  Type,
  Sparkles,
  Image as ImageIcon,
  Grid,
} from 'lucide-react';

export type CanvasToolType = 'cursor' | 'pen' | 'highlighter' | 'eraser' | 'shapes' | 'text' | 'laser' | 'media' | 'grid';

export interface CanvasToolsDockProps {
  activeTool?: CanvasToolType;
  onSelectTool?: (tool: CanvasToolType) => void;
  showGrid?: boolean;
  onToggleGrid?: () => void;
  lang?: 'zh' | 'en';
}

export function CanvasToolsDock({
  activeTool = 'cursor',
  onSelectTool,
  showGrid = true,
  onToggleGrid,
  lang = 'zh',
}: CanvasToolsDockProps) {
  const [currentTool, setCurrentTool] = useState<CanvasToolType>(activeTool);

  const handleToolClick = (tool: CanvasToolType) => {
    setCurrentTool(tool);
    onSelectTool?.(tool);
  };

  const tools = [
    { id: 'cursor' as const, icon: MousePointer2, label: lang === 'zh' ? '选择光标 (V)' : 'Select Cursor (V)' },
    { id: 'pen' as const, icon: Pen, label: lang === 'zh' ? '绘图画笔 (P)' : 'Drawing Pen (P)' },
    { id: 'highlighter' as const, icon: Highlighter, label: lang === 'zh' ? '荧光记号笔 (H)' : 'Highlighter (H)' },
    { id: 'eraser' as const, icon: Eraser, label: lang === 'zh' ? '橡皮擦 (E)' : 'Eraser (E)' },
  ];

  const secondaryTools = [
    { id: 'shapes' as const, icon: Shapes, label: lang === 'zh' ? '几何图形 (S)' : 'Shapes (S)' },
    { id: 'text' as const, icon: Type, label: lang === 'zh' ? '文本框 (T)' : 'Text Box (T)' },
    { id: 'laser' as const, icon: Sparkles, label: lang === 'zh' ? '激光指针 (L)' : 'Laser Pointer (L)' },
    { id: 'media' as const, icon: ImageIcon, label: lang === 'zh' ? '插入多媒体素材' : 'Insert Media' },
  ];

  return (
    <aside
      className="absolute top-14 left-4 z-20 bg-surface/95 backdrop-blur-md rounded-xl shadow-lg border border-border/90 p-1 flex flex-col gap-1 text-muted select-none"
      data-purpose="canvas-tools-dock"
    >
      {tools.map((t) => {
        const Icon = t.icon;
        const isActive = currentTool === t.id;
        return (
          <div key={t.id} className="relative group">
            <button
              type="button"
              onClick={() => handleToolClick(t.id)}
              className={`p-1.5 rounded-lg transition cursor-pointer flex items-center justify-center ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold shadow-3xs'
                  : 'hover:bg-surface-secondary hover:text-foreground'
              }`}
            >
              <Icon size={16} />
            </button>
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 hidden group-hover:flex flex-col pointer-events-none">
              <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                {t.label}
              </div>
            </div>
          </div>
        );
      })}

      <div className="h-px bg-border/80 my-0.5" />

      {secondaryTools.map((t) => {
        const Icon = t.icon;
        const isActive = currentTool === t.id;
        return (
          <div key={t.id} className="relative group">
            <button
              type="button"
              onClick={() => handleToolClick(t.id)}
              className={`p-1.5 rounded-lg transition cursor-pointer flex items-center justify-center ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold shadow-3xs'
                  : 'hover:bg-surface-secondary hover:text-foreground'
              }`}
            >
              <Icon size={16} />
            </button>
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 hidden group-hover:flex flex-col pointer-events-none">
              <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
                {t.label}
              </div>
            </div>
          </div>
        );
      })}

      <div className="h-px bg-border/80 my-0.5" />

      {/* Grid Switch */}
      <div className="relative group">
        <button
          type="button"
          onClick={onToggleGrid}
          className={`p-1.5 rounded-lg transition cursor-pointer flex items-center justify-center ${
            showGrid
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30'
              : 'hover:bg-surface-secondary hover:text-foreground'
          }`}
        >
          <Grid size={16} />
        </button>
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 hidden group-hover:flex flex-col pointer-events-none">
          <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
            {lang === 'zh' ? '点阵参考网格开关' : 'Toggle Grid'}
          </div>
        </div>
      </div>
    </aside>
  );
}
