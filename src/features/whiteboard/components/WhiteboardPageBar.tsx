import React, { useMemo } from 'react';
import {
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Edit3,
  Copy,
  Trash2,
  Plus,
  X,
  FileText,
} from 'lucide-react';
import type { WhiteboardPageItem } from '../InteractiveWhiteboard';
import { isPlainEnterSubmit } from '../../../utils/keyboard';

export interface WhiteboardPageBarProps {
  pages: WhiteboardPageItem[];
  currentPage: number;
  activeSegmentId?: string | null;
  showPageDrawer: boolean;
  setShowPageDrawer: (show: boolean) => void;
  editingPageIdx: number | null;
  setEditingPageIdx: (idx: number | null) => void;
  editingPageTitle: string;
  setEditingPageTitle: (title: string) => void;
  activeMenuPageIdx: number | null;
  setActiveMenuPageIdx: (idx: number | null) => void;
  safeElements: any[];
  handleSwitchPage: (idx: number) => void;
  handleRenamePage: (idx: number, newTitle: string) => void;
  handleDuplicatePage: (idx: number) => void;
  handleMovePage: (idx: number, direction: 'left' | 'right') => void;
  handleDeletePage: (idx: number) => void;
  handleAddPage: () => void;
}

export const WhiteboardPageBar: React.FC<WhiteboardPageBarProps> = ({
  pages,
  currentPage,
  activeSegmentId,
  showPageDrawer,
  setShowPageDrawer,
  editingPageIdx,
  setEditingPageIdx,
  editingPageTitle,
  setEditingPageTitle,
  activeMenuPageIdx,
  setActiveMenuPageIdx,
  safeElements,
  handleSwitchPage,
  handleRenamePage,
  handleDuplicatePage,
  handleMovePage,
  handleDeletePage,
  handleAddPage,
}) => {
  const visiblePages = useMemo(() => {
    return pages
      .map((p, globalIdx) => ({ page: p, globalIdx }))
      .filter(({ page }) => !activeSegmentId || !page.segmentId || page.segmentId === activeSegmentId);
  }, [pages, activeSegmentId]);

  const currentVisibleIdx = visiblePages.findIndex(({ globalIdx }) => globalIdx === currentPage);
  return (
    <>
      {/* Top Floating Page Navigation Bar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-surface/90 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg border border-theme font-sans select-none text-main">
        {/* Page Outline / Drawer Button */}
        <button
          onClick={() => setShowPageDrawer(!showPageDrawer)}
          className={`p-1.5 rounded-full transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${
            showPageDrawer
              ? 'bg-primary-theme-light text-primary-theme'
              : 'text-muted hover:bg-surface-secondary hover:text-main'
          }`}
          title="页面大纲与预览 (Pages Outline)"
        >
          <LayoutGrid size={15} />
          <span className="hidden sm:inline text-xs font-semibold">大纲 ({visiblePages.length})</span>
        </button>

        <div className="h-4 w-px bg-border-theme mx-0.5" />

        {/* Previous Page */}
        <button
          onClick={() => {
            if (currentVisibleIdx > 0) {
              handleSwitchPage(visiblePages[currentVisibleIdx - 1].globalIdx);
            }
          }}
          className="p-1 hover:bg-surface-secondary rounded-full text-muted hover:text-main disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
          disabled={currentVisibleIdx <= 0}
          title="上一页"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page Tabs */}
        <div className="flex items-center gap-1 max-w-[500px] overflow-x-auto no-scrollbar py-0.5">
          {visiblePages.map(({ page: pageItem, globalIdx }, localIdx) => {
            const isActive = globalIdx === currentPage;
            const isEditing = editingPageIdx === globalIdx;
            return (
              <div key={pageItem.id || globalIdx} className="relative group flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    autoFocus
                    value={editingPageTitle}
                    onChange={(e) => setEditingPageTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (isPlainEnterSubmit(e)) {
                        e.preventDefault();
                        handleRenamePage(globalIdx, editingPageTitle);
                      }
                      if (e.key === 'Escape') setEditingPageIdx(null);
                    }}
                    onBlur={() => handleRenamePage(globalIdx, editingPageTitle)}
                    className="px-2 py-0.5 text-xs font-bold bg-surface border border-primary-theme rounded-full outline-none w-28 text-main shadow-2xs"
                  />
                ) : (
                  <button
                    onClick={() => handleSwitchPage(globalIdx)}
                    onDoubleClick={() => {
                      setEditingPageIdx(globalIdx);
                      setEditingPageTitle(pageItem.title);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 border ${
                      isActive
                        ? 'bg-primary-theme text-white border-primary-theme shadow-2xs'
                        : 'text-muted hover:bg-surface-secondary hover:text-main border-transparent'
                    }`}
                    title="双击重命名"
                  >
                    <span className="truncate max-w-[120px]">{pageItem.title}</span>
                  </button>
                )}

                {/* Quick Menu Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenuPageIdx(activeMenuPageIdx === globalIdx ? null : globalIdx);
                  }}
                  className={`p-0.5 rounded-full hover:bg-black/10 transition-colors ml-[-4px] z-10 ${
                    isActive ? 'text-white/80 hover:text-white' : 'text-muted hover:text-main'
                  }`}
                  title="页面选项"
                >
                  <ChevronDown size={12} />
                </button>

                {/* Dropdown Options Menu */}
                {activeMenuPageIdx === globalIdx && (
                  <div
                    className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-surface rounded-xl shadow-xl border border-theme py-1 w-36 z-50 text-xs font-normal text-main"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setEditingPageIdx(globalIdx);
                        setEditingPageTitle(pageItem.title);
                        setActiveMenuPageIdx(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                    >
                      <Edit3 size={13} /> 重命名
                    </button>
                    <button
                      onClick={() => {
                        handleDuplicatePage(globalIdx);
                        setActiveMenuPageIdx(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                    >
                      <Copy size={13} /> 复制页面
                    </button>

                    {localIdx > 0 && (
                      <button
                        onClick={() => {
                          handleMovePage(globalIdx, 'left');
                          setActiveMenuPageIdx(null);
                        }}
                        className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                      >
                        <ChevronLeft size={13} /> 向左移动
                      </button>
                    )}

                    {localIdx < visiblePages.length - 1 && (
                      <button
                        onClick={() => {
                          handleMovePage(globalIdx, 'right');
                          setActiveMenuPageIdx(null);
                        }}
                        className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                      >
                        <ChevronRight size={13} /> 向右移动
                      </button>
                    )}

                    <div className="my-1 border-t border-theme" />
                    <button
                      onClick={() => {
                        handleDeletePage(globalIdx);
                        setActiveMenuPageIdx(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-rose-500 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer disabled:opacity-30"
                      disabled={pages.length <= 1}
                    >
                      <Trash2 size={13} /> 删除页面
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Page Button */}
        <button
          onClick={() => handleAddPage()}
          className="p-1 hover:bg-primary-theme-light hover:text-primary-theme text-muted rounded-full transition-colors cursor-pointer ml-0.5"
          title="新建白板页面"
        >
          <Plus size={16} />
        </button>

        {/* Next Page */}
        <button
          onClick={() => {
            if (currentVisibleIdx >= 0 && currentVisibleIdx < visiblePages.length - 1) {
              handleSwitchPage(visiblePages[currentVisibleIdx + 1].globalIdx);
            }
          }}
          className="p-1 hover:bg-surface-secondary rounded-full text-muted hover:text-main disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
          disabled={currentVisibleIdx === -1 || currentVisibleIdx >= visiblePages.length - 1}
          title="下一页"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Page Outline & Thumbnail Drawer Overlay */}
      {showPageDrawer && (
        <div
          className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs z-30 flex flex-col justify-end pointer-events-auto font-sans"
          onClick={() => setShowPageDrawer(false)}
        >
          <div
            className="bg-surface/95 backdrop-blur-xl border-t border-theme rounded-t-2xl shadow-2xl p-4 max-h-[70vh] flex flex-col w-full max-w-5xl mx-auto animate-in slide-in-from-bottom duration-200 text-main"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-theme shrink-0">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-primary-theme" />
                <h3 className="font-bold text-main text-sm">白板页面大纲与预览</h3>
                <span className="px-2 py-0.5 bg-primary-theme-light text-primary-theme text-xs rounded-full font-semibold">
                  共 {visiblePages.length} 页
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAddPage()}
                  className="px-3 py-1.5 bg-primary-theme hover:bg-primary-theme-hover text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Plus size={14} /> 新建页面
                </button>
                <button
                  onClick={() => setShowPageDrawer(false)}
                  className="p-1.5 hover:bg-surface-secondary rounded-full text-muted hover:text-main transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Pages Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 py-4 overflow-y-auto max-h-[50vh]">
              {visiblePages.map(({ page: p, globalIdx }, localIdx) => {
                const isActive = globalIdx === currentPage;
                const pageElementCount = safeElements.filter(
                  (el) =>
                    el.type !== 'page_meta' &&
                    (() => {
                      try {
                        const d = JSON.parse(el.data);
                        if (activeSegmentId && d.segmentId && d.segmentId !== activeSegmentId) return false;
                        return (d.page ?? 0) === globalIdx || d.pageId === p.id;
                      } catch {
                        return globalIdx === 0;
                      }
                    })(),
                ).length;

                return (
                  <div
                    key={p.id || globalIdx}
                    onClick={() => {
                      handleSwitchPage(globalIdx);
                      setShowPageDrawer(false);
                    }}
                    className={`relative flex flex-col p-3 rounded-xl border-2 transition-all cursor-pointer group bg-surface ${
                      isActive
                        ? 'border-primary-theme bg-primary-theme-light/30 shadow-md ring-2 ring-[var(--color-primary)]/20'
                        : 'border-theme hover:border-primary-theme hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${
                          isActive ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-muted'
                        }`}
                      >
                        P{localIdx + 1}
                      </span>
                      {isActive && (
                        <span className="text-xs font-bold text-primary-theme bg-primary-theme-light px-1.5 py-0.5 rounded">
                          当前激活
                        </span>
                      )}
                    </div>

                    <div className="h-20 bg-surface-secondary border border-theme rounded-lg flex flex-col items-center justify-center mb-2 overflow-hidden relative">
                      <FileText size={24} className={isActive ? 'text-primary-theme' : 'text-subtle'} />
                      <span className="text-xs text-muted font-medium mt-1">{pageElementCount} 个组件/笔画</span>
                    </div>

                    <div className="font-bold text-xs text-main truncate mb-1" title={p.title}>
                      {p.title}
                    </div>

                    <div
                      className="flex items-center justify-between pt-2 border-t border-theme text-muted text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setEditingPageIdx(globalIdx);
                          setEditingPageTitle(p.title);
                        }}
                        className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                        title="重命名"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => handleDuplicatePage(globalIdx)}
                        className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                        title="复制页面"
                      >
                        <Copy size={13} />
                      </button>
                      {localIdx > 0 && (
                        <button
                          onClick={() => handleMovePage(globalIdx, 'left')}
                          className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                          title="向左移"
                        >
                          <ChevronLeft size={13} />
                        </button>
                      )}
                      {localIdx < visiblePages.length - 1 && (
                        <button
                          onClick={() => handleMovePage(globalIdx, 'right')}
                          className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                          title="向右移"
                        >
                          <ChevronRight size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePage(globalIdx)}
                        className="hover:text-rose-500 p-1 rounded hover:bg-rose-500/10 transition-colors disabled:opacity-30"
                        disabled={pages.length <= 1}
                        title="删除页面"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
