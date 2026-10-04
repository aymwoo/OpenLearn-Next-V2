import React from 'react';
import type { TilingSplitter, DropZoneAction } from '../utils/auto-tiling';

export interface WhiteboardTilingOverlayProps {
  autoTileEnabled: boolean;
  readOnly: boolean;
  tilingSplitters: TilingSplitter[];
  activeSplitterDrag: { splitter: TilingSplitter; [key: string]: any } | null;
  activeDropZoneAction: DropZoneAction | null;
  handleSplitterPointerDown: (e: React.PointerEvent, sp: TilingSplitter) => void;
}

export const WhiteboardTilingOverlay: React.FC<WhiteboardTilingOverlayProps> = ({
  autoTileEnabled,
  readOnly,
  tilingSplitters,
  activeSplitterDrag,
  activeDropZoneAction,
  handleSplitterPointerDown,
}) => {
  if (!autoTileEnabled || readOnly) {
    return null;
  }

  return (
    <>
      {/* 自动平铺分割条交互层（支持上下水平分割线与左右垂直分割线拖拽调高/调宽） */}
      {tilingSplitters.length > 0 && (
        <div className="absolute inset-0 pointer-events-none z-30">
          {tilingSplitters.map((sp) => {
            const isHorizontal = sp.orientation === 'horizontal';
            const isDraggingThis = activeSplitterDrag?.splitter.id === sp.id;
            return (
              <div
                key={sp.id}
                data-testid={`splitter-${sp.orientation}-${sp.id}`}
                className={`absolute pointer-events-auto group flex items-center justify-center select-none ${
                  isHorizontal ? 'cursor-row-resize' : 'cursor-col-resize'
                }`}
                style={{
                  left: `${sp.x}px`,
                  top: `${sp.y}px`,
                  width: `${isHorizontal ? sp.length : sp.thickness}px`,
                  height: `${isHorizontal ? sp.thickness : sp.length}px`,
                }}
                onPointerDown={(e) => handleSplitterPointerDown(e, sp)}
                title={isHorizontal ? '拖动调整上下分割高度' : '拖动调整左右分割宽度'}
              >
                {/* 交互把手视觉线 */}
                <div
                  className={`rounded-full transition-all duration-150 ${
                    isHorizontal
                      ? `w-full h-1 my-auto ${
                          isDraggingThis
                            ? 'bg-indigo-500 h-1.5 shadow-md'
                            : 'bg-transparent group-hover:bg-indigo-400/80 group-hover:h-1.5'
                        }`
                      : `h-full w-1 mx-auto ${
                          isDraggingThis
                            ? 'bg-indigo-500 w-1.5 shadow-md'
                            : 'bg-transparent group-hover:bg-indigo-400/80 group-hover:w-1.5'
                        }`
                  }`}
                />
                {/* 中间微缩把手点 */}
                <div
                  className={`absolute rounded-full transition-all duration-150 flex items-center justify-center ${
                    isDraggingThis
                      ? 'bg-indigo-600 text-white scale-110 shadow-lg'
                      : 'opacity-0 group-hover:opacity-100 bg-white/95 dark:bg-slate-800/95 text-indigo-600 shadow border border-indigo-200 dark:border-indigo-700'
                  } ${isHorizontal ? 'w-8 h-3.5' : 'h-8 w-3.5'}`}
                >
                  <div className={`flex ${isHorizontal ? 'flex-row gap-0.5' : 'flex-col gap-0.5'}`}>
                    <div className="w-1 h-1 rounded-full bg-current opacity-70" />
                    <div className="w-1 h-1 rounded-full bg-current opacity-70" />
                    <div className="w-1 h-1 rounded-full bg-current opacity-70" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 智能切分全域虚线预览框 */}
      {activeDropZoneAction && activeDropZoneAction.type !== 'swap' && (
        <div
          data-testid="directional-split-preview"
          className="absolute pointer-events-none rounded-2xl border-3 border-dashed border-indigo-500 bg-indigo-500/20 backdrop-blur-[2px] shadow-2xl flex items-center justify-center transition-all duration-150 z-40 animate-in fade-in zoom-in-95"
          style={{
            left: `${activeDropZoneAction.previewRect.x}px`,
            top: `${activeDropZoneAction.previewRect.y}px`,
            width: `${activeDropZoneAction.previewRect.width}px`,
            height: `${activeDropZoneAction.previewRect.height}px`,
          }}
        >
          <div className="bg-indigo-600 text-white text-xs md:text-sm font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 select-none animate-bounce">
            <span>{activeDropZoneAction.label}</span>
          </div>
        </div>
      )}
    </>
  );
};
