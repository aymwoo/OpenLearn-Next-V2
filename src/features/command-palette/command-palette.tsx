/**
 * OpenLearn Command Palette - React Component (Sprint P2-05)
 * Global Command Palette modal with fuzzy search and keyboard navigation.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CommandPaletteProps, CommandCategory, CommandDescriptor } from './command-types.js';
import { CommandRegistry } from './command-registry.js';

export const globalCommandRegistry = new CommandRegistry();

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  registry = globalCommandRegistry,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CommandCategory | 'All'>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const categoryFilter = selectedCategory === 'All' ? undefined : selectedCategory;
    return registry.search(query, categoryFilter);
  }, [registry, query, selectedCategory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredCommands.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = filteredCommands[selectedIndex];
        if (active) {
          registry.executeCommand(active.id);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filteredCommands, selectedIndex, registry, onClose]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div
      className="command-palette-backdrop fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-start justify-center pt-24"
      onClick={onClose}
      data-testid="command-palette-backdrop"
    >
      <div
        className="command-palette-container w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="command-palette-modal"
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-slate-800 bg-slate-900/90">
          <input
            type="text"
            className="w-full bg-transparent text-slate-100 placeholder-slate-400 outline-none text-base font-medium"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            data-testid="command-search-input"
          />
          <kbd className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700 font-mono">
            ESC
          </kbd>
        </div>

        {/* Category Filters */}
        <div className="flex items-center space-x-1 px-3 py-2 border-b border-slate-800 bg-slate-900/50 overflow-x-auto">
          {(['All', 'Lesson', 'Whiteboard', 'Plugin', 'AI', 'Workspace', 'Analytics', 'Resource'] as const).map(
            (cat) => (
              <button
                key={cat}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            )
          )}
        </div>

        {/* Command List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-800/50">
          {filteredCommands.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">No commands found.</div>
          ) : (
            filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                  idx === selectedIndex ? 'bg-indigo-600/20 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                }`}
                onClick={() => {
                  registry.executeCommand(cmd.id);
                  onClose();
                }}
                data-testid={`command-item-${cmd.id}`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-indigo-400 border border-slate-700">
                    {cmd.category}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-100">{cmd.title}</div>
                    {cmd.description && <div className="text-xs text-slate-400">{cmd.description}</div>}
                  </div>
                </div>
                {cmd.shortcut && (
                  <kbd className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {cmd.shortcut}
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
