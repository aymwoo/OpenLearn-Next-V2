import React from 'react';
import {
  LayoutList,
  ChevronLeft,
  ChevronRight,
  Plus,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export interface CanvasBottomPaginationProps {
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  onAddPage?: () => void;
  onToggleOutline?: () => void;
  zoomLevel?: number;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  lang?: 'zh' | 'en';
}

export function CanvasBottomPagination({
  currentPage = 2,
  totalPages = 3,
  onPageChange,
  onAddPage,
  onToggleOutline,
  zoomLevel = 100,
  onToggleFullscreen,
  isFullscreen = false,
  lang = 'zh',
}: CanvasBottomPaginationProps) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <footer
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-surface/95 backdrop-blur-md px-3 py-1 rounded-full shadow-lg border border-border text-xs select-none"
      data-purpose="canvas-slide-switcher"
    >
      {/* Outline Switcher */}
      <div className="relative group">
        <button
          type="button"
          onClick={onToggleOutline}
          className="flex items-center gap-1.5 px-2 py-0.5 text-muted hover:text-foreground font-medium border-r border-border pr-2.5 transition cursor-pointer"
        >
          <LayoutList size={13} className="text-indigo-600 dark:text-indigo-400" />
          <span>{lang === 'zh' ? '大纲' : 'Outline'}</span>
        </button>
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-40 hidden group-hover:flex flex-col items-center pointer-events-none">
          <div className="bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-md shadow-lg whitespace-nowrap">
            {lang === 'zh' ? '展开教学课件大纲 (3节)' : 'Courseware Outline'}
          </div>
        </div>
      </div>

      {/* Slide Navigator */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange?.(currentPage - 1)}
          className="p-1 rounded-full text-muted hover:text-foreground disabled:opacity-30 cursor-pointer"
        >
          <ChevronLeft size={13} />
        </button>

        {pages.map((p) => {
          const isActive = p === currentPage;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange?.(p)}
              className={`px-2 py-0.5 rounded-full text-xs font-bold transition cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-surface-secondary text-muted hover:text-foreground hover:bg-surface'
              }`}
            >
              P{p}
            </button>
          );
        })}

        {onAddPage && (
          <button
            type="button"
            onClick={onAddPage}
            className="p-1 rounded-full text-muted hover:text-foreground hover:bg-surface-secondary cursor-pointer"
            title={lang === 'zh' ? '添加新页面' : 'Add Page'}
          >
            <Plus size={13} />
          </button>
        )}

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange?.(currentPage + 1)}
          className="p-1 rounded-full text-muted hover:text-foreground disabled:opacity-30 cursor-pointer"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="h-3 w-px bg-border mx-1" />

      {/* Zoom and Fullscreen */}
      <div className="flex items-center gap-1.5 text-muted font-mono text-[11px]">
        <span>{zoomLevel}%</span>
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="hover:text-foreground p-0.5 cursor-pointer rounded"
            title={isFullscreen ? (lang === 'zh' ? '退出全屏' : 'Exit Fullscreen') : lang === 'zh' ? '全屏' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>
    </footer>
  );
}
