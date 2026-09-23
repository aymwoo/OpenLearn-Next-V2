import React, { useState } from 'react';
import {
  Presentation,
  FolderKanban,
  GraduationCap,
  Trophy,
  Activity,
  Settings,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { CanvasToolsDock, CanvasToolType } from './CanvasToolsDock';
import { CanvasBottomPagination } from './CanvasBottomPagination';
import { ActivePluginsDock } from './ActivePluginsDock';
import { AssignmentTaskCard } from './widgets/AssignmentTaskCard';

export interface ClassroomCanvasAreaProps {
  currentTab: 'whiteboard' | 'submissions' | 'assignment' | 'top_performers';
  onTabChange: (tab: 'whiteboard' | 'submissions' | 'assignment' | 'top_performers') => void;
  lang?: 'zh' | 'en';
  isLiveBroadcasterConnected?: boolean;
  studentErrorCount?: number;
  onOpenErrorCenter?: () => void;
  onOpenAttributionTool?: () => void;
  children?: React.ReactNode;
  submissionsCount?: number;
  showDemoTaskCard?: boolean;
}

export function ClassroomCanvasArea({
  currentTab = 'whiteboard',
  onTabChange,
  lang = 'zh',
  isLiveBroadcasterConnected = true,
  studentErrorCount = 0,
  onOpenErrorCenter,
  onOpenAttributionTool,
  children,
  submissionsCount = 29,
  showDemoTaskCard = false,
}: ClassroomCanvasAreaProps) {
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasToolType>('cursor');
  const [showGrid, setShowGrid] = useState(true);
  const [currentPage, setCurrentPage] = useState(2);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTaskCardVisible, setIsTaskCardVisible] = useState(showDemoTaskCard);

  return (
    <main className="flex-1 flex flex-col bg-surface-secondary/50 overflow-hidden relative" data-purpose="canvas-main-area">
      {/* ── Top Canvas Mode Bar & Live Stream Badge (Stitch Screen 1219a481) ── */}
      <div className="h-11 bg-surface/90 backdrop-blur-sm border-b border-border/80 px-4 flex items-center justify-between shrink-0 z-20 select-none">
        {/* Whiteboard View Segment Tabs */}
        <div className="flex items-center gap-1 bg-surface-secondary p-0.5 rounded-lg border border-border text-xs shadow-3xs">
          <button
            type="button"
            onClick={() => onTabChange('whiteboard')}
            className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
              currentTab === 'whiteboard'
                ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-3xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Presentation size={13} />
            <span>{lang === 'zh' ? '演示白板' : 'Whiteboard'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('submissions')}
            className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
              currentTab === 'submissions'
                ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-3xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <FolderKanban size={13} />
            <span>{lang === 'zh' ? '学生提交数据' : 'Submissions'}</span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </button>

          <button
            type="button"
            onClick={() => onTabChange('assignment')}
            className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
              currentTab === 'assignment'
                ? 'bg-surface text-indigo-600 dark:text-indigo-400 shadow-3xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <GraduationCap size={13} />
            <span>{lang === 'zh' ? '作业成绩评定' : 'Grades'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('top_performers')}
            className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
              currentTab === 'top_performers'
                ? 'bg-surface text-amber-600 dark:text-amber-400 shadow-3xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Trophy size={13} className="text-amber-500" />
            <span>{lang === 'zh' ? '随堂测验榜' : 'Top Performers'}</span>
          </button>
        </div>

        {/* Live Broadcaster Status & Diagnostics */}
        <div className="flex items-center gap-2">
          {studentErrorCount > 0 && (
            <button
              type="button"
              onClick={onOpenErrorCenter}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition cursor-pointer"
            >
              <AlertTriangle size={12} className="text-rose-500 animate-pulse" />
              <span>{lang === 'zh' ? `学生端异常 (${studentErrorCount})` : `Errors (${studentErrorCount})`}</span>
            </button>
          )}

          {isLiveBroadcasterConnected && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-mono font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>LIVE BROADCASTER CONNECTED</span>
            </span>
          )}

          <button
            type="button"
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition cursor-pointer"
            title={lang === 'zh' ? '画布配置' : 'Canvas Settings'}
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* ── Center Dynamic Canvas Area (Stitch Screen 1219a481) ── */}
      {currentTab === 'whiteboard' ? (
        <section
          className={`flex-1 relative overflow-hidden flex flex-col ${
            showGrid ? 'dot-grid-canvas' : 'bg-surface'
          }`}
          data-purpose="teaching-interactive-board"
        >
          {/* Floating Left Canvas Tools Dock */}
          <CanvasToolsDock
            activeTool={activeCanvasTool}
            onSelectTool={setActiveCanvasTool}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid(!showGrid)}
            lang={lang}
          />

          {/* Canvas Main Render Body (Whiteboard, Cards, Interactive Elements) */}
          <div className="flex-1 w-full h-full relative overflow-hidden">
            {children}

            {/* Draggable Assignment Floating Card (Stitch Screen 1219a481) */}
            {isTaskCardVisible && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto">
                <AssignmentTaskCard
                  submittedCount={submissionsCount}
                  totalStudents={32}
                  onDelete={() => setIsTaskCardVisible(false)}
                  lang={lang}
                />
              </div>
            )}

            {/* Third-Party Plugin Canvas Widget Slot */}
            <div className="absolute top-8 right-8 z-10 pointer-events-auto">
              <ExtensionPointRenderer slot="whiteboard.canvas.widget" />
            </div>
          </div>

          {/* Bottom-Left Active Plugins Dock */}
          <ActivePluginsDock
            activeCount={1}
            onOpenAttributionTool={onOpenAttributionTool}
            lang={lang}
          />

          {/* Bottom Floating Pagination and Slide Switcher */}
          <CanvasBottomPagination
            currentPage={currentPage}
            totalPages={3}
            onPageChange={setCurrentPage}
            zoomLevel={zoomLevel}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            lang={lang}
          />
        </section>
      ) : (
        <div className="flex-1 overflow-hidden p-4">{children}</div>
      )}
    </main>
  );
}
