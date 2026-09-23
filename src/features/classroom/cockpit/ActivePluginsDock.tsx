import React from 'react';
import { Trophy, Sparkles, Box } from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export interface ActivePluginsDockProps {
  activeCount?: number;
  onOpenAttributionTool?: () => void;
  lang?: 'zh' | 'en';
}

export function ActivePluginsDock({
  activeCount = 1,
  onOpenAttributionTool,
  lang = 'zh',
}: ActivePluginsDockProps) {
  return (
    <aside
      className="absolute bottom-5 left-6 z-20 flex items-center gap-3 select-none"
      data-purpose="active-plugins-dock"
    >
      <div className="bg-surface/95 backdrop-blur-md rounded-xl shadow-lg border border-border p-2 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenAttributionTool}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs transition cursor-pointer shadow-3xs"
        >
          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] shadow-xs">
            <Trophy size={11} />
          </span>
          <span>{lang === 'zh' ? '课堂加分与点名' : 'Class Points & Rollcall'}</span>
        </button>

        <div className="text-[11px] text-muted font-medium border-l border-border pl-2.5 pr-1 font-mono">
          PLUGINS: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{activeCount} ACTIVE</span>
        </div>

        {/* Third-Party Plugin Whiteboard Dock Slot */}
        <ExtensionPointRenderer slot="whiteboard.dock.plugin" />
      </div>
    </aside>
  );
}
