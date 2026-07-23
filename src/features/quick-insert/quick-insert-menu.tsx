/**
 * OpenLearn Quick Insert - React Popup Component (Sprint P2-07)
 * Slash Command (/) insertion menu with search, categories, recents, and favorites.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  QuickInsertMenuProps,
  QuickInsertCategory,
  QuickInsertItemDescriptor,
} from './quick-insert-types.js';
import { QuickInsertRegistry } from './quick-insert-registry.js';

export const globalQuickInsertRegistry = new QuickInsertRegistry();

export const QuickInsertMenu: React.FC<QuickInsertMenuProps> = ({
  isOpen,
  onClose,
  registry = globalQuickInsertRegistry,
  initialQuery = '/',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState<QuickInsertCategory | 'All'>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = useMemo(() => {
    const categoryFilter = selectedCategory === 'All' ? undefined : selectedCategory;
    return registry.search(query, categoryFilter);
  }, [registry, query, selectedCategory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = filteredItems[selectedIndex];
        if (active) {
          registry.executeItem(active.id);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filteredItems, selectedIndex, registry, onClose]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div
      className="quick-insert-backdrop fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 flex items-center justify-center"
      onClick={onClose}
      data-testid="quick-insert-backdrop"
    >
      <div
        className="quick-insert-container w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="quick-insert-modal"
      >
        {/* Slash Prompt Input Header */}
        <div className="flex items-center px-4 py-3 border-b border-slate-800 bg-slate-900/90">
          <span className="text-indigo-400 font-mono font-bold text-lg mr-2">/</span>
          <input
            type="text"
            className="w-full bg-transparent text-slate-100 placeholder-slate-400 outline-none text-sm font-medium"
            placeholder="Type a command or filter..."
            value={query.startsWith('/') ? query.slice(1) : query}
            onChange={(e) => setQuery('/' + e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            data-testid="quick-insert-search-input"
          />
          <kbd className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 font-mono">
            ESC
          </kbd>
        </div>

        {/* Category Filters */}
        <div className="flex items-center space-x-1 px-3 py-1.5 border-b border-slate-800 bg-slate-900/50 overflow-x-auto">
          {(['All', 'Media', 'Shape', 'Tool', 'AI', 'Widget', 'Plugin'] as const).map((cat) => (
            <button
              key={cat}
              className={`px-2 py-0.5 text-xs rounded-md transition-colors font-medium ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Item List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-slate-800/40">
          {filteredItems.length === 0 ? (
            <div className="py-6 text-center text-slate-500 text-sm">No insertable items match slash command.</div>
          ) : (
            filteredItems.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  idx === selectedIndex ? 'bg-indigo-600/20 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                }`}
                onClick={() => {
                  registry.executeItem(item.id);
                  onClose();
                }}
                data-testid={`quick-insert-item-${item.id}`}
              >
                <div className="flex items-center space-x-2.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-indigo-400 border border-slate-700">
                    {item.category}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-100">{item.title}</div>
                    {item.description && <div className="text-xs text-slate-400">{item.description}</div>}
                  </div>
                </div>
                {item.shortcut && (
                  <kbd className="text-xs font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                    {item.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
