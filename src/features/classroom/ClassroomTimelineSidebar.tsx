import React from 'react';
import {
  Clock,
  ChevronsUpDown,
  Plus,
  ChevronLeft,
  ChevronDown,
  HelpCircle,
  FileText,
  SquarePlus,
  Radio,
  Presentation,
  LayoutGrid,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import type { WhiteboardPageItem } from '../whiteboard/InteractiveWhiteboard';

export interface TimelineSegmentItem {
  id: string;
  title: string;
  duration?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface ClassroomTimelineSidebarProps {
  timelineSegments: TimelineSegmentItem[];
  activeSegmentId: string | null;
  whiteboardPages: WhiteboardPageItem[];
  currentWhiteboardPage: number;
  expandedSegmentMap: Record<string, boolean>;
  elements: Array<{ id?: string; data: string }>;
  selectedLesson: string | null;
  lang: string;
  onToggleAllSegments: () => void;
  onToggleSegmentExpand: (segId: string) => void;
  onAddPage: () => void;
  onCollapse: () => void;
  onSelectPage: (globalIdx: number, segId?: string) => void;
  onStartSegment: (seg: TimelineSegmentItem) => void;
  getPagesForSegment: (
    seg: TimelineSegmentItem,
    segIdx: number,
  ) => Array<{ page: WhiteboardPageItem; globalIdx: number }>;
}

/**
 * 清除 HTML 标签与实体，转换为紧凑纯文本（用于 tooltip / hover 提示）
 */
export function stripHtml(html?: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function ClassroomTimelineSidebar({
  timelineSegments,
  activeSegmentId,
  whiteboardPages,
  currentWhiteboardPage,
  expandedSegmentMap,
  elements,
  selectedLesson,
  lang,
  onToggleAllSegments,
  onToggleSegmentExpand,
  onAddPage,
  onCollapse,
  onSelectPage,
  onStartSegment,
  getPagesForSegment,
}: ClassroomTimelineSidebarProps) {
  return (
    <div className="w-[280px] shrink-0 bg-surface border-r border-theme flex flex-col min-h-0 select-none shadow-xs">
      {/* 顶栏控制：标题、统计与快捷操作 */}
      <div className="p-2.5 border-b border-theme/60 flex items-center justify-between shrink-0 bg-surface-secondary/25 gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-primary-theme/10 text-primary-ink flex items-center justify-center shrink-0">
            <Clock size={13} />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-black text-main tracking-tight whitespace-nowrap">
              {lang === 'zh' ? '教学环节进度表' : 'Timeline Segments'}
            </h3>
            <div className="text-[11px] text-muted flex items-center gap-1.5 font-medium whitespace-nowrap">
              <span>
                {timelineSegments.length} {lang === 'zh' ? '环节' : 'steps'}
              </span>
              <span>•</span>
              <span>
                {whiteboardPages.length || 1} {lang === 'zh' ? '页面' : 'pages'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onToggleAllSegments}
            className="p-1 rounded-md text-muted hover:text-main hover:bg-surface border border-theme/40 transition-colors cursor-pointer"
            title={lang === 'zh' ? '全部展开/折叠抽屉' : 'Expand/Collapse All Drawers'}
          >
            <ChevronsUpDown size={13} />
          </button>
          <button
            type="button"
            onClick={onAddPage}
            className="p-1 rounded-md text-muted hover:text-primary-ink hover:bg-surface border border-theme/40 transition-colors cursor-pointer"
            title={lang === 'zh' ? '新建白板页面' : 'Add Whiteboard Page'}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="p-1 rounded-md text-muted hover:text-main hover:bg-surface border border-theme/40 transition-colors cursor-pointer"
            title={lang === 'zh' ? '收起边栏以扩大白板视野' : 'Collapse Sidebar'}
          >
            <ChevronLeft size={13} />
          </button>
        </div>
      </div>

      {/* 滚动容器：教学环节抽屉列表 */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 flex flex-col gap-2 scrollbar-thin">
        {selectedLesson ? (
          <div className="space-y-2">
            {timelineSegments.map((seg, idx) => {
              const isActive = activeSegmentId === seg.id;
              const isOpen = expandedSegmentMap[seg.id] ?? seg.id === activeSegmentId;
              const segPages = getPagesForSegment(seg, idx);
              const cleanNotes = stripHtml(seg.notes);

              return (
                <div
                  key={seg.id}
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isActive
                      ? 'bg-surface border-primary-theme shadow-xs ring-1 ring-primary-theme/25'
                      : 'bg-surface border-theme/60 hover:border-primary-theme/40'
                  }`}
                >
                  {/* 抽屉头部 Header：两行式排版 */}
                  <div
                    onClick={() => onToggleSegmentExpand(seg.id)}
                    className={`p-2 transition-all cursor-pointer flex flex-col gap-1.5 select-none ${
                      isActive
                        ? 'bg-primary-theme/10 text-primary-ink'
                        : 'bg-surface hover:bg-surface-secondary/60 text-main'
                    }`}
                  >
                    {/* 第一行：折叠箭头 + 序号 + 环节标题 + Hover Notes 提示 */}
                    <div className="flex items-center gap-1.5 min-w-0 w-full">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSegmentExpand(seg.id);
                        }}
                        className="p-0.5 rounded text-muted hover:text-main transition-transform cursor-pointer shrink-0"
                        title={
                          isOpen ? (lang === 'zh' ? '折叠抽屉' : 'Collapse') : lang === 'zh' ? '展开抽屉' : 'Expand'
                        }
                      >
                        <ChevronDown
                          size={12}
                          className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                        />
                      </button>
                      <span
                        className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-primary-solid text-white'
                            : 'bg-surface-secondary text-muted border border-theme/50'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span
                        className={`text-xs font-bold truncate flex-1 min-w-0 ${
                          isActive ? 'text-primary-ink' : 'text-main'
                        }`}
                        title={cleanNotes ? `${seg.title}\n${cleanNotes}` : seg.title}
                      >
                        {seg.title}
                      </span>
                      {cleanNotes && (
                        <span
                          className="text-muted/70 hover:text-primary-ink cursor-help p-0.5 rounded shrink-0 transition-colors"
                          title={cleanNotes}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <HelpCircle size={12} />
                        </span>
                      )}
                    </div>

                    {/* 第二行：时间、页面数、加页、演示中/广播 */}
                    <div className="flex items-center justify-between gap-1.5 pl-5.5 pr-0.5 text-[11px] flex-nowrap whitespace-nowrap overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0 flex-nowrap shrink-0">
                        {/* 时长 iconfont */}
                        <span
                          className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted shrink-0"
                          title={lang === 'zh' ? `预计时长: ${seg.duration}` : `Duration: ${seg.duration}`}
                        >
                          <Clock size={11} className="shrink-0 text-muted/70" />
                          <span>{seg.duration}</span>
                        </span>

                        {/* 页数 iconfont */}
                        <span
                          className="inline-flex items-center gap-0.5 font-mono text-[10px] text-primary-ink font-semibold shrink-0"
                          title={
                            lang === 'zh' ? `本环节关联 ${segPages.length} 个白板页面` : `${segPages.length} pages`
                          }
                        >
                          <FileText size={11} className="shrink-0 text-primary-ink/70" />
                          <span>{segPages.length}</span>
                        </span>

                        {/* 加页 iconfont 按钮 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddPage();
                          }}
                          className="p-0.5 rounded text-muted hover:text-primary-ink hover:bg-primary-theme/10 border border-theme/60 transition-colors flex items-center justify-center cursor-pointer shrink-0"
                          title={lang === 'zh' ? '在此环节加页' : 'Add page to segment'}
                        >
                          <SquarePlus size={12} className="shrink-0" />
                        </button>
                      </div>

                      <div className="flex items-center shrink-0">
                        {isActive ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-600 text-white font-bold text-[10px] shrink-0 shadow-2xs"
                            title={lang === 'zh' ? '当前环节正在同步演示中' : 'Live Syncing'}
                          >
                            <Radio size={10} className="shrink-0 text-white" />
                            <span>{lang === 'zh' ? '演示中' : 'Live'}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartSegment(seg);
                            }}
                            className="px-1.5 py-0.2 rounded text-[10px] font-medium text-muted hover:text-primary-ink hover:bg-primary-theme/10 border border-theme/40 transition-colors flex items-center gap-0.5 cursor-pointer shrink-0"
                            title={lang === 'zh' ? '广播此环节' : 'Broadcast Step'}
                          >
                            <Presentation size={11} />
                            <span>{lang === 'zh' ? '广播' : 'Start'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 抽屉展开内容 Body：白板页面大纲与插件动作扩展 */}
                  {isOpen && (
                    <div className="px-2 pb-2 pt-1 border-t border-theme/40 flex flex-col gap-1.5 bg-surface-secondary/20">
                      {/* 白板页面大纲 */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px] text-muted px-0.5 font-bold">
                          <span>{lang === 'zh' ? '白板页面大纲' : 'Whiteboard Outline'}</span>
                          <button
                            type="button"
                            onClick={onAddPage}
                            className="text-primary-ink hover:underline font-bold flex items-center gap-0.5 cursor-pointer text-[10px]"
                            title={lang === 'zh' ? '在此环节新建页面' : 'Add page to segment'}
                          >
                            <Plus size={10} />
                            <span>{lang === 'zh' ? '加页' : 'Add Page'}</span>
                          </button>
                        </div>

                        {segPages.length > 0 ? (
                          segPages.map(({ page: p, globalIdx }) => {
                            const isPageActive = globalIdx === currentWhiteboardPage;
                            const pageElementsCount = elements.filter((el) => {
                              try {
                                const d = JSON.parse(el.data);
                                return (d.page ?? 0) === globalIdx;
                              } catch {
                                return false;
                              }
                            }).length;

                            return (
                              <div
                                key={p.id || globalIdx}
                                onClick={() => onSelectPage(globalIdx, seg.id)}
                                className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                                  isPageActive
                                    ? 'bg-primary-solid text-white font-semibold shadow-2xs'
                                    : 'bg-surface hover:bg-surface-secondary text-main border border-theme/40'
                                }`}
                                title={
                                  lang === 'zh'
                                    ? `切换至 P${globalIdx + 1} ${p.title || ''}`
                                    : `Switch to P${globalIdx + 1}`
                                }
                              >
                                <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold shrink-0 ${
                                      isPageActive ? 'bg-white/20 text-white' : 'bg-surface-secondary text-muted'
                                    }`}
                                  >
                                    P{globalIdx + 1}
                                  </span>
                                  <span className="truncate tracking-tight font-medium">
                                    {p.title || `${lang === 'zh' ? '页面' : 'Page'} ${globalIdx + 1}`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span
                                    className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                                      isPageActive ? 'bg-white/20 text-white' : 'text-muted'
                                    }`}
                                  >
                                    {pageElementsCount} {lang === 'zh' ? '组件' : 'items'}
                                  </span>
                                  {isPageActive && (
                                    <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-white/25 text-white">
                                      {lang === 'zh' ? '当前' : 'Active'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-[11px] text-muted italic px-2 py-1.5 text-center bg-surface/50 rounded-lg border border-dashed border-theme/50">
                            {lang === 'zh' ? '本环节暂无独立页面' : 'No pages for this segment'}
                          </div>
                        )}
                      </div>

                      {/* 环节步骤卡片动作扩展 */}
                      <ExtensionPointRenderer
                        slot="classroom.agenda.action"
                        slotProps={{
                          segment: seg,
                          isActive,
                          idx,
                          lessonId: selectedLesson,
                          lang,
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-muted italic py-6 text-center">
            {lang === 'zh' ? '请选择一个课节加载流程表' : 'Select a lesson to view schedule.'}
          </div>
        )}
      </div>

      {/* 底部轻量状态指示条 */}
      <div className="p-2 border-t border-theme/60 bg-surface-secondary/20 flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 text-muted">
          <LayoutGrid size={12} className="shrink-0 text-primary-ink/70" />
          <span className="text-[11px] truncate">
            {lang === 'zh' ? '白板:' : 'Page:'}{' '}
            <span className="font-semibold text-main">
              P{currentWhiteboardPage + 1}
              {whiteboardPages[currentWhiteboardPage]?.title
                ? ` (${whiteboardPages[currentWhiteboardPage].title})`
                : ''}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-muted shrink-0 text-[11px]">
          <Radio size={11} className="shrink-0 text-primary-ink" />
          <span className="font-semibold text-main truncate max-w-[90px]">
            {timelineSegments.find((s) => s.id === activeSegmentId)
              ? `#${timelineSegments.findIndex((s) => s.id === activeSegmentId) + 1} ${timelineSegments.find((s) => s.id === activeSegmentId)?.title}`
              : lang === 'zh'
                ? '未广播'
                : 'Idle'}
          </span>
        </div>
      </div>
    </div>
  );
}
