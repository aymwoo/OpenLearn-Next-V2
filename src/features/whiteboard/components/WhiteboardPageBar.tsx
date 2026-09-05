import React from 'react';
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
  FileText
} from 'lucide-react';
import type { WhiteboardPageItem } from '../InteractiveWhiteboard';

export interface WhiteboardPageBarProps {
  pages: WhiteboardPageItem[];
  currentPage: number;
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
  handleAddPage
}) => {
  return (
    <>
      {/* Bottom Page Navigation Bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-surface/90 backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg border border-theme font-sans select-none text-main">
        {/* Page Outline / Drawer Button */}
        <button
          onClick={() => setShowPageDrawer(!showPageDrawer)}
          className={`p-1.5 rounded-full transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${
            showPageDrawer ? 'bg-primary-theme-light text-primary-theme' : 'text-muted hover:bg-surface-secondary hover:text-main'
          }`}
          title="页面大纲与预览 (Pages Outline)"
        >
          <LayoutGrid size={15} />
          <span className="hidden sm:inline text-[11px] font-semibold">大纲 ({pages.length})</span>
        </button>

        <div className="h-4 w-px bg-border-theme mx-0.5" />

        {/* Previous Page */}
        <button
          onClick={() => handleSwitchPage(Math.max(0, currentPage - 1))}
          className="p-1 hover:bg-surface-secondary rounded-full text-muted hover:text-main disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
          disabled={currentPage === 0}
          title="上一页"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page Tabs */}
        <div className="flex items-center gap-1 max-w-[500px] overflow-x-auto no-scrollbar py-0.5">
          {pages.map((pageItem, idx) => {
            const isActive = idx === currentPage;
            const isEditing = editingPageIdx === idx;
            return (
              <div key={pageItem.id || idx} className="relative group flex items-center">
                {isEditing ? (
                  <input
                    type="text"
                    autoFocus
                    value={editingPageTitle}
                    onChange={(e) => setEditingPageTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenamePage(idx, editingPageTitle);
                      if (e.key === 'Escape') setEditingPageIdx(null);
                    }}
                    onBlur={() => handleRenamePage(idx, editingPageTitle)}
                    className="px-2 py-0.5 text-xs font-bold bg-surface border border-primary-theme rounded-full outline-none w-28 text-main shadow-2xs"
                  />
                ) : (
                  <button
                    onClick={() => handleSwitchPage(idx)}
                    onDoubleClick={() => {
                      setEditingPageIdx(idx);
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
                    setActiveMenuPageIdx(activeMenuPageIdx === idx ? null : idx);
                  }}
                  className={`p-0.5 rounded-full hover:bg-black/10 transition-colors ml-[-4px] z-10 ${
                    isActive ? 'text-white/80 hover:text-white' : 'text-muted hover:text-main'
                  }`}
                  title="页面选项"
                >
                  <ChevronDown size={12} />
                </button>

                {/* Dropdown Options Menu */}
                {activeMenuPageIdx === idx && (
                  <div
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-surface rounded-xl shadow-xl border border-theme py-1 w-36 z-50 text-xs font-normal text-main"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setEditingPageIdx(idx);
                        setEditingPageTitle(pageItem.title);
                        setActiveMenuPageIdx(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                    >
                      <Edit3 size={13} /> 重命名
                    </button>
                    <button
                      onClick={() => {
                        handleDuplicatePage(idx);
                        setActiveMenuPageIdx(null);
                      }}
                      className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                    >
                      <Copy size={13} /> 复制页面
                    </button>

                    {idx > 0 && (
                      <button
                        onClick={() => {
                          handleMovePage(idx, 'left');
                          setActiveMenuPageIdx(null);
                        }}
                        className="w-full px-3 py-1.5 text-left text-main hover:bg-primary-theme-light hover:text-primary-theme flex items-center gap-2 cursor-pointer"
                      >
                        <ChevronLeft size={13} /> 向左移动
                      </button>
                    )}

                    {idx < pages.length - 1 && (
                      <button
                        onClick={() => {
                          handleMovePage(idx, 'right');
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
                        handleDeletePage(idx);
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
          onClick={() => handleSwitchPage(Math.min(pages.length - 1, currentPage + 1))}
          className="p-1 hover:bg-surface-secondary rounded-full text-muted hover:text-main disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
          disabled={currentPage >= pages.length - 1}
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
                  共 {pages.length} 页
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
              {pages.map((p, idx) => {
                const isActive = idx === currentPage;
                const pageElementCount = safeElements.filter((el) => el.type !== 'page_meta' && (() => {
                  try {
                    const d = JSON.parse(el.data);
                    return (d.page ?? 0) === idx || d.pageId === p.id;
                  } catch {
                    return idx === 0;
                  }
                })()).length;

                return (
                  <div
                    key={p.id || idx}
                    onClick={() => {
                      handleSwitchPage(idx);
                      setShowPageDrawer(false);
                    }}
                    className={`relative flex flex-col p-3 rounded-xl border-2 transition-all cursor-pointer group bg-surface ${
                      isActive
                        ? 'border-primary-theme bg-primary-theme-light/30 shadow-md ring-2 ring-[var(--color-primary)]/20'
                        : 'border-theme hover:border-primary-theme hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md ${
                        isActive ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-muted'
                      }`}>
                        P{idx + 1}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-bold text-primary-theme bg-primary-theme-light px-1.5 py-0.5 rounded">
                          当前激活
                        </span>
                      )}
                    </div>

                    <div className="h-20 bg-surface-secondary border border-theme rounded-lg flex flex-col items-center justify-center mb-2 overflow-hidden relative">
                      <FileText size={24} className={isActive ? 'text-primary-theme' : 'text-subtle'} />
                      <span className="text-[10px] text-muted font-medium mt-1">
                        {pageElementCount} 个组件/笔画
                      </span>
                    </div>

                    <div className="font-bold text-xs text-main truncate mb-1" title={p.title}>
                      {p.title}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-theme text-muted text-[11px]" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingPageIdx(idx);
                          setEditingPageTitle(p.title);
                        }}
                        className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                        title="重命名"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => handleDuplicatePage(idx)}
                        className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                        title="复制页面"
                      >
                        <Copy size={13} />
                      </button>
                      {idx > 0 && (
                        <button
                          onClick={() => handleMovePage(idx, 'left')}
                          className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                          title="向左移"
                        >
                          <ChevronLeft size={13} />
                        </button>
                      )}
                      {idx < pages.length - 1 && (
                        <button
                          onClick={() => handleMovePage(idx, 'right')}
                          className="hover:text-primary-theme p-1 rounded hover:bg-surface-secondary transition-colors"
                          title="向右移"
                        >
                          <ChevronRight size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePage(idx)}
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
