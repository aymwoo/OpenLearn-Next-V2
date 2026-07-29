import React, { useState } from 'react';
import { Sparkles, Trash2, Wand2 } from 'lucide-react';

export function HelloWorldWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
  lessonId
}: { 
  elementId: string; 
  data: any; 
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDelete: () => void;
  lessonId: string;
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
            shout: true
          }
        })
      });
    } catch (e) {
      console.error('Failed to trigger hello.say command:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-white border border-slate-200/80 rounded-xl shadow-lg overflow-hidden flex flex-col font-sans select-none" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-slate-50 text-slate-700 px-2 py-1.5 flex justify-between items-center text-[10px] font-semibold border-b border-slate-150 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="flex items-center gap-1.5 text-slate-650">
          <Sparkles size={11} className="text-amber-500 animate-pulse" />
          <span>Hello World 插件</span>
        </span>
        <button 
          onClick={onDelete} 
          onPointerDown={e => e.stopPropagation()}
          className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-red-500 transition-colors cursor-pointer" 
          title="删除组件"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="flex-1 p-2 flex items-center justify-center bg-slate-50/20">
        <button
          onClick={handleClick}
          disabled={loading}
          onPointerDown={e => e.stopPropagation()}
          className="w-full py-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white font-bold text-[10px] rounded-lg shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <Wand2 size={11} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? '输出中...' : '点击输出'}</span>
        </button>
      </div>
    </div>
  );
}
