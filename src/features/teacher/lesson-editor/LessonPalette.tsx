import React, { useState, useEffect } from 'react';
import { Blocks, Search, X, Star, Clock, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { PaletteCard } from './PaletteCard';
import { PALETTE_GROUPS, PALETTE_ITEMS, COLOR_THEME } from './paletteConfig';

interface LessonPaletteProps {
  lang: 'zh' | 'en';
  onActivate: (type: string) => void;
}

export function LessonPalette({ lang, onActivate }: LessonPaletteProps) {
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
    // Record recent
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

  // Filtering items
  const filteredItems = PALETTE_ITEMS.filter((item) => {
    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchZh = item.labelZh.toLowerCase().includes(q) || item.descriptionZh.toLowerCase().includes(q);
      const matchEn = item.labelEn.toLowerCase().includes(q) || item.descriptionEn.toLowerCase().includes(q);
      if (!matchZh && !matchEn) return false;
    }
    // Tab filter
    if (activeTab === 'favorites') return favorites.includes(item.type);
    if (activeTab === 'recent') return recent.includes(item.type);
    return true;
  });

  return (
    <div className="w-[240px] shrink-0 border-r border-slate-200/80 bg-slate-50/90 p-3 overflow-y-auto flex flex-col gap-3 font-sans select-none">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <Blocks size={15} className="text-indigo-600" />
            {lang === 'zh' ? '备课画板组件' : 'Components'}
          </h3>
          <span className="text-[10px] font-semibold text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded-full">
            {filteredItems.length}
          </span>
        </div>
        <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
          {lang === 'zh' ? '拖拽到右侧白板，或点击配置添加到画板。' : 'Drag to whiteboard or click to configure.'}
        </p>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={lang === 'zh' ? '搜索画板组件...' : 'Search components...'}
          className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-2xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Quick Filter Tabs */}
      <div className="flex items-center gap-1 bg-slate-200/50 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all ${
            activeTab === 'all' ? 'bg-white text-slate-800 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {lang === 'zh' ? '全部' : 'All'}
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
            activeTab === 'favorites' ? 'bg-white text-amber-600 shadow-2xs font-bold' : 'text-slate-500 hover:text-amber-600'
          }`}
        >
          <Star size={11} className={activeTab === 'favorites' ? 'fill-amber-500' : ''} />
          <span>{lang === 'zh' ? '收藏' : 'Favs'}</span>
        </button>
        <button
          onClick={() => setActiveTab('recent')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
            activeTab === 'recent' ? 'bg-white text-indigo-600 shadow-2xs font-bold' : 'text-slate-500 hover:text-indigo-600'
          }`}
        >
          <Clock size={11} />
          <span>{lang === 'zh' ? '最近' : 'Recent'}</span>
        </button>
      </div>

      {/* Component Grid list */}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-0.5">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            <Sparkles size={24} className="mx-auto mb-2 opacity-30 text-indigo-500" />
            <p className="font-medium text-slate-500">{lang === 'zh' ? '未找到相关组件' : 'No components found'}</p>
            <p className="text-[10px] mt-1 text-slate-400">
              {activeTab !== 'all' ? (lang === 'zh' ? '尝试切换到全部组件' : 'Try switching to All tab') : (lang === 'zh' ? '更换搜索关键词' : 'Try a different search term')}
            </p>
          </div>
        ) : activeTab !== 'all' || searchQuery.trim() ? (
          // Flat list view when searching or tab-filtering
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
          // Grouped list view
          PALETTE_GROUPS.map((group) => {
            const items = filteredItems.filter((i) => i.group === group.id);
            if (items.length === 0) return null;
            const accent = COLOR_THEME[items[0].color] || COLOR_THEME.indigo;
            const isCollapsed = collapsedGroups[group.id];

            return (
              <div key={group.id} className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="flex items-center justify-between px-1 py-0.5 text-left group/grp cursor-pointer hover:bg-slate-200/40 rounded transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${accent.groupAccent}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${accent.groupText}`}>
                      {lang === 'zh' ? group.labelZh : group.labelEn}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400 group-hover/grp:text-slate-600">
                    <span className="text-[9px] font-mono font-medium opacity-70">({items.length})</span>
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </div>
                </button>

                {!isCollapsed && (
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
          })
        )}
      </div>
    </div>
  );
}

