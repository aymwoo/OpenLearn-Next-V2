import React from 'react';
import { Sparkles } from 'lucide-react';

export interface WhiteboardEmptyStateProps {
  isVisible: boolean;
}

export const WhiteboardEmptyState: React.FC<WhiteboardEmptyStateProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-muted p-6 z-0">
      <div className="w-16 h-16 rounded-2xl bg-primary-theme-light border border-theme flex items-center justify-center mb-3 shadow-2xs">
        <Sparkles className="w-7 h-7 text-primary-theme animate-pulse" />
      </div>
      <p className="font-bold text-sm text-main mb-1">交互式备课白板</p>
      <p className="text-xs text-muted max-w-sm text-center">
        从左侧组件库拖拽组件至此处，或使用顶部工具栏插入画笔、几何图形与 AI 助教
      </p>
    </div>
  );
};
