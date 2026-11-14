import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Eye, Palette, Check, Sparkles, PackageOpen } from 'lucide-react';
import { useThemeStore, type ThemeId } from '../store/themeStore';
import { useAppStore } from '../store/appStore';
import { ThemeDesignerModal } from './ThemeDesignerModal';
import { ThemeCenterModal } from './ThemeCenterModal';

interface ThemeSelectorProps {
  lang?: 'zh' | 'en';
}

export function ThemeSelector({ lang = 'zh' }: ThemeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDesignerOpen, setIsDesignerOpen] = useState(false);
  const [isCenterOpen, setIsCenterOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const session = useAppStore((s) => s.session);
  const isAdmin = session?.subRole === 'administrator';

  const theme = useThemeStore((s) => s.theme);
  const availableThemes = useThemeStore((s) => s.availableThemes);
  const catalog = useThemeStore((s) => s.catalog);
  const upgradeAvailable = useThemeStore((s) => s.upgradeAvailable);
  const selectTheme = useThemeStore((s) => s.selectTheme);
  const setTheme = useThemeStore((s) => s.setTheme);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const getThemeIcon = (id: ThemeId) => {
    switch (id) {
      case 'dark':
        return <Moon size={16} className="text-indigo-400" />;
      case 'eyecare':
        return <Eye size={16} className="text-emerald-500" />;
      case 'chalkboard':
        return <Palette size={16} className="text-green-400" />;
      case 'light':
        return <Sun size={16} className="text-amber-500" />;
      default:
        return <Sparkles size={16} className="text-primary-theme" />;
    }
  };

  const activeThirdPartyCatalog = catalog.filter((c) => c.status === 'active');

  const handleSelect = (id: string) => {
    setIsOpen(false);
    const isCustomLocal = availableThemes.some((t) => t.id === id && t.category === 'custom');
    if (isCustomLocal) {
      setTheme(id);
      return;
    }
    void selectTheme(id);
  };

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          title={lang === 'zh' ? '切换教学界面主题' : 'Switch Theme'}
          className="relative p-2 hover:bg-surface-secondary text-main transition-colors bg-surface rounded-lg border border-theme shadow-3xs flex items-center justify-center shrink-0 cursor-pointer"
          aria-label="Theme selector"
        >
          {getThemeIcon(theme)}
          {upgradeAvailable && (
            <span
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-surface"
              title={lang === 'zh' ? '当前主题有可用更新' : 'Theme update available'}
            />
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-72 rounded-xl border border-theme bg-surface shadow-xl z-50 p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-2 border-b border-theme-subtle mb-1">
              <div className="text-xs font-semibold text-main uppercase tracking-wider">
                {lang === 'zh' ? '界面主题模式' : 'Interface Theme'}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {lang === 'zh' ? '针对不同教学采光与场景优化' : 'Optimized for diverse lighting'}
              </div>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {availableThemes.map((item) => {
                const isActive = theme === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-surface-secondary text-main font-semibold shadow-xs'
                        : 'text-muted hover:bg-surface-secondary hover:text-main'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/10 dark:border-white/20 shrink-0 shadow-inner"
                        style={{ backgroundColor: item.previewPrimary }}
                      />
                      <div>
                        <div className="font-medium text-main leading-none">{item.label}</div>
                        <div className="text-xs text-muted mt-1 leading-tight opacity-80">{item.description}</div>
                      </div>
                    </div>
                    {isActive && <Check size={14} className="text-primary-theme shrink-0" />}
                  </button>
                );
              })}

              {activeThirdPartyCatalog.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-muted uppercase tracking-wider border-t border-theme-subtle mt-1">
                    {lang === 'zh' ? '第三方主题包' : 'Third-Party Themes'}
                  </div>
                  {activeThirdPartyCatalog.map((entry) => {
                    const isActive = theme === entry.id;
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => handleSelect(entry.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-all cursor-pointer ${
                          isActive
                            ? 'bg-surface-secondary text-main font-semibold shadow-xs'
                            : 'text-muted hover:bg-surface-secondary hover:text-main'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium text-main leading-none flex items-center gap-1.5">
                            <span className="truncate">{entry.name}</span>
                            <span className="text-[10px] font-mono text-muted">v{entry.latestVersion}</span>
                          </div>
                          <div className="text-xs text-muted mt-1 truncate opacity-80">{entry.author}</div>
                        </div>
                        {isActive && <Check size={14} className="text-primary-theme shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* 第三方主题中心 & 自定义主题设计器 */}
            <div className="pt-2 mt-1 border-t border-theme-subtle space-y-1">
              <button
                type="button"
                data-testid="open-theme-center-btn"
                onClick={() => {
                  setIsOpen(false);
                  setIsCenterOpen(true);
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-primary-theme hover:bg-primary-theme/10 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <PackageOpen size={14} />
                  <span>{lang === 'zh' ? '第三方主题中心 (.zip)...' : 'Theme Center (.zip)...'}</span>
                </span>
                {upgradeAvailable && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
                    {lang === 'zh' ? '可更新' : 'Update'}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setIsDesignerOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-main hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                <Sparkles size={14} />
                <span>{lang === 'zh' ? '🎨 自定义主题设计器...' : '🎨 Theme Designer...'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ThemeCenterModal isOpen={isCenterOpen} onClose={() => setIsCenterOpen(false)} lang={lang} isAdmin={isAdmin} />
      <ThemeDesignerModal isOpen={isDesignerOpen} onClose={() => setIsDesignerOpen(false)} lang={lang} />
    </>
  );
}
