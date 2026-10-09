import React, { useState, useEffect } from 'react';
import {
  Blocks,
  Search,
  X,
  Star,
  Clock,
  ChevronDown,
  ChevronRight,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutGrid,
  Plus,
  Trash2,
  Edit3,
} from 'lucide-react';
import { PaletteCard } from './PaletteCard';
import { PALETTE_GROUPS, PALETTE_ITEMS, COLOR_THEME } from './paletteConfig';
import { usePluginPaletteItems } from './palette-item-registry';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { WhiteboardPageItem, WhiteboardDragState } from '../../whiteboard/InteractiveWhiteboard';

export interface LessonPaletteProps {
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
  readOnly?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
  pages?: WhiteboardPageItem[];
  currentPage?: number;
  onSwitchPage?: (idx: number) => void;
  onAddPage?: (customTitle?: string) => void;
  onDeletePage?: (idx: number) => void;
  onRenamePage?: (idx: number, newTitle: string) => void;
  dragState?: WhiteboardDragState | null;
  onHoverDropTarget?: (target: { type: 'page'; pageIndex: number } | null) => void;
}

export function LessonPalette({
  lang,
  onActivate,
  readOnly = false,
  collapsed: controlledCollapsed,
  onToggleCollapse,
  pages,
  currentPage = 0,
  onSwitchPage,
  onAddPage,
  onDeletePage,
  onRenamePage,
  dragState,
  onHoverDropTarget,
}: LessonPaletteProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setInternalCollapsed(next);
    if (onToggleCollapse) onToggleCollapse(next);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [editingPageIdx, setEditingPageIdx] = useState<number | null>(null);
  const [editingPageTitle, setEditingPageTitle] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'recent'>('all');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('openlearn_palette_favs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('openlearn_palette_recent');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const handleActivate = (type: string) => {
    if (readOnly) return;
    setRecent((prev) => {
      const next = [type, ...prev.filter((t) => t !== type)].slice(0, 6);
      try {
        localStorage.setItem('openlearn_palette_recent', JSON.stringify(next));
      } catch {}
      return next;
    });
    onActivate(type);
  };

  const handleToggleFavorite = (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const isFav = prev.includes(type);
      const next = isFav ? prev.filter((t) => t !== type) : [...prev, type];
      try {
        localStorage.setItem('openlearn_palette_favs', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const pluginItems = usePluginPaletteItems();
  const allItems = [...PALETTE_ITEMS, ...pluginItems];

  const filteredItems = allItems.filter((item) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchZh = item.labelZh.toLowerCase().includes(q) || item.descriptionZh.toLowerCase().includes(q);
      const matchEn = item.labelEn.toLowerCase().includes(q) || item.descriptionEn.toLowerCase().includes(q);
      if (!matchZh && !matchEn) return false;
    }
    if (activeTab === 'favorites') return favorites.includes(item.type);
    if (activeTab === 'recent') return recent.includes(item.type);
    return true;
  });

  const paletteContainerRef = React.useRef<HTMLDivElement | null>(null);
  const outlineCardRef = React.useRef<HTMLDivElement | null>(null);
  const paletteExpandTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const outlineExpandTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const [hoveredDropPageIdx, setHoveredDropPageIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!dragState) {
      if (outlineExpandTimerRef.current) {
        clearTimeout(outlineExpandTimerRef.current);
        outlineExpandTimerRef.current = null;
      }
      if (paletteExpandTimerRef.current) {
        clearTimeout(paletteExpandTimerRef.current);
        paletteExpandTimerRef.current = null;
      }
      setHoveredDropPageIdx(null);
      onHoverDropTarget?.(null);
      return;
    }

    const { clientX, clientY } = dragState;

    // 1. 如果画板整体收起（collapsed），当拖动到画板上方时，250ms 自动展开
    if (paletteContainerRef.current) {
      const paletteRect = paletteContainerRef.current.getBoundingClientRect();
      const isInsidePalette =
        clientX >= paletteRect.left &&
        clientX <= paletteRect.right &&
        clientY >= paletteRect.top &&
        clientY <= paletteRect.bottom;

      if (isInsidePalette && isCollapsed) {
        if (!paletteExpandTimerRef.current) {
          paletteExpandTimerRef.current = setTimeout(() => {
            setInternalCollapsed(false);
            onToggleCollapse?.(false);
            paletteExpandTimerRef.current = null;
          }, 250);
        }
      } else if (!isInsidePalette && paletteExpandTimerRef.current) {
        clearTimeout(paletteExpandTimerRef.current);
        paletteExpandTimerRef.current = null;
      }
    }

    // 2. 如果页面大纲折叠（isOutlineCollapsed），当拖动到大纲上方时，250ms 自动展开
    if (outlineCardRef.current) {
      const outlineRect = outlineCardRef.current.getBoundingClientRect();
      const isInsideOutline =
        clientX >= outlineRect.left &&
        clientX <= outlineRect.right &&
        clientY >= outlineRect.top &&
        clientY <= outlineRect.bottom;

      if (isInsideOutline && isOutlineCollapsed) {
        if (!outlineExpandTimerRef.current) {
          outlineExpandTimerRef.current = setTimeout(() => {
            setIsOutlineCollapsed(false);
            outlineExpandTimerRef.current = null;
          }, 250);
        }
      } else if (!isInsideOutline && outlineExpandTimerRef.current) {
        clearTimeout(outlineExpandTimerRef.current);
        outlineExpandTimerRef.current = null;
      }

      // 3. 当大纲展开时，检测鼠标悬停在哪一个页面卡片上
      if (!isOutlineCollapsed && pages && pages.length > 0) {
        let matchedIdx: number | null = null;
        const pageEls = outlineCardRef.current.querySelectorAll('[data-page-index]');
        pageEls.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            const idxAttr = el.getAttribute('data-page-index');
            if (idxAttr !== null) {
              matchedIdx = parseInt(idxAttr, 10);
            }
          }
        });

        if (matchedIdx !== null && matchedIdx !== dragState.initialPage) {
          setHoveredDropPageIdx(matchedIdx);
          onHoverDropTarget?.({ type: 'page', pageIndex: matchedIdx });
        } else {
          setHoveredDropPageIdx(null);
          onHoverDropTarget?.(null);
        }
      }
    }
  }, [dragState, isCollapsed, isOutlineCollapsed, pages, onToggleCollapse, onHoverDropTarget]);

  // ── Mini Dock 紧凑收起模式 ──
  if (isCollapsed) {
    return (
      <div
        ref={paletteContainerRef}
        className={`w-14 shrink-0 border-r border-theme bg-surface-secondary/40 backdrop-blur-md p-2 flex flex-col items-center gap-3 select-none transition-all duration-300 ${
          dragState ? 'ring-2 ring-primary-theme/50 bg-primary-theme/10' : ''
        }`}
      >
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-10 h-10 rounded-xl bg-surface hover:bg-surface-secondary border border-theme text-muted hover:text-main flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
          title={lang === 'zh' ? '展开备课组件库 (Ctrl+B)' : 'Expand Component Palette'}
        >
          <PanelLeftOpen size={16} />
        </button>

        <div className="w-8 h-px bg-border/60 my-0.5" />

        {/* 紧凑模式下的大纲快捷指示 */}
        {pages && pages.length > 0 && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="w-10 h-10 rounded-xl bg-surface hover:bg-primary-theme/10 border border-theme text-primary-theme flex items-center justify-center transition-all cursor-pointer shadow-2xs group relative"
            title={`${lang === 'zh' ? '页面大纲' : 'Outline'} (P${currentPage + 1}/${pages.length}) - ${lang === 'zh' ? '点击展开' : 'Click to expand'}`}
          >
            <LayoutGrid size={16} />
            <span className="absolute -top-1 -right-1 text-[9px] bg-primary-theme text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {currentPage + 1}
            </span>
          </button>
        )}

        {/* 紧凑常用组件图标 */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-220px)] p-0.5">
          {allItems.slice(0, 8).map((item) => {
            const Icon = item.icon || Blocks;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => handleActivate(item.type)}
                disabled={readOnly}
                aria-disabled={readOnly}
                className={`w-10 h-10 rounded-xl bg-surface border border-theme text-main flex items-center justify-center transition-all shadow-2xs group relative ${readOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-theme/10 hover:border-primary-theme cursor-pointer'}`}
                title={`${lang === 'zh' ? item.labelZh : item.labelEn} - ${lang === 'zh' ? '点击配置' : 'Configure'}`}
              >
                <Icon size={16} className="text-primary-theme transition-transform group-hover:scale-110" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 展开完整模式 ──
  return (
    <div
      ref={paletteContainerRef}
      className={`w-[260px] shrink-0 border-r border-theme bg-surface-secondary/40 backdrop-blur-md p-3.5 overflow-y-auto flex flex-col gap-3.5 font-sans select-none text-main transition-all duration-300 ${
        dragState && hoveredDropPageIdx !== null ? 'ring-1 ring-primary-theme/30' : ''
      }`}
    >
      {/* 头部与折叠按钮 */}
      <div className="flex items-center justify-between border-b border-theme/60 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-theme/10 text-primary-theme flex items-center justify-center">
            <Blocks size={15} />
          </div>
          <div>
            <h3 className="text-xs font-black text-main uppercase tracking-wider">
              {lang === 'zh' ? '备课组件画板' : 'Palette'}
            </h3>
            <span className="text-[10px] text-muted">
              {filteredItems.length} {lang === 'zh' ? '个可用组件' : 'components'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface border border-theme/50 transition-colors cursor-pointer"
          title={lang === 'zh' ? '收起组件面板以扩大画布' : 'Collapse Palette'}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* 页面大纲卡片（置顶且可折叠） */}
      {pages && pages.length > 0 && (
        <div
          ref={outlineCardRef}
          className={`bg-surface rounded-xl border border-theme p-2.5 flex flex-col gap-2 shadow-2xs transition-all duration-200 ${
            hoveredDropPageIdx !== null ? 'border-primary-theme shadow-md ring-1 ring-primary-theme/30' : ''
          }`}
        >
          {/* 大纲标题栏（可点击折叠/展开） */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsOutlineCollapsed((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-bold text-main hover:text-primary-theme transition-colors cursor-pointer"
            >
              <LayoutGrid size={14} className="text-primary-theme" />
              <span>
                {lang === 'zh' ? '页面大纲' : 'Outline'} ({pages.length})
              </span>
              <ChevronDown
                size={13}
                className={`text-muted transition-transform duration-200 ${isOutlineCollapsed ? '-rotate-90' : ''}`}
              />
            </button>
            {!readOnly && onAddPage && (
              <button
                type="button"
                onClick={() => onAddPage()}
                className="p-1 rounded-md text-muted hover:text-primary-theme hover:bg-primary-theme/10 transition-colors cursor-pointer"
                title={lang === 'zh' ? '新建白板页面' : 'Add page'}
              >
                <Plus size={13} />
              </button>
            )}
          </div>

          {/* 折叠简报 */}
          {isOutlineCollapsed ? (
            <div
              onClick={() => setIsOutlineCollapsed(false)}
              className={`flex items-center justify-between text-2xs px-2 py-1 bg-surface-secondary/70 rounded-lg text-muted hover:text-main cursor-pointer transition-colors ${
                dragState
                  ? 'border border-dashed border-primary-theme/60 bg-primary-theme/10 text-primary-theme font-medium animate-pulse'
                  : ''
              }`}
            >
              <span className="truncate max-w-[170px]">
                {dragState
                  ? lang === 'zh'
                    ? '🎯 悬停自动展开页面大纲'
                    : '🎯 Hover to expand outline'
                  : `${lang === 'zh' ? '当前' : 'Current'}: ${pages[currentPage]?.title || `P${currentPage + 1}`}`}
              </span>
              <span className="text-[10px] text-primary-theme font-medium">{lang === 'zh' ? '展开' : 'Expand'}</span>
            </div>
          ) : (
            /* 展开列表 */
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-0.5 no-scrollbar">
              {pages.map((p, idx) => {
                const isActive = idx === currentPage;
                const isEditing = editingPageIdx === idx;
                const isDropTarget = hoveredDropPageIdx === idx;
                return (
                  <div
                    key={p.id || idx}
                    data-page-index={idx}
                    onClick={() => {
                      if (!isEditing) onSwitchPage?.(idx);
                    }}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                      isDropTarget
                        ? 'ring-2 ring-primary-theme ring-offset-1 border-dashed border-2 border-primary-theme bg-primary-theme/15 animate-pulse'
                        : isActive
                          ? 'bg-primary-theme text-white font-semibold shadow-xs'
                          : 'bg-surface hover:bg-surface-secondary text-main border border-theme/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                      <span
                        className={`text-[10px] px-1 py-0.2 rounded font-mono shrink-0 ${
                          isDropTarget
                            ? 'bg-primary-theme text-white font-bold'
                            : isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-surface-secondary text-muted'
                        }`}
                      >
                        P{idx + 1}
                      </span>
                      {isEditing ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingPageTitle}
                          onChange={(e) => setEditingPageTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (editingPageTitle.trim()) onRenamePage?.(idx, editingPageTitle.trim());
                              setEditingPageIdx(null);
                            }
                            if (e.key === 'Escape') setEditingPageIdx(null);
                          }}
                          onBlur={() => {
                            if (editingPageTitle.trim()) onRenamePage?.(idx, editingPageTitle.trim());
                            setEditingPageIdx(null);
                          }}
                          className="px-1.5 py-0.5 text-xs bg-surface border border-primary-theme rounded text-main outline-none w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="truncate">{p.title}</span>
                      )}
                    </div>

                    {isDropTarget && (
                      <span className="text-[10px] font-bold text-primary-theme animate-bounce shrink-0 flex items-center gap-1 pl-1">
                        <span>📥</span>
                        <span>{lang === 'zh' ? '松开移入' : 'Drop'}</span>
                      </span>
                    )}

                    {!readOnly && !isEditing && (
                      <div
                        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onRenamePage && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPageIdx(idx);
                              setEditingPageTitle(p.title);
                            }}
                            className={`p-0.5 rounded hover:bg-black/10 cursor-pointer ${isActive ? 'text-white' : 'text-muted hover:text-main'}`}
                            title="重命名"
                          >
                            <Edit3 size={11} />
                          </button>
                        )}
                        {pages.length > 1 && onDeletePage && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`确定删除页面"${p.title}"吗？页面内的组件也将被清理。`)) {
                                onDeletePage(idx);
                              }
                            }}
                            className={`p-0.5 rounded hover:bg-rose-500/20 text-rose-500 cursor-pointer ${isActive ? 'text-white hover:bg-white/20' : ''}`}
                            title="删除此页"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={lang === 'zh' ? '搜索画板组件...' : 'Search components...'}
          className="w-full pl-8 pr-7 py-1.5 bg-surface border border-theme rounded-xl text-xs text-main placeholder-muted outline-none focus:border-primary-theme focus:ring-1 focus:ring-primary-theme transition-all shadow-2xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-main cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* 分类药丸 Tab */}
      <div className="flex items-center gap-1 bg-surface border border-theme p-1 rounded-xl shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`flex-1 py-1 text-xs rounded-lg transition-all cursor-pointer ${
            activeTab === 'all'
              ? 'bg-surface-secondary text-main font-bold shadow-2xs'
              : 'text-muted hover:text-main font-medium'
          }`}
        >
          {lang === 'zh' ? '全部' : 'All'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 py-1 text-xs rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'favorites'
              ? 'bg-amber-500/10 text-amber-600 font-bold border border-amber-500/20 shadow-2xs'
              : 'text-muted hover:text-amber-500 font-medium'
          }`}
        >
          <Star size={11} className={activeTab === 'favorites' ? 'fill-amber-500' : ''} />
          <span>{lang === 'zh' ? '常用' : 'Favs'}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('recent')}
          className={`flex-1 py-1 text-xs rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'recent'
              ? 'bg-primary-theme/10 text-primary-theme font-bold border border-primary-theme/20 shadow-2xs'
              : 'text-muted hover:text-primary-theme font-medium'
          }`}
        >
          <Clock size={11} />
          <span>{lang === 'zh' ? '最近' : 'Recent'}</span>
        </button>
      </div>

      {/* 组件网格列表 */}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-0.5">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-muted text-xs">
            <Sparkles size={24} className="mx-auto mb-2 opacity-30 text-primary-theme" />
            <p className="font-bold text-main">{lang === 'zh' ? '未找到相关组件' : 'No components found'}</p>
            <p className="text-[11px] mt-1 text-muted">
              {activeTab !== 'all'
                ? lang === 'zh'
                  ? '尝试切换回「全部」标签'
                  : 'Try switching to All tab'
                : lang === 'zh'
                  ? '请更换关键词重新搜索'
                  : 'Try a different keyword'}
            </p>
          </div>
        ) : activeTab !== 'all' || searchQuery.trim() ? (
          <div className="grid grid-cols-2 gap-2">
            {filteredItems.map((item) => (
              <PaletteCard
                key={item.type}
                config={item}
                lang={lang}
                onActivate={handleActivate}
                disabled={readOnly}
                isFavorite={favorites.includes(item.type)}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        ) : (
          (() => {
            const allGroups = [...PALETTE_GROUPS];
            filteredItems.forEach((item) => {
              if (!allGroups.some((g) => g.id === item.group)) {
                allGroups.push({
                  id: item.group,
                  labelZh: item.group,
                  labelEn: item.group,
                });
              }
            });

            return allGroups.map((group) => {
              const items = filteredItems.filter((i) => i.group === group.id);
              if (items.length === 0) return null;
              const accent = COLOR_THEME[items[0].color] || COLOR_THEME.indigo;
              const isCollapsedGrp = collapsedGroups[group.id];

              return (
                <div key={group.id} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapse(group.id)}
                    className="flex items-center justify-between px-1.5 py-1 text-left rounded-lg transition-colors cursor-pointer hover:bg-surface-secondary/60"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${accent.groupAccent}`} />
                      <span className={`text-[11px] font-black uppercase tracking-wider ${accent.groupText}`}>
                        {lang === 'zh' ? group.labelZh : group.labelEn}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-muted">
                      <span className="text-[10px] font-mono opacity-80">({items.length})</span>
                      {isCollapsedGrp ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </button>

                  {!isCollapsedGrp && (
                    <div className="grid grid-cols-2 gap-2">
                      {items.map((item) => (
                        <PaletteCard
                          key={item.type}
                          config={item}
                          lang={lang}
                          onActivate={handleActivate}
                          disabled={readOnly}
                          isFavorite={favorites.includes(item.type)}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()
        )}

        {/* 声明式图元卡片扩展 */}
        <ExtensionPointRenderer
          slot="editor.palette_item"
          slotProps={{
            lang,
            onActivate: handleActivate,
            readOnly,
          }}
        />
      </div>
    </div>
  );
}
