import React, { useState } from 'react';
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
} from 'lucide-react';
import { PaletteCard } from './PaletteCard';
import { PALETTE_GROUPS, PALETTE_ITEMS, COLOR_THEME } from './paletteConfig';
import { usePluginPaletteItems } from './palette-item-registry';

interface LessonPaletteProps {
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
}

export function LessonPalette({
  lang,
  onActivate,
  collapsed: controlledCollapsed,
  onToggleCollapse,
}: LessonPaletteProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setInternalCollapsed(next);
    if (onToggleCollapse) onToggleCollapse(next);
  };

  const [searchQuery, setSearchQuery] = useState('');
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
      const matchZh =
        item.labelZh.toLowerCase().includes(q) || item.descriptionZh.toLowerCase().includes(q);
      const matchEn =
        item.labelEn.toLowerCase().includes(q) || item.descriptionEn.toLowerCase().includes(q);
      if (!matchZh && !matchEn) return false;
    }
    if (activeTab === 'favorites') return favorites.includes(item.type);
    if (activeTab === 'recent') return recent.includes(item.type);
    return true;
  });

  // ── Mini Dock 紧凑收起模式 ──
  if (isCollapsed) {
    return (
      <div className="w-14 shrink-0 border-r border-theme bg-surface-secondary/40 backdrop-blur-md p-2 flex flex-col items-center gap-3 select-none transition-all duration-300">
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-10 h-10 rounded-xl bg-surface hover:bg-surface-secondary border border-theme text-muted hover:text-main flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
          title={lang === 'zh' ? '展开备课组件库 (Ctrl+B)' : 'Expand Component Palette'}
        >
          <PanelLeftOpen size={16} />
        </button>

        <div className="w-8 h-px bg-border/60 my-0.5" />

        {/* 紧凑常用组件图标 */}
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-220px)] p-0.5">
          {allItems.slice(0, 8).map((item) => {
            const Icon = item.icon || Blocks;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => handleActivate(item.type)}
                className="w-10 h-10 rounded-xl bg-surface hover:bg-primary-theme/10 hover:border-primary-theme border border-theme text-main flex items-center justify-center transition-all cursor-pointer shadow-2xs group relative"
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
    <div className="w-[260px] shrink-0 border-r border-theme bg-surface-secondary/40 backdrop-blur-md p-3.5 overflow-y-auto flex flex-col gap-3.5 font-sans select-none text-main transition-all duration-300">
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
      </div>
    </div>
  );
}
