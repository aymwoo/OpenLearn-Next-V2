import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Eye, Palette, Check, Sparkles } from 'lucide-react';
import { useThemeStore, type ThemeId } from '../store/themeStore';
import { ThemeDesignerModal } from './ThemeDesignerModal';

interface ThemeSelectorProps {
  lang?: 'zh' | 'en';
}

export function ThemeSelector({ lang = 'zh' }: ThemeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDesignerOpen, setIsDesignerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme, availableThemes, setTheme } = useThemeStore();

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
      default:
        return <Sun size={16} className="text-amber-500" />;
    }
  };

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          title={lang === 'zh' ? '切换教学界面主题' : 'Switch Theme'}
          className="p-2 hover:bg-surface-secondary text-main transition-colors bg-surface rounded-lg border border-theme shadow-3xs flex items-center justify-center shrink-0 cursor-pointer"
          aria-label="Theme selector"
        >
          {getThemeIcon(theme)}
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-theme bg-surface shadow-xl z-50 p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-2 border-b border-theme-subtle mb-1">
              <div className="text-xs font-semibold text-main uppercase tracking-wider">
                {lang === 'zh' ? '界面主题模式' : 'Interface Theme'}
              </div>
              <div className="text-2xs text-muted mt-0.5">
                {lang === 'zh' ? '针对不同教学采光与场景优化' : 'Optimized for diverse lighting'}
              </div>
            </div>

            <div className="space-y-1">
              {availableThemes.map((item) => {
                const isActive = theme === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setTheme(item.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-surface-secondary text-main font-semibold shadow-xs'
                        : 'text-muted hover:bg-surface-secondary hover:text-main'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* Color swatch dot */}
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/10 dark:border-white/20 shrink-0 shadow-inner"
                        style={{ backgroundColor: item.previewPrimary }}
                      />
                      <div>
                        <div className="font-medium text-main leading-none">{item.label}</div>
                        <div className="text-3xs text-muted mt-1 leading-tight opacity-80">{item.description}</div>
                      </div>
                    </div>
                    {isActive && <Check size={14} className="text-primary-theme shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* 自定义主题设计器入口 */}
            <div className="pt-2 mt-1 border-t border-theme-subtle">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsDesignerOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-primary-theme hover:bg-primary-theme/10 transition-colors cursor-pointer"
              >
                <Sparkles size={14} />
                <span>{lang === 'zh' ? '🎨 自定义主题设计器...' : '🎨 Theme Designer...'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ThemeDesignerModal
        isOpen={isDesignerOpen}
        onClose={() => setIsDesignerOpen(false)}
        lang={lang}
      />
    </>
  );
}
