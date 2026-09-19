import React, { useState, useRef, useEffect } from 'react';
import { Type, Minus, Plus, RotateCcw, Check } from 'lucide-react';
import { useFontSizeStore, FONT_SCALE_PRESETS, FONT_SCALE_DEFAULT } from '../store/fontSizeStore';

interface FontSizeSelectorProps {
  lang?: 'zh' | 'en';
}

export function FontSizeSelector({ lang = 'zh' }: FontSizeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { scale, minScale, maxScale, setScale, increaseScale, decreaseScale, resetScale } = useFontSizeStore();

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

  const currentPreset = FONT_SCALE_PRESETS.find((p) => p.scale === scale);
  const isDefault = scale === FONT_SCALE_DEFAULT;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={
          lang === 'zh' ? `界面字体缩放: ${scale}%（点击调节）` : `Interface Font Scaling: ${scale}% (Click to adjust)`
        }
        className={`p-2 hover:bg-surface-secondary transition-colors rounded-lg border shadow-3xs flex items-center justify-center shrink-0 cursor-pointer relative ${
          !isDefault
            ? 'bg-primary-theme-light border-primary-theme text-primary-theme font-bold'
            : 'bg-surface border-theme text-main'
        }`}
        aria-label="Font size selector"
        aria-expanded={isOpen}
      >
        <Type size={16} />
        {!isDefault && (
          <span className="absolute -bottom-1 -right-1 text-[9px] px-1 py-0.2 rounded-full bg-primary-theme text-white font-extrabold leading-none shadow-xs">
            {scale}%
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-theme bg-surface shadow-xl z-50 p-3 overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-none">
          {/* 标题 */}
          <div className="px-1 pb-2 border-b border-theme-subtle mb-2.5 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-main">
                {lang === 'zh' ? '界面字号大小' : 'Interface Font Size'}
              </div>
              <div className="text-2xs text-muted mt-0.5">
                {lang === 'zh' ? '全局等比缩放排版与文字' : 'Proportionally scale typography'}
              </div>
            </div>
            {!isDefault && (
              <button
                type="button"
                onClick={resetScale}
                className="flex items-center gap-1 text-2xs text-muted hover:text-primary-theme transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-surface-secondary"
                title={lang === 'zh' ? '恢复默认 100%' : 'Reset to 100%'}
              >
                <RotateCcw size={11} />
                <span>{lang === 'zh' ? '重置' : 'Reset'}</span>
              </button>
            )}
          </div>

          {/* 步进微调控制条 */}
          <div className="bg-surface-secondary/70 rounded-lg p-2 flex items-center justify-between mb-3 border border-theme-subtle">
            <button
              type="button"
              onClick={decreaseScale}
              disabled={scale <= minScale}
              className="w-8 h-8 rounded-md bg-surface border border-theme flex items-center justify-center text-main hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-3xs"
              title={lang === 'zh' ? '减小字体 (A-)' : 'Decrease (A-)'}
            >
              <Minus size={14} />
            </button>

            <div className="text-center">
              <div className="text-sm font-black text-main leading-tight">{scale}%</div>
              <div className="text-3xs text-muted">
                {currentPreset
                  ? lang === 'zh'
                    ? currentPreset.labelZh.split(' ')[0]
                    : currentPreset.labelEn.split(' ')[0]
                  : lang === 'zh'
                    ? '自定义比例'
                    : 'Custom'}
              </div>
            </div>

            <button
              type="button"
              onClick={increaseScale}
              disabled={scale >= maxScale}
              className="w-8 h-8 rounded-md bg-surface border border-theme flex items-center justify-center text-main hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-3xs"
              title={lang === 'zh' ? '增大字体 (A+)' : 'Increase (A+)'}
            >
              <Plus size={14} />
            </button>
          </div>

          {/* 预设档位胶囊列表 */}
          <div className="space-y-1 mb-3">
            <div className="text-3xs font-bold text-muted uppercase tracking-wider px-1">
              {lang === 'zh' ? '常用档位' : 'Presets'}
            </div>
            <div className="grid grid-cols-1 gap-1">
              {FONT_SCALE_PRESETS.map((preset) => {
                const isActive = scale === preset.scale;
                return (
                  <button
                    key={preset.scale}
                    type="button"
                    onClick={() => setScale(preset.scale)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-primary-theme-light text-primary-theme font-bold border border-primary-theme/30'
                        : 'text-main hover:bg-surface-secondary border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                      <span>{lang === 'zh' ? preset.labelZh : preset.labelEn}</span>
                    </div>
                    {isActive && <Check size={13} className="text-primary-theme shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 实时效果示例框 */}
          <div className="p-2.5 rounded-lg border border-theme-subtle bg-surface-secondary/40 mb-2">
            <div className="text-3xs text-muted mb-1 flex items-center justify-between">
              <span>{lang === 'zh' ? '实时效果预览' : 'Live Preview'}</span>
              <span>{scale}%</span>
            </div>
            <p className="text-xs text-main font-medium leading-relaxed">
              {lang === 'zh'
                ? '让每一个文字都清晰舒适，智能赋能教学。'
                : 'Clear and comfortable typography empowers modern teaching.'}
            </p>
          </div>

          {/* 快捷键操作提示 */}
          <div className="text-3xs text-muted/80 text-center px-1">
            {lang === 'zh' ? '快捷键：Ctrl + Alt + 加号/减号' : 'Shortcut: Ctrl + Alt + +/-'}
          </div>
        </div>
      )}
    </div>
  );
}
