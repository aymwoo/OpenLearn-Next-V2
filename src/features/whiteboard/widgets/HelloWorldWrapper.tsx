import React, { useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { WidgetTitleBar } from './WidgetTitleBar';

export function HelloWorldWrapper({
  elementId,
  data,
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
  lessonId,
  readOnly = false,
  isMinimized = false,
  isMaximized = false,
  isPropertiesOpen = false,
  onOpenProperties,
  onMinimize,
  onRestore,
  onMaximize,
}: {
  elementId: string;
  data: any;
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onDelete: () => void;
  lessonId: string;
  /** 只读跟随模式：隐藏删除等编辑按钮 */
  readOnly?: boolean;
  isMinimized?: boolean;
  isMaximized?: boolean;
  isPropertiesOpen?: boolean;
  onOpenProperties?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onMaximize?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'hello.say',
          payload: {
            lessonId: lessonId,
            username: 'World',
            shout: true,
          },
        }),
      });
    } catch (e) {
      console.error('Failed to trigger hello.say command:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="w-full h-full bg-white border border-slate-200/80 rounded-xl shadow-lg overflow-hidden flex flex-col font-sans select-none"
      style={{ pointerEvents: readOnly ? 'none' : 'auto' }}
    >
      <WidgetTitleBar
        title="Hello World 插件"
        icon={<Sparkles size={11} className="text-amber-500 animate-pulse" />}
        readOnly={readOnly}
        isMinimized={isMinimized}
        isMaximized={isMaximized}
        isPropertiesOpen={isPropertiesOpen}
        themeColor="slate"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onOpenProperties={onOpenProperties}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onMaximize={onMaximize}
        onDelete={onDelete}
      />
      {!isMinimized && (
        <div className="flex-1 p-2 flex items-center justify-center bg-slate-50/20">
          <button
            onClick={handleClick}
            disabled={loading}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full py-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white font-bold text-xs rounded-lg shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
          >
            <Wand2 size={11} className={loading ? 'animate-spin' : ''} />
            <span>{loading ? '输出中...' : '点击输出'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
